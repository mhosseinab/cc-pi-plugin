import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { validate } from '../plugins/pi/scripts/lib/input.mjs';
import { EventDecoder, EVENT_LIMIT } from '../plugins/pi/scripts/lib/events.mjs';
import { isSupportedVersion } from '../plugins/pi/scripts/lib/pi.mjs';
import { workspace } from '../plugins/pi/scripts/lib/state.mjs';
import { reviewPrompt } from '../plugins/pi/scripts/lib/review.mjs';

const cli = path.resolve('plugins/pi/scripts/companion.mjs');
const fake = path.resolve('tests/fixtures/pi.mjs');
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pi-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'checkout with spaces');
  fs.mkdirSync(root);
  return {
    base,
    root,
    env: { ...process.env, CC_PI_BIN: fake, CC_PI_STATE_DIR: path.join(base, 'state') },
  };
}
function invoke(f, command, input = {}) {
  const child = spawn(process.execPath, [cli, command], {
    cwd: f.root,
    env: f.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(JSON.stringify(input));
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        resolve({ code, stdout, stderr, data: stdout.trim() ? JSON.parse(stdout) : null });
      } catch (error) {
        reject(error);
      }
    });
  });
  return { child, done };
}
async function call(f, command, input = {}) {
  return invoke(f, command, input).done;
}
async function activeJob(f, status = 'running') {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    const out = await call(f, 'status');
    assert.equal(out.code, 0, out.stderr);
    const job = out.data.jobs.find((j) => j.status === status);
    if (job) return job;
    await delay(20);
  }
  throw new Error('Job did not start.');
}

test('status tolerates a new job directory before metadata is published, but not corrupt metadata', async (t) => {
  const f = fixture(t);
  const first = await call(f, 'task', { prompt: 'completed' });
  assert.equal(first.code, 0, first.stderr);
  const directory = path.join(path.dirname(first.data.logDirectory), 'a'.repeat(32));
  fs.mkdirSync(directory);
  const pending = await call(f, 'status');
  assert.equal(pending.code, 0, pending.stderr);
  assert.deepEqual(
    pending.data.jobs.map((job) => job.id),
    [first.data.id],
  );
  assert.equal((await call(f, 'result', { job: 'a'.repeat(32) })).code, 1);
  fs.writeFileSync(path.join(directory, 'job.json'), '{malformed');
  const corrupt = await call(f, 'status');
  assert.equal(corrupt.code, 1);
  assert.match(corrupt.stderr, /JSON|property|position/i);
});

test('session continuation works through a trusted symlinked state parent', async (t) => {
  const f = fixture(t);
  const realParent = path.join(f.base, 'real-state-parent');
  const alias = path.join(f.base, 'state-alias');
  fs.mkdirSync(realParent);
  fs.symlinkSync(realParent, alias, 'dir');
  f.env.CC_PI_STATE_DIR = path.join(alias, 'state');
  const first = await call(f, 'task', { prompt: 'first' });
  assert.equal(first.code, 0, first.stderr);
  const next = await call(f, 'task', { prompt: 'continue', resume: first.data.id });
  assert.equal(next.code, 0, next.stderr);
  assert.equal(next.data.sessionID, first.data.sessionID);
});

test('review evidence collection does not execute a repository fsmonitor helper', (t) => {
  const f = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: f.root, stdio: 'pipe' });
  git('init', '-q');
  const marker = path.join(f.root, 'fsmonitor-ran');
  fs.writeFileSync(
    path.join(f.root, 'monitor.sh'),
    '#!/bin/sh\ntouch fsmonitor-ran\nprintf "token\\0"\n',
    { mode: 0o755 },
  );
  git('config', 'core.fsmonitor', './monitor.sh');
  fs.writeFileSync(path.join(f.root, 'file.txt'), 'review evidence\n');
  const prompt = reviewPrompt(f.root, {});
  assert.ok(prompt.includes('file.txt'));
  assert.equal(fs.existsSync(marker), false);
});

