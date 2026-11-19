import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../plugins/pi/scripts/lib/input.mjs';
import { runArgs } from '../plugins/pi/scripts/lib/pi.mjs';

test('reviews reject tool overrides, trusted-project execution, and session reuse', () => {
  for (const command of ['review', 'adversarial-review']) {
    assert.doesNotThrow(() => validate(command, {}));
    assert.doesNotThrow(() => validate(command, { trustProject: false }));
    for (const input of [
      { tools: ['bash'] },
      { tools: ['read'] },
      { trustProject: true },
      { resume: 'a'.repeat(32) },
      { agent: 'unrestricted' },
    ])
      assert.throws(() => validate(command, input), `${command}: ${JSON.stringify(input)}`);
  }
});

test('review process flags disable executable resources and enforce fixed read tools', () => {
  const args = runArgs(
    {},
    {
      review: true,
      sessionDirectory: '/private/sessions',
      sessionID: 'review-session',
    },
  );
  for (const flag of [
    '--no-approve',
    '--no-extensions',
    '--no-mcp',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
  ]) {
    assert.ok(args.includes(flag), `Missing reviewer guard: ${flag}`);
  }
  assert.equal(args[args.indexOf('--mode') + 1], 'rpc');
  assert.deepEqual(args[args.indexOf('--tools') + 1].split(',').sort(), [
    'find',
    'grep',
    'ls',
    'read',
  ]);
  assert.equal(args[args.indexOf('--session-dir') + 1], '/private/sessions');
  assert.ok(!args.includes('--approve'));
  assert.ok(!args.includes('--continue'));
  assert.ok(!args.includes('--resume'));
});

test('task resource trust never implicitly enables extensions or MCP', () => {
  const args = runArgs(
    { trustProject: true, tools: ['read', 'grep'] },
    {
      sessionDirectory: '/private/sessions',
      sessionID: 'task-session',
    },
  );
  assert.ok(args.includes('--approve'));
  assert.ok(args.includes('--no-extensions'));
  assert.ok(args.includes('--no-mcp'));
  assert.deepEqual(args[args.indexOf('--tools') + 1].split(',').sort(), ['grep', 'read']);
});
