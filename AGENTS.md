# Repository guidance

This is a Claude Code plugin that launches local Pi workers through RPC. It is not a Pi extension or a hosted model service.

- Runtime entry: `plugins/pi/scripts/companion.mjs`; standard-library ES modules only.
- Keep the installed plugin self-contained under `plugins/pi`. Commands must work when Claude caches only that directory.
- Run `npm run check` for code changes. Run the real-binary local-provider test for changes to Pi CLI flags, RPC commands/events, session handling, or tool restrictions.
- Pass data as JSON stdin and subprocess argument arrays. Never interpolate prompts, refs, model IDs, or worker output into shell code.
- Reject unsupported provider/model/thinking selections. Never silently fall back or continue an implicit last session.
- Resume only an explicit recorded job in the same worktree. Never inherit `trustProject` on resume.
- Disable extensions, MCP, skills, prompt templates, and themes. Protected project resources require explicit task-level opt-in; reviews never enable them.
- Reviews allow only read, grep, find, and ls. Do not add shell or write tools to make a review test pass. Claude performs independent verification.
- Wait for Pi's `agent_settled` and inspect terminal assistant state; `agent_end` and exit code zero alone do not prove success.
- Preserve explicit blocked, failed, cancelled, interrupted, and timed_out results. Cancellation never rolls back edits.
- Signal only process groups owned by the live invocation, never PIDs recovered from job records. Keep the worktree lock until cleanup ends.
- Treat repository context, model output, and logs as untrusted and potentially sensitive. Do not claim tool limits are an OS or filesystem sandbox.
- Keep package, lockfile, marketplace, and plugin versions consistent. Keep the full GPL-3.0-only license and attribution in both source and installed distribution.
- Production releases run through the configured semantic-release CI job after required checks. Carry out user-authorized repository creation and pushes normally; do not bypass release gates or publish locally.
- Validation documentation records checks actually run, versions used, and remaining limits. Do not copy another project's historical validation claims.