test('review evidence collection disables Git clean and process filter helpers', (t) => {
  const f = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: f.root, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(f.root, '.gitattributes'), '*.txt filter=fixture\n');
  fs.writeFileSync(path.join(f.root, 'file.txt'), 'base\n');
  fs.writeFileSync(path.join(f.root, 'filter.sh'), '#!/bin/sh\ntouch filter-ran\ncat\n', {
    mode: 0o755,
  });
  git('add', '.');
  git('commit', '-qm', 'base');
  fs.writeFileSync(path.join(f.root, 'file.txt'), 'changed\n');
  git('config', 'filter.fixture.clean', './filter.sh');
  git('config', 'filter.fixture.required', 'true');
  const prompt = reviewPrompt(f.root, {});
  assert.ok(prompt.includes('changed'));
  assert.equal(fs.existsSync(path.join(f.root, 'filter-ran')), false);
  git('config', 'filter.fixture.process', './filter.sh');
  assert.ok(reviewPrompt(f.root, {}).includes('changed'));
  assert.equal(fs.existsSync(path.join(f.root, 'filter-ran')), false);
});

test('review does not recurse into a submodule with executable filters', (t) => {
  const f = fixture(t);
  const inner = path.join(f.base, 'inner');
  fs.mkdirSync(inner);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  for (const cwd of [inner, f.root]) {
    git(cwd, 'init', '-q');
    git(cwd, 'config', 'user.name', 'Test');
    git(cwd, 'config', 'user.email', 'test@example.invalid');
  }
  fs.writeFileSync(path.join(inner, '.gitattributes'), '*.txt filter=fixture\n');
  fs.writeFileSync(path.join(inner, 'file.txt'), 'base\n');
  fs.writeFileSync(path.join(inner, 'filter.sh'), '#!/bin/sh\ntouch filter-ran\ncat\n', {
    mode: 0o755,
  });
  git(inner, 'add', '.');
  git(inner, 'commit', '-qm', 'base');
  git(f.root, '-c', 'protocol.file.allow=always', 'submodule', 'add', inner, 'nested');
  git(f.root, 'commit', '-qm', 'submodule');
  const nested = path.join(f.root, 'nested');
  git(nested, 'config', 'filter.fixture.clean', './filter.sh');
  fs.writeFileSync(path.join(nested, 'file.txt'), 'edit\n');
  git(f.root, 'config', 'diff.submodule', 'diff');
  const prompt = reviewPrompt(f.root, {});
  assert.equal(fs.existsSync(path.join(nested, 'filter-ran')), false);
  assert.doesNotMatch(prompt, /\+edit/);
  assert.match(prompt, /gitlinks only/);
});

test('input validation rejects unsafe and ambiguous requests', () => {
  assert.equal(validate('task', { prompt: 'fix it' }).timeoutSeconds, 1800);
  for (const [command, input] of [
    ['task', {}],
    ['task', { prompt: 'x', unknown: true }],
    ['task', { prompt: 'x', agent: 'build' }],
    ['task', { prompt: 'x', variant: 'high' }],
    ['task', { prompt: 'x', tools: [] }],
    ['task', { prompt: 'x', tools: ['read', 'read'] }],
    ['task', { prompt: 'x', tools: ['mcp'] }],
    ['review', { trustProject: true }],
    ['review', { tools: ['bash'] }],
    ['review', { resume: 'a'.repeat(32) }],
    ['task', { prompt: 'x', timeoutSeconds: 0 }],
    ['task', { prompt: 'x', model: 'guess' }],
    ['task', { prompt: 'x', thinking: 'ultra' }],
    ['cancel', {}],
    ['result', { job: '../secret' }],
    ['review', { base: '--output=bad' }],
    ['task', []],
    ['task', { prompt: 'a\0b' }],
    ['setup', { job: 'a'.repeat(32) }],
    ['steer', { job: 'a'.repeat(32) }],
  ])
    assert.throws(() => validate(command, input));
});

test('RPC JSONL preserves split UTF-8 and Unicode separators and rejects malformed output', () => {
  const events = [];
  const decoder = new EventDecoder((e) => events.push(e));
  for (const byte of Buffer.from('{"type":"text","text":"سلام ✓\u2028x\u2029y"}\r\n{"type":"end"}'))
    decoder.push(Buffer.from([byte]));
  decoder.end();
  assert.equal(events[0].text, 'سلام ✓\u2028x\u2029y');
  assert.equal(events[1].type, 'end');
  assert.throws(() => new EventDecoder(() => {}).push(Buffer.from('{broken}\n')), /Malformed/);
  assert.throws(
    () => new EventDecoder(() => {}).push(Buffer.from('unexpected stdout\n')),
    /Malformed/,
  );
  assert.throws(
    () => new EventDecoder(() => {}).push(Buffer.alloc(EVENT_LIMIT + 1, 120)),
    /exceeds/,
  );
});

