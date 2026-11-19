# Validation record

Date: 2026-11-19. Candidate: cc-pi-plugin 1.2.0.

## 1.2.0 verification

- On Linux with Node.js 26.13.0 and Pi 1.5.2, `PI_LIVE_BIN=<local Pi> npm run check` passed ESLint, Prettier, and all **58 tests**, with no failures or skips. Provider tests used only a deterministic local service with synthetic credentials.
- Real Pi usage normalization reported 70 tokens for a two-turn job, then 35 tokens for each continuation while session totals reached 105 and 140. Continuing from the original ancestor job counted only the newest work, and the original saved report remained unchanged. These are synthetic accounting checks, not measured provider cache savings.
- Regression coverage includes failed attempts and retries, cancellation and timeouts, partial streaming usage, missing or rewritten session logs, symlink refusal, missing costs, provider-reported versus estimated costs, and warming/compaction without double counting. Cache-hit calculations exclude warming and summaries from main assistant usage.
- Normal, adversarial, and custom-focus reviews share the exact instruction/evidence prefix for unchanged worktree and committed-branch diffs. Real Pi still advertised only the four read tools and rejected a fabricated shell call.
- Both marketplace and plugin passed Claude Code 2.1.310 strict validation. `npm run package` built the tracked-source archive. The validator's separate optional catalog-icon advisory remains unchanged.
- An independent implementation review found and verified fixes for unfinished streaming usage and unknown-cost propagation; no blocking findings remained.

Production publication uses the existing CI release gate. The historical verification below records the earlier release baseline and does not replace the new candidate's CI results.

## 1.1.0 environment

The 1.1.0 tooling checks ran on Linux with Node.js 26.13.0, Git 2.52.0, and Pi 1.5.2. The preceding 1.0.0 checks used Node.js 24.22.3 and Claude Code 2.1.310. Pi was installed from `@earendil-works/pi-coding-agent`. Tests used a deterministic local OpenAI-compatible provider with synthetic credentials; no paid or signed-in model request was made.

The repository's development and release dependencies require Node.js 26.13 or later. The installed plugin still requires Node.js 22.19 or later and has no runtime npm dependencies.

## Completed verification

- `PI_LIVE_BIN=<local Pi 1.5.2> npm run check`: ESLint, Prettier, and all **43 tests passed**, zero failures or skips.
- Real Pi edited a file, resumed an explicit session with prior history, rejected an unknown model and unsupported thinking, and reported provider authentication errors, token exhaustion, and timeouts accurately.
- Real review requests advertised only `read`, `grep`, `find`, and `ls`. A fabricated shell call was rejected. Project/global extensions and MCP remained unloaded; a project session-directory override was ignored.
- Process tests covered shell-like prompt text, Unicode framing, malformed RPC, retries, early exits, incomplete responses, bounded controls, concurrent-writer refusal, steering, cancellation ordering, interruption during startup, stubborn descendants, stale locks, and session ownership.
- Regression tests verified symlinked state-parent continuation and prevented Git fsmonitor, content-filter, and submodule-helper execution during evidence collection.
- The first remote macOS/Node 22 run exposed a status race during job creation. Status discovery now skips a job directory until its metadata is published, while still rejecting corrupt metadata. A deterministic regression covers the startup window.
- Both marketplace and plugin passed `claude plugin validate --strict`.
- As the installation baseline, isolated Claude configurations successfully installed `pi@cc-pi` 1.0.0 from both the local and published GitHub marketplace, reported it enabled, and discovered all 11 commands plus the delegation skill. The cached plugin contained 26 regular files, no symlinks, and its runtime worked from an unrelated directory.
- Packaging and release tests verified synchronized versions, tagged release sources, complete tracked-source archives, checksums, path/symlink protections, and Conventional Commit version selection.
- With semantic-release 26.0.1, the release fixture performed an initial 1.0.0 release and an actual 1.0.0 to 1.1.0 minor release against an isolated local bare Git remote. Both dry runs left metadata unchanged, and repeat runs created no release. Assertions inspect the tagged plugin and marketplace versions, tagged source reference, and plugin manifest inside the archive.
- The fixture runs the real release-notes generator, including the 1.0.0-to-1.1.0 comparison link, using synthetic HTTPS links while keeping Git publication entirely local.
- All four dependency updates were reviewed together. ESLint 10.15.0 resolves minimatch 11.0.9 within its declared range. Semantic-release 26 uses its supported npm 12 dependency graph; the obsolete npm 11 override was removed.
- Independent security review reproduced and verified fixes for the Git helper execution issue family. See [review evidence](docs/security-review.md).

## CI and publication evidence

The published 1.0.0 baseline passed its [Linux/macOS Node 22/24 CI and production release](https://github.com/mhosseinab/cc-pi-plugin/actions/runs/44577393429). The original dependency PR failures came from branches that omitted the startup-race fix; refreshed branches include that fix and its deterministic regression.

For 1.1.0, CI requires a full Node 26 tooling check, dependency-free runtime tests and real Pi contract tests on Linux/macOS with Node 22/24/26, latest Pi checks on Node 26, and strict Claude manifest validation. The production release job depends on all of those jobs and runs only after a push to `main`. Exact remote results belong to the corresponding [PR checks](https://github.com/mhosseinab/cc-pi-plugin/pull/4/checks) and [Actions runs](https://github.com/mhosseinab/cc-pi-plugin/actions/workflows/ci.yml); a local fixture is not evidence of GitHub publication.

## Limits

Local mock-provider success does not establish live-provider quality, provider quota, or signed-in Claude orchestration. Strict validation reported a separate optional catalog-icon advisory; installation and validation succeeded.

`npm audit --omit=dev` reported zero vulnerabilities. Development release tooling retains two moderate-severity advisories represented by 23 affected package entries, with no high or critical findings. The changed dependency graph reduces the entry count from 35 without fixing those two bundled npm findings; see [dependency security](docs/dependency-security.md).
