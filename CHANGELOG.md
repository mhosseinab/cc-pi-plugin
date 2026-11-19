# [1.2.0](https://github.com/mhosseinab/cc-pi-plugin/compare/v1.1.0...v1.2.0) (2026-11-19)

### Features

- report per-job usage and improve review prompt reuse ([#6](https://github.com/mhosseinab/cc-pi-plugin/issues/6)) ([45a9249](https://github.com/mhosseinab/cc-pi-plugin/commit/45a924985980f5d52f015533a085ed401adfbad3))

# [1.1.0](https://github.com/mhosseinab/cc-pi-plugin/compare/v1.0.0...v1.1.0) (2026-11-19)

### Features

- upgrade plugin release tooling to semantic-release 26 ([#4](https://github.com/mhosseinab/cc-pi-plugin/issues/4)) ([567bfde](https://github.com/mhosseinab/cc-pi-plugin/commit/567bfde5f54094ccd666f87eb4776bc85528ae8d))

# 1.0.0 (2026-11-19)

### Bug Fixes

- tolerate job metadata publication during status queries ([5c2c42d](https://github.com/mhosseinab/cc-pi-plugin/commit/5c2c42d2da06cdc8077137b492f7c531d9ab87df))

### Features

- add GPLv3 Pi workers plugin for Claude Code ([261fb79](https://github.com/mhosseinab/cc-pi-plugin/commit/261fb7993f41fb36cfb203baa672612dd2f3595c))

# Changelog

## 1.0.0

Initial Pi adaptation of the Claude Code worker plugin.

- Local Pi workers controlled through JSON-line RPC.
- Per-task provider/model, thinking level, and built-in tool selection.
- Background jobs, explicit session continuation, steering, cancellation, status, and recorded results.
- Fresh review sessions restricted to read, grep, find, and ls.
- Self-contained Claude commands and delegation skill.
- Worktree locking, bounded logs, process-group cleanup, and explicit failure states.
- GPL-3.0-only licensing, source packaging, and semantic-release configuration.

Publication and validation status are recorded by the repository's release and CI results; this entry alone does not assert a published release.