test('task preserves hostile literal input and private state without exposing model headers', async (t) => {
  const f = fixture(t);
  f.env.FAKE_RECORD = path.join(f.base, 'record.json');
  const prompt = 'Fix "quotes"; $(touch injected) `touch bad`\n--model fake\nسلام';
  const out = await call(f, 'task', { prompt, model: 'test/another/model', thinking: 'high' });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.data.status, 'completed');
  const record = JSON.parse(fs.readFileSync(f.env.FAKE_RECORD, 'utf8'));
  assert.equal(record.prompt, prompt);
  assert.equal(record.cwd, fs.realpathSync(f.root));
  assert.equal(record.pwd, record.cwd);
  assert.equal(record.args.includes(prompt), false);
  assert.ok(record.args.includes('--mode'));
  assert.ok(record.args.includes('--no-mcp'));
  assert.ok(record.args.includes('--no-extensions'));
  assert.equal(fs.existsSync(path.join(f.root, 'injected')), false);
  assert.equal(fs.statSync(out.data.logDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(out.data.logDirectory, 'job.json')).mode & 0o777, 0o600);
  assert.doesNotMatch(
    fs.readFileSync(path.join(out.data.logDirectory, 'events.jsonl'), 'utf8'),
    /fixture-secret/,
  );
  assert.equal((await call(f, 'result', { job: out.data.id })).data.text, 'Fixture response ✓');
  assert.equal(
    (await call(f, 'status')).data.jobs[0].outputCharacters,
    'Fixture response ✓'.length,
  );
  assert.equal(out.data.usage.scope, 'session');
});

test('resume selects recorded session and inherits model/thinking/tools but not project trust', async (t) => {
  const f = fixture(t);
  const first = await call(f, 'task', {
    prompt: 'first',
    model: 'test/another/model',
    thinking: 'high',
    tools: ['read'],
    trustProject: true,
  });
  assert.equal(first.code, 0, first.stderr);
  f.env.FAKE_RECORD = path.join(f.base, 'resume.json');
  const next = await call(f, 'task', { prompt: 'continue', resume: first.data.id });
  assert.equal(next.code, 0, next.stderr);
  const record = JSON.parse(fs.readFileSync(f.env.FAKE_RECORD, 'utf8'));
  assert.ok(record.args.includes('--session'));
  assert.ok(record.args.includes(first.data.sessionFile));
  assert.ok(record.args.includes('--no-approve'));
  assert.equal(next.data.trustProject, false);
  assert.equal(next.data.model, 'test/another/model');
  assert.equal(next.data.thinking, 'high');
  assert.deepEqual(next.data.tools, ['read']);
  const elsewhere = path.join(f.base, 'elsewhere');
  fs.mkdirSync(elsewhere);
  assert.equal((await call(f, 'result', { cwd: elsewhere, job: first.data.id })).code, 1);
  const header = { type: 'session', id: first.data.sessionID, cwd: elsewhere };
  fs.writeFileSync(first.data.sessionFile, `${JSON.stringify(header)}\n`);
  const tampered = await call(f, 'task', { prompt: 'continue', resume: first.data.id });
  assert.equal(tampered.code, 1);
  assert.match(tampered.stderr, /working directory/);
});

test('model and thinking never silently fall back', async (t) => {
  const f = fixture(t);
  assert.equal(
    (await call(f, 'task', { prompt: 'x', model: 'missing/model' })).data.status,
    'failed',
  );
  f.env.FAKE_FALLBACK = '1';
  const bad = await call(f, 'task', { prompt: 'x', model: 'test/another/model' });
  assert.match(bad.data.error, /instead of/);
  delete f.env.FAKE_FALLBACK;
  f.env.FAKE_CLAMP = '1';
  assert.match(
    (await call(f, 'task', { prompt: 'x', thinking: 'high' })).data.error,
    /changed thinking/,
  );
  assert.match(
    (await call(f, 'task', { prompt: 'x', thinking: 'max' })).data.error,
    /not supported/,
  );
});

