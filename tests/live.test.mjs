import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createLiveFixture, callCompanion, git } from './helpers/live-fixture.mjs';

const live = { skip: !process.env.PI_LIVE_BIN, timeout: 180000 };

test(
  'real Pi: provider failure, token exhaustion, and deadlines stay unsuccessful',
  live,
  async (t) => {
    const f = await createLiveFixture(t);
    for (const prompt of ['LIVE_PROVIDER_ERROR', 'LIVE_TOKEN_LIMIT']) {
      const out = await callCompanion(f, 'task', {
        prompt,
        model: 'fixture/fixture-model',
        timeoutSeconds: 45,
      });
      assert.notEqual(out.code, 0, JSON.stringify(out));
      assert.equal(out.data?.status, 'failed', JSON.stringify(out));
    }
    const beforeTimeout = f.requests.length;
    const timedOut = await callCompanion(f, 'task', {
      prompt: 'LIVE_HANG_TASK',
      model: 'fixture/fixture-model',
      timeoutSeconds: 3,
    });
    assert.ok(
      f.requests.length > beforeTimeout,
      'The deadline must interrupt a real provider call.',
    );
    assert.equal(timedOut.data?.status, 'timed_out', JSON.stringify(timedOut));
    const recovered = await callCompanion(f, 'task', {
      prompt: 'A fresh job can start after the deadline.',
      model: 'fixture/fixture-model',
      timeoutSeconds: 45,
    });
    assert.equal(recovered.code, 0, JSON.stringify(recovered));
    assert.equal(recovered.data.status, 'completed');
  },
);

test('real Pi: edits, explicit continuation, and exact model selection', live, async (t) => {
  const f = await createLiveFixture(t);
  const first = await callCompanion(f, 'task', {
    prompt: 'LIVE_WRITE_TASK: write implemented.txt, then report completion.',
    model: 'fixture/fixture-model',
    thinking: 'off',
    timeoutSeconds: 45,
  });
  assert.equal(first.code, 0, JSON.stringify(first));
  assert.equal(first.data.status, 'completed');
  assert.equal(first.data.model, 'fixture/fixture-model');
  assert.equal(first.data.thinking, 'off');
  assert.match(first.data.text, /Real Pi fixture passed/);
  assert.equal(
    fs.readFileSync(path.join(f.root, 'implemented.txt'), 'utf8'),
    'Written by the real Pi write tool.\n',
  );
  assert.ok(first.data.sessionID, JSON.stringify(first));
  assert.ok(first.data.sessionFile, JSON.stringify(first));
  assert.ok(fs.existsSync(first.data.sessionFile));

  const beforeResume = f.requests.length;
  const resumed = await callCompanion(f, 'task', {
    prompt: 'LIVE_RESUME_TASK: summarize the previous work.',
    resume: first.data.id,
    timeoutSeconds: 45,
  });
  assert.equal(resumed.code, 0, JSON.stringify(resumed));
  assert.equal(resumed.data.status, 'completed');
  assert.equal(resumed.data.sessionID, first.data.sessionID);
  assert.equal(resumed.data.sessionFile, first.data.sessionFile);
  assert.equal(resumed.data.model, first.data.model);
  assert.match(resumed.data.text, /Real Pi fixture passed/);
  const resumeRequests = f.requests.slice(beforeResume);
  assert.ok(resumeRequests.length > 0);
  assert.match(JSON.stringify(resumeRequests[0].messages), /LIVE_WRITE_TASK/);
  assert.match(JSON.stringify(resumeRequests[0].messages), /LIVE_RESUME_TASK/);
  assert.match(JSON.stringify(resumeRequests[0].messages), /Written by the real Pi write tool/);

  // Invalid selections must fail before sending a task to any provider.
  const beforeInvalid = f.requests.length;
  const unknown = await callCompanion(f, 'task', {
    prompt: 'Do not send this to a fallback model.',
    model: 'fixture/missing-model',
    timeoutSeconds: 45,
  });
  assert.notEqual(unknown.code, 0, JSON.stringify(unknown));
  assert.notEqual(unknown.data?.status, 'completed');
  assert.equal(f.requests.length, beforeInvalid);
  const thinking = await callCompanion(f, 'task', {
    prompt: 'Do not silently clamp unsupported thinking.',
    model: 'fixture/fixture-model',
    thinking: 'max',
    timeoutSeconds: 45,
  });
  assert.notEqual(thinking.code, 0, JSON.stringify(thinking));
  assert.notEqual(thinking.data?.status, 'completed');
  assert.equal(f.requests.length, beforeInvalid);
});

test('real Pi: config and hostile model calls cannot broaden review tools', live, async (t) => {
  const f = await createLiveFixture(t);
  git(f.root, 'init', '-q');
  git(f.root, 'config', 'user.name', 'Pi fixture');
  git(f.root, 'config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(f.root, 'review.txt'), 'before\n');
  git(f.root, 'add', 'review.txt');
  git(f.root, 'commit', '-qm', 'test: initial fixture');
  fs.writeFileSync(path.join(f.root, 'review.txt'), 'after\n');
  f.installHostileResources();

  const review = await callCompanion(f, 'review', {
    prompt: 'LIVE_REVIEW_ATTEMPT: review the change.',
    model: 'fixture/fixture-model',
    timeoutSeconds: 45,
  });
  assert.equal(review.code, 0, JSON.stringify(review));
  assert.equal(review.data.status, 'completed');
  assert.ok(f.attemptedForbiddenTool);
  assert.ok(f.requests.length >= 2, 'The rejected tool call should return to the model.');
  for (const request of f.requests) {
    assert.deepEqual(
      request.tools.map((tool) => tool.function.name).sort(),
      ['find', 'grep', 'ls', 'read'],
      'Only built-in read tools may reach the reviewer model.',
    );
  }
  assert.ok(
    f.requests.some((request) =>
      request.messages.some(
        (message) =>
          message.role === 'tool' &&
          /not found|not available|unknown|disabled/i.test(JSON.stringify(message)),
      ),
    ),
    'Pi must reject a provider-fabricated bash call.',
  );
  for (const name of [
    'forbidden-review-write',
    'project-extension-loaded',
    'global-extension-loaded',
    'mcp-started',
  ]) {
    assert.equal(fs.existsSync(path.join(f.root, name)), false, `Unexpected side effect: ${name}`);
  }
  assert.equal(fs.existsSync(path.join(f.base, 'project-chosen-session-dir')), false);
  assert.equal(fs.readFileSync(path.join(f.root, 'review.txt'), 'utf8'), 'after\n');
  assert.doesNotMatch(JSON.stringify(f.requests), /PROJECT_SYSTEM_OVERRIDE_LOADED/);
});
