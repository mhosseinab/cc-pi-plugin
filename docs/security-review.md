# Implementation security review

Reviewed on 2026-11-19 before the initial release. This was an evidence-based implementation review using OWASP guidance, not a certification or a guarantee against upstream vulnerabilities.

## Confirmed and fixed

Git can execute configured helpers while collecting ostensibly read-only review evidence. Three paths were reproduced: a `core.fsmonitor` hook, clean/process content filters, and submodule-local filters reached through recursive diffs or status inspection. An attacker needs influence over a configured executable helper or the local Git configuration; a fresh clone alone does not satisfy that prerequisite.

These paths could run shell code before Pi's restricted review tools took effect. They were assessed as medium severity and corrected before packaging:

- Disable fsmonitor for every bridge Git invocation.
- Enumerate configured content-filter driver names without reading their values into output, then disable clean/smudge/process commands and required-filter enforcement for the invocation.
- Disable external diff and text-conversion drivers.
- Force short submodule diffs and skip nested working-tree inspection. Gitlink changes remain in scope; nested content needs a separate review.

Independent reproductions verified that helper marker files were no longer created while ordinary parent-repository diffs remained available. Regression tests cover all three paths.

## Other controls checked

The review covered JSON stdin and argument-array subprocesses, input and output budgets, model/thinking verification, explicit session ownership, canonical workspace paths, read-only review tool lists, disabled Pi extensions/MCP, RPC completion and failure handling, cancellation, private state, model-header redaction, and release/package configuration.

Real Pi tests confirmed that a model-generated `bash` call was unavailable during review, provider errors and token exhaustion did not become success, explicit continuation retained the intended session, and reduced tool lists remained reduced on continuation.

No remaining confirmed security defect was found in that bounded review. Trusted Pi configuration, credential helpers, model-provider processing, read access outside the checkout, processes escaping their process group, and abrupt host termination remain documented boundaries. See [SECURITY.md](../SECURITY.md). Development dependency advisories are recorded separately in [dependency security](dependency-security.md).