for (const [prompt, status] of [
  ['MALFORMED', 'failed'],
  ['EXIT_FAIL', 'failed'],
  ['ERROR_ZERO', 'failed'],
  ['LENGTH', 'failed'],
  ['INCOMPLETE', 'failed'],
  ['HANDLED', 'failed'],
  ['DENIED', 'blocked'],
]) {
  test(`${prompt} cannot become successful completion`, async (t) => {
    const out = await call(fixture(t), 'task', { prompt });
    assert.equal(out.code, 1, out.stderr);
    assert.equal(out.data.status, status);
  });
}

test('agent_end before a successful retry is not final completion', async (t) => {
  const out = await call(fixture(t), 'task', { prompt: 'RETRY' });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.data.text, 'Fixture response ✓');
});

test('deadline kills a hung worker and releases the lock', async (t) => {
  const f = fixture(t);
  assert.equal(
    (await call(f, 'task', { prompt: 'HANG', timeoutSeconds: 1 })).data.status,
    'timed_out',
  );
  assert.equal((await call(f, 'task', { prompt: 'next' })).code, 0);
});

test('concurrent writers are refused and cancel clears queued work before abort', async (t) => {
  const f = fixture(t);
  f.env.FAKE_RECORD = path.join(f.base, 'record.json');
  const run = invoke(f, 'task', { prompt: 'HANG', timeoutSeconds: 10 });
  t.after(() => run.child.kill('SIGTERM'));
  const active = await activeJob(f);
  const busy = await call(f, 'task', { prompt: 'conflict' });
  assert.equal(busy.code, 1);
  assert.match(busy.stderr, /Workspace busy/);
  assert.equal((await call(f, 'cancel', { job: active.id })).data.cancellationRequested, true);
  assert.equal((await run.done).data.status, 'cancelled');
  const types = JSON.parse(fs.readFileSync(f.env.FAKE_RECORD, 'utf8')).requests.map((r) => r.type);
  assert.ok(types.indexOf('clear_queue') < types.indexOf('abort'));
  assert.equal((await call(f, 'cancel', { job: active.id })).data.cancellationRequested, false);
});

test('steering reaches its running worker and records an acceptance receipt', async (t) => {
  const f = fixture(t);
  const run = invoke(f, 'task', { prompt: 'STEER_WAIT', timeoutSeconds: 10 });
  t.after(() => run.child.kill('SIGTERM'));
  const active = await activeJob(f);
  const request = await call(f, 'steer', { job: active.id, prompt: 'Prioritize tests' });
  assert.equal(request.data.deliveryRequested, true);
  const done = await run.done;
  assert.equal(done.code, 0, done.stderr);
  assert.equal(done.data.text, 'Steered: Prioritize tests');
  assert.equal(done.data.controls.find((r) => r.id === request.data.requestID).status, 'queued');
  assert.equal((await call(f, 'steer', { job: active.id, prompt: 'late' })).code, 1);
});

for (const stage of ['version', 'rpc', 'running']) {
  test(`SIGTERM during ${stage} cleans up and releases its workspace lock`, async (t) => {
    const f = fixture(t);
    if (stage === 'version') f.env.FAKE_VERSION_HANG = '1';
    if (stage === 'rpc') f.env.FAKE_PREFLIGHT_HANG = '1';
    const run = invoke(f, 'task', { prompt: 'HANG', timeoutSeconds: 10 });
    t.after(() => run.child.kill('SIGKILL'));
    await activeJob(f, stage === 'running' ? 'running' : 'starting');
    if (stage === 'rpc') await delay(100);
    run.child.kill('SIGTERM');
    assert.equal((await run.done).data.status, 'cancelled');
    delete f.env.FAKE_VERSION_HANG;
    delete f.env.FAKE_PREFLIGHT_HANG;
    assert.equal((await call(f, 'task', { prompt: 'next' })).code, 0);
  });
}

