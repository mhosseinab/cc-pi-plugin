import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { JobUsage } from '../plugins/pi/scripts/lib/usage.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pi-usage-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'session.jsonl');
  const job = {
    sessionID: 'usage-fixture',
    sessionFile: file,
    sessionDirectory: directory,
    resume: null,
  };
  const header = { type: 'session', version: 3, id: job.sessionID, cwd: directory };
  const append = (...entries) =>
    fs.appendFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  return { job, file, header, append };
}

function usage({
  input = 10,
  output = 2,
  cacheRead = 90,
  cacheWrite = 5,
  cost = 0.2,
  providerCost = false,
} = {}) {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    reasoning: 1,
    cacheWrite1h: cacheWrite,
    cost: {
      input: 99,
      output: 99,
      cacheRead: 99,
      cacheWrite: 99,
      total: cost,
      totalFromProvider: providerCost,
    },
  };
}

function assistant(counters = usage()) {
  return {
    type: 'message',
    message: {
      role: 'assistant',
      provider: 'fixture',
      model: 'alias',
      responseModel: 'actual-model',
      stopReason: 'stop',
      usage: counters,
    },
  };
}

test('job usage counts ledger entries once and excludes warming and summaries from assistant cache rate', (t) => {
  const f = fixture(t);
  const tracker = new JobUsage();
  tracker.start(f.job);
  const main = assistant(usage({ providerCost: true }));
  const warm = {
    type: 'usage',
    id: 'warm-1',
    kind: 'cache_warm',
    provider: 'fixture',
    model: 'actual-model',
    usage: usage({ input: 0, output: 1, cacheRead: 1000, cacheWrite: 0, cost: 0.01 }),
  };
  tracker.observe({ type: 'message_end', message: main.message });
  tracker.observe({ type: 'entry_appended', entry: warm });
  tracker.observe({ type: 'entry_appended', entry: warm });
  f.append(
    f.header,
    main,
    warm,
    {
      type: 'compaction',
      usage: usage({ input: 20, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.08 }),
    },
    {
      type: 'message',
      message: {
        role: 'toolResult',
        usage: usage({ input: 7, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.02 }),
      },
    },
    {
      type: 'branch_summary',
      usage: usage({ input: 15, output: 4, cacheRead: 0, cacheWrite: 0, cost: 0.06 }),
    },
  );
  const report = tracker.finish('completed');
  assert.equal(report.scope, 'job');
  assert.equal(report.complete, true);
  assert.equal(report.source, 'session_entries');
  assert.equal(report.records, 5);
  assert.deepEqual(report.tokens, {
    input: 52,
    output: 13,
    cacheRead: 1090,
    cacheWrite: 5,
    total: 1160,
  });
  assert.ok(Math.abs(report.cost - 0.37) < 1e-12);
  assert.equal(report.costSource, 'mixed');
  assert.equal(report.assistantCacheHitRate, 90 / 105);
  const model = report.breakdown.find((group) => group.kind === 'assistant');
  assert.equal(model.provider, 'fixture');
  assert.equal(model.model, 'actual-model');
  assert.equal(model.costSource, 'provider');
  for (const kind of ['tool', 'compaction', 'branch_summary']) {
    const group = report.breakdown.find((value) => value.kind === kind);
    assert.equal(group.provider, null);
    assert.equal(group.model, null);
  }
});

test('resume accounting starts at the actual file boundary and ignores later appends to an old result', (t) => {
  const f = fixture(t);
  f.append(f.header, assistant(usage({ input: 100 })));
  f.append(assistant(usage({ input: 200 })));
  const tracker = new JobUsage();
  tracker.start({ ...f.job, resume: 'older-job' });
  f.append(assistant(usage({ input: 3, output: 4, cacheRead: 5, cacheWrite: 6 })));
  const report = tracker.finish('completed');
  assert.equal(report.complete, true);
  assert.deepEqual(report.tokens, { input: 3, output: 4, cacheRead: 5, cacheWrite: 6, total: 18 });
  f.append(assistant(usage({ input: 1000 })));
  assert.equal(report.tokens.input, 3);
});

test('live checkpoints retain observed usage without claiming the session ledger is final', (t) => {
  const f = fixture(t);
  const tracker = new JobUsage();
  assert.equal(tracker.snapshot().source, 'none');
  assert.equal(tracker.finish('failed').cost, 0);
  tracker.start(f.job);
  const message = assistant().message;
  tracker.observe({ type: 'message_end', message });
  tracker.observe({ type: 'agent_end', messages: [message] });
  const report = tracker.snapshot();
  assert.equal(report.records, 1);
  assert.equal(report.complete, false);
  assert.equal(report.source, 'rpc_events');
  assert.equal(report.tokens.input, 10);
});

test('truncated logs fall back to observed events without double counting warming', (t) => {
  const f = fixture(t);
  const tracker = new JobUsage();
  tracker.start(f.job);
  const main = assistant();
  const warm = { type: 'usage', id: 'warm', kind: 'cache_warm', usage: usage() };
  tracker.observe({ type: 'message_end', message: main.message });
  tracker.observe({ type: 'entry_appended', entry: warm });
  tracker.observe({ type: 'entry_appended', entry: warm });
  f.append(f.header, main, warm);
  fs.appendFileSync(f.file, '{"type":"message"');
  const report = tracker.finish('completed');
  assert.equal(report.complete, false);
  assert.equal(report.source, 'rpc_events');
  assert.equal(report.records, 2);
  assert.equal(report.tokens.total, 214);
  assert.match(report.warnings.join(' '), /only observed RPC/);
});

