# Contributing

Use Node.js **26.13 or later** for development and releases; semantic-release 26 requires this version. Install development dependencies with `npm ci`, then run `npm run check` before submitting a change.

The installed plugin still runs on Node.js **22.19 or later** and uses only Node's standard library. Keep runtime npm dependencies at zero. `npm run test:runtime` needs no dependency installation and exercises the bridge on Node 22/24/26 in CI. The full check, including the release integration test, runs on Node 26.

For Pi CLI, RPC, session, or tool-policy changes, run the real-binary contract test:

```bash
PI_LIVE_BIN="$(command -v pi)" node --test tests/live.test.mjs
```

That test uses a deterministic local provider and synthetic credentials. Do not put paid model credentials into fixtures or CI. State exactly which tests ran and which environments were not checked.

Add regression coverage for meaningful behavior changes: process lifecycles, fragmented or malformed events, provider failures, terminal-state classification, explicit job/session mapping, tool restrictions, steering races, cancellation, concurrency, and output limits. A zero exit code or `agent_end` alone is not successful completion; the runtime must wait for `agent_settled` and inspect the final assistant state.

Keep commands thin. Runtime code validates requests and enforces rules; Claude supplies context and independently verifies changes. All task data travels through JSON stdin and argument arrays. Do not interpolate model output, prompts, or Git refs into shell commands.

Do not add hidden provider fallback, implicit session continuation, project trust, automatic recovery, pushes, or publishing. Do not weaken review tools to run tests. Keep `trustProject` explicit for each task, including continuation.

Use Conventional Commits such as `fix: preserve cancellation state` or `feat: add a worker control`. Describe the problem, resulting behavior, and actual validation evidence. Release automation is documented in [docs/releasing.md](docs/releasing.md).

Keep the installed subtree self-contained and its license/attribution intact. Changes are distributed under GPL-3.0-only. See [LICENSE](LICENSE), [NOTICE](NOTICE), and [repository guidance](AGENTS.md).
