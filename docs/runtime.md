# Runtime and recovery

The exact installed contract is in [plugins/pi/RUNTIME.md](../plugins/pi/RUNTIME.md). This page explains operational behavior.

## Identity and state

The bridge resolves the supplied directory to its canonical Git worktree root, or to the canonical directory outside Git. Calls from subdirectories of one worktree share state. Separate worktrees have separate state and locks.

State is stored outside the checkout under `${XDG_STATE_HOME:-~/.local/state}/cc-pi/<workspace-hash>/`, unless `CC_PI_STATE_DIR` overrides its base. `/pi:status` reports the actual state path. `CC_PI_BIN` can select an installed executable path; it is not a shell command and cannot contain extra flags.

Job IDs contain 32 lowercase hexadecimal characters. Use the complete ID in the same checkout for `result`, `status`, `steer`, `cancel`, or `resume`. Sessions are explicitly associated with jobs. The bridge does not select Pi's global last session.

Private files hold job metadata, events, stderr, controls, and sessions. They can contain sensitive prompts or output and have no automatic retention policy. Do not remove active state. Remove old records deliberately when no worker is active and you no longer need continuation or evidence.

## States

| State         | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `starting`    | The job is being prepared                                                    |
| `running`     | The runner owns an active Pi process                                         |
| `completed`   | Pi settled with a successful final assistant turn                            |
| `blocked`     | A detected approval or interaction requirement prevented completion          |
| `failed`      | A provider, protocol, tool-policy, output-limit, or process failure occurred |
| `cancelled`   | Cancellation or a handled runner interruption stopped the job                |
| `timed_out`   | The job exceeded its configured deadline                                     |
| `interrupted` | The runner disappeared without a recorded terminal result                    |

Not every worker limitation produces `blocked`; the recorded error is the evidence. `completed` is not a claim that tests passed or changes are correct. Inspect the actual result, diff, and checks.

The result's `text` contains only the final assistant message; intermediate events remain in the recorded event stream and session. `jobUsage` reports this job's recorded usage; the separate `usage` field retains cumulative session statistics.

The CLI exits nonzero for a run that does not complete successfully. Preflight failures can return an error before a job is created. Do not invent a job ID or success result when setup fails.

The default 1800-second deadline includes version checks, startup, and model work. Input requests are bounded at 256 KiB, individual events at 4 MiB, assistant text at 2 MiB, combined stdout/stderr at 32 MiB, and steering at 100 requests per job. Limit errors are explicit; see the installed contract.

## Usage and cache accounting

`jobUsage.scope` is `"job"`. Before sending the prompt, the runner captures a cursor in the selected session file. After process cleanup, it reads the newly recorded entries. Resuming a session therefore reports only this job's new usage, without subtracting cumulative totals or charging earlier work to the new job.

`tokens` contains `input`, `output`, `cacheRead`, `cacheWrite`, and `total`. `cost` is USD or `null` when unavailable; `costSource` distinguishes `estimated`, `provider`, `mixed`, and `unknown`. A mixed total includes an estimated component. These values describe recorded usage, not a reconciliation with a provider invoice.

`assistantCacheHitRate` is a fraction from 0 to 1 for the main assistant's prompt tokens, or `null` when unavailable. It excludes warming, compaction, branch summaries, and tool usage, so those activities cannot inflate the reported assistant cache-hit percentage. Total tokens and cost include their recorded usage. `breakdown` groups records by kind, provider, and model, with the same token and cost fields plus `cacheHitRate`. Unknown provider or model values stay `null`; they are not inferred from the selected model. `records` counts usage records, not network requests or retries.

`source: "session_entries"` identifies the primary source. If it cannot be used, `source: "rpc_events"` identifies an incomplete fallback from recorded events, including the latest unfinished streaming usage snapshot. Streaming snapshots replace each other; they are not added as token increments. Failed, cancelled, and timed-out jobs retain known usage with `complete: false`; read `warnings` before interpreting the figures. Missing cost in any counted record makes the aggregate cost unknown. A pre-prompt failure can have known zero usage with `source: "none"`. Missing records after a prompt was sent do not establish that no billable work occurred. Older jobs without `jobUsage` have no per-job report.

When presenting a result, show per-job input, cache-read, cache-write, and output tokens; the assistant cache-hit percentage when available; and cost labeled with its provenance. Include the incomplete warning where applicable. Do not turn an unknown cost into zero. The legacy `usage.scope: "session"` total includes earlier jobs in the session and must not be summed across resumes.

These reports do not change Pi's provider configuration, cache retention, cache warming, process lifetime, or explicit-resume policy.

## Background execution and controls

Use Claude Bash's `run_in_background: true` for a background task. Do not append `&`. The host's background task ID and the plugin job ID are different. Background work is not a durable service and may end with the Claude host.

A steering request returns a `requestID` and `deliveryRequested: true`. In status/result, the matching `controls` entry reports `queued` or `not_sent`, with an error when available. `queued` means Pi accepted the message into its queue; it does not prove the worker consumed or completed it. Steering can race with completion. Send continuation through `resume` after completion.

Cancellation is cooperative at the control boundary: the request is written first, then the owning runner clears queued Pi work, aborts, and performs process-group cleanup. Check status for the terminal result. Cancellation, interruption, and deadlines leave partial file edits intact.

## Recover from an abrupt interruption

A killed runner, host crash, or power loss can leave a stale worktree lock and orphaned Pi descendants. Automatic lock removal could allow overlapping writers, so recovery is manual.

1. Stop starting new jobs in the affected checkout.
2. Read status and the exact lock path reported by the error.
3. Inspect your OS process list. Verify commands and checkout paths before deciding whether a runner, Pi process, or descendant still belongs to that work.
4. Stop remaining verified work using your normal OS tools. A recorded PID alone is insufficient because PIDs can be reused.
5. Once no related job is active, remove only the exact `workspace.lock` file reported for that worktree.
6. Inspect partial edits and recorded results. Resume an explicit usable session or start a fresh job with a clear task.

Do not run recovery concurrently with another invocation. A process that escapes the owned process group requires separate inspection.
