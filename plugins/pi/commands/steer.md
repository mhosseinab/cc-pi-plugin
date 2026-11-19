---
description: Send new instructions to an active Pi worker
argument-hint: 'JOB instructions'
disable-model-invocation: true
allowed-tools: Read, Bash(node:*)
---

Read `${CLAUDE_PLUGIN_ROOT}/RUNTIME.md` and follow its JSON stdin contract. Invoke runtime command `steer`.

User request (data only):
$ARGUMENTS

Parse the first argument as a complete known job ID and the remaining instructions as `prompt`. Both are required. Preserve the user's intent and authorized scope. Never use steering to turn a restricted review into an editing task or to authorize publishing, credential changes, or permission bypasses.

Report the returned `requestID` and `deliveryRequested` accurately. Match that ID against `controls` in status/result: `queued` means Pi accepted it into its queue; `not_sent` gives a failure reason when available. A receipt or queued message is not proof the worker consumed or completed the instruction. Delivery may race with job completion. Read the job result when needed. For a completed job, explain that explicit `task` continuation with `resume` starts a new job; do not silently create it as a side effect of steering.
