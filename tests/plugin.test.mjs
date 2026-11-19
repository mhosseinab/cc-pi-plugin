import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const read = (file) => fs.readFileSync(file, 'utf8');
test('marketplace, package and installed plugin versions agree', () => {
  const pkg = JSON.parse(read('package.json'));
  const manifest = JSON.parse(read('plugins/pi/.claude-plugin/plugin.json'));
  const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(pkg.license, 'GPL-3.0-only');
  assert.equal(manifest.license, pkg.license);
  assert.equal(read('LICENSE'), read('plugins/pi/LICENSE'));
  assert.match(read('LICENSE'), /GNU GENERAL PUBLIC LICENSE/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(marketplace.plugins[0].version, pkg.version);
  assert.equal(marketplace.plugins[0].name, manifest.name);
  const source = marketplace.plugins[0].source;
  if (typeof source === 'string') assert.equal(source, './plugins/pi');
  else {
    assert.equal(source.source, 'git-subdir');
    assert.equal(source.path, 'plugins/pi');
    assert.equal(source.ref, `v${pkg.version}`);
    assert.match(source.url, /^https:\/\/github\.com\/.+\/.+\.git$/);
  }
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
});

test('installed commands and delegation skill use the self-contained runtime contract', () => {
  for (const command of [
    'task',
    'rescue',
    'review',
    'adversarial-review',
    'transfer',
    'setup',
    'status',
    'result',
    'cancel',
    'steer',
    'models',
  ]) {
    const text = read(`plugins/pi/commands/${command}.md`);
    assert.match(text, /disable-model-invocation: true/);
    assert.match(text, /CLAUDE_PLUGIN_ROOT.*RUNTIME.md/);
    assert.doesNotMatch(text, /companion\.mjs.*\$ARGUMENTS/);
  }
  assert.match(read('plugins/pi/skills/delegation/SKILL.md'), /independently run/);
  assert.match(read('plugins/pi/RUNTIME.md'), /workspace.lock/);
});
