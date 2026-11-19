# Architecture

Claude Code loads slash commands and a delegation skill. They send one JSON request to the installed Node CLI. The CLI launches a local Pi process in RPC mode, sends commands over stdin, and reads JSON-line responses and events from stdout.

The bridge has no listener, broker, MCP daemon, build step, or runtime npm dependencies. Pi owns model execution and tools; Claude owns scope, integration, and verification. The installed `plugins/pi` directory is self-contained.

## Runtime responsibilities

| Component       | Responsibility                                                                            |
| --------------- | ----------------------------------------------------------------------------------------- |
| `companion.mjs` | Command dispatch and machine-readable results                                             |
| `input.mjs`     | Request allowlists, types, bounds, and bounded stdin                                      |
| `process.mjs`   | Shell-free subprocesses, bounded capture, Git calls, owned process-group cleanup          |
| `state.mjs`     | Canonical worktree identity, private state, atomic writes, exclusive lock                 |
| Pi integration  | Version/capability checks, RPC transport, model/thinking selection, CLI resource controls |
| `events.mjs`    | Incremental UTF-8 JSON-line decoding and record limits                                    |
| `review.mjs`    | Safe Git scope extraction and review prompt                                               |
| `runner.mjs`    | Job lifecycle, output recording, controls, deadlines, and terminal states                 |
| `usage.mjs`     | Per-job session-entry accounting, partial event fallback, and cost/cache provenance       |

## Job lifecycle

The runner validates input, resolves the canonical worktree, acquires its lock, verifies Pi, prepares an explicit session, and configures model, thinking level, and tools before sending the task prompt. Unknown or incompatible selections fail visibly.

Task prompts are JSON protocol data, not process arguments or shell code. RPC command acknowledgments are separate from model events. The runner waits for `agent_settled` and checks final assistant state; `agent_end` can precede compaction, retry, or queued work and is not enough to finish a job.

One JSON result is emitted on stdout at completion. Startup identification and errors use stderr. Job records and event logs allow separate status/result commands to inspect an active or completed worker.

Continuation uses a recorded session from an explicit prior job in the same worktree. The prior job remains unchanged. Effective model, thinking level, and tools are inherited unless overridden. Project trust is never inherited.

Usage accounting captures a session-file cursor before the prompt and reads new entries after cleanup. `jobUsage` groups recorded assistant, tool, compaction, summary, warming, and other usage by kind, provider, and model. It keeps the main assistant cache-hit rate separate from other usage and labels estimated, provider-reported, mixed, or unknown costs. An unusable session-entry source falls back to recorded RPC events, including the latest unfinished streaming usage snapshot, with an incomplete report. Failed, cancelled, or timed-out work preserves known usage without claiming a complete cost. The existing `usage.scope: "session"` remains cumulative across resumes.

## Controls and concurrency

`steer` and `cancel` create requests consumed by the owning runner. Steering sends instructions to the active Pi session; acceptance of a control request is not proof that the model completed it. Cancellation clears queued work, requests abort, and terminates the owned process group. Deadlines and runner signals use the same cleanup boundary.

Only one worker holds a canonical worktree lock at a time. Separate Git worktrees can run in parallel. Other programs can still edit the files, so Claude must avoid concurrent edits in a worker's checkout.

Saved PIDs are diagnostic metadata, not authority to signal a process. Stale locks are not automatically stolen. Cleanup finishes before the lock is released; abrupt host death requires manual recovery.

## Review boundary

Reviews get a fresh session and the fixed tools `read,grep,find,ls`. Extensions and MCP are disabled. The bridge also disables skills, prompt templates, and themes, and skips protected project resources. Reviews cannot opt into project trust or resume another session.

Git evidence collection disables fsmonitor, executable content filters, external diff and textconv drivers. Working-tree reviews include staged/unstaged diffs and untracked filenames. Branch reviews use the merge base through `HEAD`; on-disk files may differ. Submodules are shown as gitlinks without inspecting nested working-tree changes. Review those separately. Oversized diffs fail explicitly.

Shared review instructions, target, and diff come before the normal or adversarial focus and optional user focus. This preserves the common prefix for unchanged evidence while keeping independent review sessions and tool restrictions. It creates an opportunity for provider prompt-cache reuse, not a guarantee of a hit.

Tool restrictions do not confine file reads to the worktree or sandbox Pi's trusted user-level configuration. The model can still encounter repository instructions and sensitive content. See [security](../SECURITY.md).
