import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Writable } from 'node:stream';
import semanticRelease from 'semantic-release';
import config from '../../release.config.mjs';

const [root, remote] = process.argv.slice(2);
const sink = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});
// The fixture must use its own Git branch, including when invoked by a PR workflow.
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith('GITHUB_') && !key.startsWith('RUNNER_'),
  ),
);
env.GITHUB_REPOSITORY = 'example/cc-pi-plugin';
env.CI = 'false';
for (const key of ['GITHUB_TOKEN', 'GH_TOKEN', 'GIT_ASKPASS', 'GIT_CONFIG_COUNT']) delete env[key];
// No GitHub API or other external publish plugin is invoked by this local integration test.
const plugins = config.plugins
  .filter((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== '@semantic-release/github')
  .map((plugin) =>
    plugin === '@semantic-release/release-notes-generator'
      ? './tests/fixtures/local-release-notes.mjs'
      : plugin,
  );
const options = { ...config, plugins, ci: false, repositoryUrl: `file://${remote}` };
const context = { cwd: root, env, stdout: sink, stderr: sink };
const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const preview = await semanticRelease({ ...options, dryRun: true }, context);
assert.equal(preview.nextRelease.version, '1.0.0');
assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), before);
assert.equal(fs.existsSync(path.join(root, 'dist')), false);
const result = await semanticRelease(options, context);
assert.match(result.nextRelease.notes, /add Pi delegation/);
const second = await semanticRelease(options, context);
assert.equal(second, false);
// Exercise the explicit minor release used for an upgraded tooling capability.
// Keep this entirely inside the fixture's local bare remote.
for (const args of [
  ['commit', '--allow-empty', '-m', 'feat: upgrade release tooling'],
  ['push', 'origin', 'main'],
])
  execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
const beforeMinor = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const minorPreview = await semanticRelease({ ...options, dryRun: true }, context);
assert.equal(minorPreview.nextRelease.version, '1.1.0');
assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), beforeMinor);
const minor = await semanticRelease(options, context);
assert.equal(minor.nextRelease.version, '1.1.0');
assert.match(minor.nextRelease.notes, /upgrade release tooling/);
assert.match(minor.nextRelease.notes, /compare\/v1\.0\.0\.\.\.v1\.1\.0/);
assert.equal(await semanticRelease(options, context), false);
console.log(
  `CC_RELEASE_RESULT ${JSON.stringify({ version: result.nextRelease.version, minorVersion: minor.nextRelease.version, repeatedRelease: second })}`,
);
