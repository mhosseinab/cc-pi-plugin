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
