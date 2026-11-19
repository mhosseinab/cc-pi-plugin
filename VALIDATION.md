# Validation record

Date: 2026-11-19. Candidate: cc-pi-plugin 1.0.0.

## Environment

Linux, Node.js 24.22.3, Git 2.52.0, Pi 1.5.2, and Claude Code 2.1.310. Pi was installed from `@earendil-works/pi-coding-agent`. Tests used a deterministic local OpenAI-compatible provider with synthetic credentials; no paid or signed-in model request was made.

## Completed verification

- `PI_LIVE_BIN=<local Pi 1.5.2> npm run check`: ESLint, Prettier, and all **42 tests passed**, zero failures or skips.
- Real Pi edited a file, resumed an explicit session with prior history, rejected an unknown model and unsupported thinking, and reported provider authentication errors, token exhaustion, and timeouts accurately.
- Real review requests advertised only `read`, `grep`, `find`, and `ls`. A fabricated shell call was rejected. Project/global extensions and MCP remained unloaded; a project session-directory override was ignored.
- Process tests covered shell-like prompt text, Unicode framing, malformed RPC, retries, early exits, incomplete responses, bounded controls, concurrent-writer refusal, steering, cancellation ordering, interruption during startup, stubborn descendants, stale locks, and session ownership.
- Regression tests verified symlinked state-parent continuation and prevented Git fsmonitor, content-filter, and submodule-helper execution during evidence collection.
- Both marketplace and plugin passed `claude plugin validate --strict`.
- An isolated Claude configuration successfully installed `pi@cc-pi` 1.0.0 from the local marketplace, reported it enabled, and discovered all 11 commands plus the delegation skill. The cached plugin contained 26 regular files, no symlinks, and its runtime worked from an unrelated directory.
- Packaging and release tests verified synchronized versions, tagged release sources, complete tracked-source archives, checksums, path/symlink protections, Conventional Commit version selection, and a semantic-release commit/tag against an isolated local bare Git remote.
- Independent security review reproduced and verified fixes for the Git helper execution issue family. See [review evidence](docs/security-review.md).

## Limits and outstanding external checks

Local success does not establish live-provider quality, provider quota, or signed-in Claude orchestration. Linux was executed here; macOS and the Node 22 matrix are configured in CI and need their own green runs. Strict validation reported a separate optional catalog-icon advisory; installation and validation succeeded.

The installed bridge has no runtime npm dependencies. `npm audit --omit=dev` reported zero vulnerabilities. Development release tooling retains two moderate-severity advisories represented by 35 affected package entries, with no high or critical findings. A safe fixed bundled npm dependency graph was not available in the checked versions; see [dependency security](docs/dependency-security.md).

GitHub repository permissions, remote CI results, and production release publication must be checked separately. The local semantic-release test uses a disposable local remote and is not a GitHub publication.