test('version range accepts newer stable 1.x versions and rejects unverified major/prereleases', async (t) => {
  for (const version of ['1.5.2', '1.5.3', '1.6.0', '1.100.0', '1.5.3+build.1'])
    assert.equal(isSupportedVersion(version), true, version);
  for (const version of [
    '1.5.1',
    '1.4.99',
    '0.99.0',
    '2.0.0',
    '1.5.3-beta.1',
    '1.05.2',
    '1.5',
    'unknown',
    '1.5.2+',
  ])
    assert.equal(isSupportedVersion(version), false, version);
  const f = fixture(t);
  f.env.FAKE_VERSION = '1.6.0';
  const setup = await call(f, 'setup');
  assert.equal(setup.code, 0, setup.stderr);
  assert.equal(setup.data.version, '1.6.0');
  assert.doesNotMatch(setup.stdout, /fixture-secret/);
  assert.equal(setup.data.authentication, 'not_verified');
  assert.equal((await call(f, 'task', { prompt: 'new version' })).code, 0);
  f.env.FAKE_VERSION = '2.0.0';
  const bad = await call(f, 'task', { prompt: 'unsupported' });
  assert.match(bad.data.error, /Supported Pi version/);
});

test('review includes scoped git evidence and cannot be resumed as an implementation job', async (t) => {
  const f = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: f.root, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'staged\n');
  git('add', '.');
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'unstaged\n');
  fs.writeFileSync(path.join(f.root, 'untracked.txt'), 'new\n');
  f.env.FAKE_RECORD = path.join(f.base, 'review.json');
  const out = await call(f, 'review', { prompt: 'regression focus' });
  assert.equal(out.code, 0, out.stderr);
  const record = JSON.parse(fs.readFileSync(f.env.FAKE_RECORD, 'utf8'));
  for (const text of ['untracked.txt', 'staged', 'unstaged', 'regression focus'])
    assert.ok(record.prompt.includes(text));
  assert.deepEqual(out.data.tools, ['read', 'grep', 'find', 'ls']);
  assert.equal((await call(f, 'task', { prompt: 'reuse', resume: out.data.id })).code, 1);
  assert.equal((await call(f, 'review', { base: 'HEAD' })).code, 0);
  assert.doesNotMatch(
    JSON.parse(fs.readFileSync(f.env.FAKE_RECORD, 'utf8')).prompt,
    /untracked.txt/,
  );
  fs.mkdirSync(path.join(f.root, 'subdir'));
  assert.equal(workspace(path.join(f.root, 'subdir')), fs.realpathSync(f.root));
});

test('stale lock is reported without takeover and dead jobs appear interrupted', async (t) => {
  const f = fixture(t);
  const out = await call(f, 'task', { prompt: 'first' });
  const file = path.join(out.data.logDirectory, 'job.json');
  fs.writeFileSync(file, JSON.stringify({ ...out.data, status: 'running', ownerPid: 2147483647 }));
  assert.equal((await call(f, 'result', { job: out.data.id })).data.status, 'interrupted');
  const lock = path.join(path.dirname(out.data.logDirectory), 'workspace.lock');
  fs.writeFileSync(lock, JSON.stringify({ id: out.data.id, pid: 2147483647 }));
  const next = await call(f, 'task', { prompt: 'blocked' });
  assert.match(next.stderr, /Stale workspace lock/);
  assert.ok(fs.existsSync(lock));
});

test(
  'timeout kills stubborn descendants before releasing the worktree lock',
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t);
    f.env.FAKE_HEARTBEAT = path.join(f.base, 'heartbeat');
    f.env.FAKE_CHILD_PID = path.join(f.base, 'child-pid');
    t.after(() => {
      if (fs.existsSync(f.env.FAKE_CHILD_PID)) {
        try {
          process.kill(Number(fs.readFileSync(f.env.FAKE_CHILD_PID, 'utf8')), 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    });
    const out = await call(f, 'task', { prompt: 'DESCENDANT', timeoutSeconds: 1 });
    assert.equal(out.data.status, 'timed_out');
    const first = fs.readFileSync(f.env.FAKE_HEARTBEAT, 'utf8');
    await delay(150);
    assert.equal(fs.readFileSync(f.env.FAKE_HEARTBEAT, 'utf8'), first);
    assert.equal((await call(f, 'task', { prompt: 'next' })).code, 0);
  },
);
