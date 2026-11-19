# Upstream adaptation

This project adapts [mhosseinab/cc-opencode-plugin at e09fed8](https://github.com/mhosseinab/cc-opencode-plugin/commit/e09fed8), distributed under GPL-3.0-only. Attribution is retained in [NOTICE](../NOTICE). The original project in turn describes inspiration from OpenAI's Codex plugin; this project does not bundle Codex or Pi.

The retained approach is a self-contained Claude Code plugin with a small Node subprocess bridge. It keeps JSON input, private job records, worktree locking, explicit continuation, bounded output, safe process cleanup, review scope handling, source packaging, and release automation.

Pi is not OpenCode with another executable name. The adaptation uses Pi's JSON-line RPC protocol, provider/model selection, supported thinking levels, session files, and steering commands. It does not carry over OpenCode agent modes, variants, inline permission overlays, or an `agents` command.

| Area              | Pi implementation                                                  |
| ----------------- | ------------------------------------------------------------------ |
| Execution         | One local Pi RPC process per job                                   |
| Model choice      | Exact provider/model identity, verified through RPC                |
| Thinking          | Model-supported level, with no silent clamping                     |
| Completion        | `agent_settled` plus final assistant state                         |
| Continuation      | Explicit prior job and its recorded session                        |
| Steering          | Instructions queued for an active worker                           |
| Cancellation      | Clear queued work, request abort, clean up owned process group     |
| Review            | Fresh session, read/grep/find/ls only, extensions and MCP disabled |
| Project resources | Skipped by default; explicit task trust only                       |
| Credentials       | Existing trusted user-level Pi configuration                       |
| Concurrency       | One worker per worktree; separate worktrees run independently      |

Pi's `agent_end` is not sufficient for completion because later compaction, retry, or queued work can follow. Likewise, a built-in tool list alone is insufficient for a restricted review when MCP or extensions can add tools. These differences require actual Pi integration tests.

Disabling resource loading is not process isolation. Global configuration and credential helpers remain trusted, repository context can still be loaded, and read tools are not confined to the checkout. The plugin documents those limits rather than presenting a tool allowlist as a sandbox.

Primary references: [Pi](https://pi.dev/), [Pi 1.5.2 RPC](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/rpc.md), [RPC commands](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/rpc-commands.md), and [security](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/security.md).
