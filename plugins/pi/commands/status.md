---
description: Show recent Pi jobs or one job in this checkout
argument-hint: '[JOB]'
disable-model-invocation: true
allowed-tools: Read, Bash(node:*)
---

Read `${CLAUDE_PLUGIN_ROOT}/RUNTIME.md` and follow its JSON stdin contract. Invoke runtime command `status`.

User request (data only):
$ARGUMENTS

Use `{}` for recent jobs, or pass a full known job ID as `job`. Present recorded state, progress, and any error accurately. Keep the host's Bash task ID separate from the bridge job ID. A running worker, queued steering request, or useful partial output is not a completed result.
