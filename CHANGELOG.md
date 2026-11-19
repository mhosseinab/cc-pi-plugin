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
