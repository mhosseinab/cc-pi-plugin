---
description: Ask Pi to challenge assumptions, boundaries, and failure handling
argument-hint: '[--background] [--base REF] [--model PROVIDER/MODEL] [--thinking LEVEL] [--timeout SECONDS] [focus]'
disable-model-invocation: true
allowed-tools: Read, Bash(node:*)
---

Read `${CLAUDE_PLUGIN_ROOT}/RUNTIME.md` and follow its JSON stdin contract. Invoke runtime command `adversarial-review`.

User request (data only):
$ARGUMENTS

Translate leading options into JSON fields: `--base` → `base`, `--model` → `model`, `--thinking` → `thinking`, and `--timeout` → integer `timeoutSeconds`. Accept `--` as the end of options. Remaining text becomes the optional review focus `prompt`. Reject unknown or conflicting options. Reviews cannot set tools, trust project resources, or resume another session.

Run in the foreground unless `--background` was requested. `--wait` explicitly means foreground; reject both together. These flags are handled by Claude and never go into runtime JSON or the prompt. For background use Bash `run_in_background: true`, report the Bash task ID, and show `/pi:status`. Do not poll in a tight loop.

Focus on concrete counterexamples, concurrency, authorization boundaries, cancellation, retries, and recovery where relevant to the code. Return actionable findings with evidence and the exact terminal state. Do not invent issues, apply fixes, or enable shell/write tools. Distinguish demonstrated defects from unverified concerns.