test('rewritten or replaced resumed logs cannot charge previous jobs to the current job', (t) => {
  for (const replace of [false, true]) {
    const f = fixture(t);
    f.append(f.header, assistant(usage({ input: 123 })));
    const tracker = new JobUsage();
    tracker.start({ ...f.job, resume: 'prior-job' });
    const main = assistant(usage({ input: 7 }));
    tracker.observe({ type: 'message_end', message: main.message });
    if (replace) fs.renameSync(f.file, `${f.file}.old`);
    else fs.truncateSync(f.file);
    f.append(f.header, assistant(usage({ input: 999 })), main);
    const report = tracker.finish('completed');
    assert.equal(report.complete, false);
    assert.equal(report.source, 'rpc_events');
    assert.equal(report.tokens.input, 7);
  }
});

test('session symlinks and mismatched identities are not read for accounting', (t) => {
  for (const symlink of [false, true]) {
    const f = fixture(t);
    const tracker = new JobUsage();
    tracker.start(f.job);
    if (symlink) {
      const target = `${f.file}.target`;
      fs.writeFileSync(target, `${JSON.stringify(f.header)}\n${JSON.stringify(assistant())}\n`);
      fs.symlinkSync(target, f.file);
    } else f.append({ ...f.header, id: 'unrelated-session' }, assistant());
    const report = tracker.finish('completed');
    assert.equal(report.complete, false);
    assert.equal(report.source, 'rpc_events');
    assert.equal(report.records, 0);
    assert.equal(report.cost, null);
    assert.equal(report.assistantCacheHitRate, null);
  }
});

test('invalid and missing usage remains incomplete, and absent cost is unknown rather than free', (t) => {
  const f = fixture(t);
  const tracker = new JobUsage();
  tracker.start(f.job);
  const missingCost = usage();
  delete missingCost.cost;
  f.append(f.header, assistant({ ...usage(), input: -1 }), assistant(missingCost), {
    type: 'message',
    message: { role: 'assistant' },
  });
  const report = tracker.finish('completed');
  assert.equal(report.complete, false);
  assert.equal(report.records, 1);
  assert.equal(report.cost, null);
  assert.equal(report.costSource, 'unknown');
  assert.match(report.warnings.join(' '), /invalid token counters/);
  assert.match(report.warnings.join(' '), /no valid cost/);
});

test('failure, cancellation, and timeout retain known ledger usage as partial', (t) => {
  for (const status of ['failed', 'cancelled', 'timed_out', 'blocked']) {
    const f = fixture(t);
    const tracker = new JobUsage();
    tracker.start(f.job);
    f.append(f.header, assistant());
    const report = tracker.finish(status);
    assert.equal(report.source, 'session_entries');
    assert.equal(report.complete, false);
    assert.equal(report.records, 1);
    assert.equal(report.cost, 0.2);
    assert.match(report.warnings.join(' '), /did not complete/);
  }
});

test('streaming usage snapshots replace each other and survive a worker crash', (t) => {
  const f = fixture(t);
  const tracker = new JobUsage();
  tracker.start(f.job);
  f.append(f.header, { type: 'message', message: { role: 'user', content: 'work' } });
  tracker.observe({
    type: 'message_start',
    message: { role: 'assistant', provider: 'fixture', model: 'streaming-model' },
  });
  tracker.observe({ type: 'message_update', usage: usage({ output: 1 }) });
  tracker.observe({ type: 'message_update', usage: usage({ output: 7 }) });
  assert.equal(tracker.snapshot().tokens.output, 7);
  assert.equal(tracker.snapshot().records, 1);
  const partial = tracker.finish('failed');
  assert.equal(partial.complete, false);
  assert.equal(partial.source, 'rpc_events');
  assert.equal(partial.tokens.output, 7);
  assert.equal(partial.breakdown[0].model, 'streaming-model');

  // A final message replaces the provisional snapshot; it must not be added twice.
  const final = assistant(usage({ output: 9 }));
  tracker.observe({ type: 'message_end', message: final.message });
  f.append(final);
  const completed = tracker.finish('completed');
  assert.equal(completed.complete, true);
  assert.equal(completed.tokens.output, 9);
  assert.equal(completed.records, 1);
});

test('a missing cost cannot make a known subtotal look like a complete provider total', (t) => {
  const f = fixture(t);
  const tracker = new JobUsage();
  tracker.start(f.job);
  const missing = usage();
  delete missing.cost;
  f.append(f.header, assistant(usage({ providerCost: true })), assistant(missing));
  const report = tracker.finish('completed');
  assert.equal(report.complete, false);
  assert.equal(report.cost, null);
  assert.equal(report.costSource, 'unknown');
  assert.equal(report.breakdown[0].cost, null);
  assert.equal(report.breakdown[0].costSource, 'unknown');
  assert.equal(report.records, 2);
});
