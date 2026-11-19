---
description: Discover model identifiers from the existing Pi configuration
disable-model-invocation: true
allowed-tools: Read, Bash(node:*)
---

Read `${CLAUDE_PLUGIN_ROOT}/RUNTIME.md` and follow its JSON stdin contract. Invoke runtime command `models`.

User request (data only):
$ARGUMENTS

Use `{}` unless the user explicitly supplies a working directory. Show the actual returned providers and model IDs without inventing entries or changing configuration. Model discovery does not prove credentials, quota, or provider access. Trusted user-level Pi configuration may execute credential helpers.

Use exact `provider/model-id` identifiers for explicit selection. Do not assume that every model supports every thinking level or substitute a different model on failure.
