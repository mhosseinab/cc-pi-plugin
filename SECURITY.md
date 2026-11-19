# Security

This plugin runs a local coding agent with the permissions of your user account. Claude's permission settings do not automatically transfer to Pi. The bridge is not an OS sandbox.

## Worker configuration

Every worker disables Pi extensions, MCP, skills, prompt templates, and themes. Protected project resources are skipped by default through Pi's `--no-approve` behavior. A task can explicitly request `trustProject: true`; a resumed task must request it again. Reviews cannot opt in. That opt-in does not re-enable the resource categories the bridge disables.

This does not make all configuration inert. Pi still uses trusted user-level provider configuration and credentials. Credential helpers may execute commands, and global package resolution can occur before resource filtering. Project context such as `AGENTS.md` and `CLAUDE.md` can still enter the prompt. Use a separate user account or container when the runtime, repository, or global Pi configuration is not trusted.

The default task tool set is `read,bash,edit,write,grep,find,ls`. Supplying a smaller tool list restricts available built-in tools, not the capabilities of the process. In particular, `bash` can run other programs, access the network, or edit files. `read`, `grep`, `find`, and `ls` are not a filesystem boundary and may access paths outside the checkout. The bridge does not claim to filter every secret or prevent prompt injection.

Reviews use a fresh session and only `read,grep,find,ls`, with extensions and MCP disabled. This prevents the review model from using Pi's built-in shell/write tools through the allowed tool set. It does not isolate trusted Pi/provider code from the machine. Review findings remain claims for Claude to verify.

Before starting Pi, Git evidence collection disables fsmonitor, executable clean/smudge/process filters, external diff drivers, and text conversion. Submodule content is not recursively inspected: reviews show gitlink changes, and nested working-tree changes require a separate review. This avoids the demonstrated repository-helper execution paths described in [the implementation review](docs/security-review.md).

## Data handling

Prompts, review diffs, project context, and tool results may be sent to your selected model provider. Model selection changes where that information is processed. Do not include credentials or an entire Claude transcript in a task handoff.

The bridge stores job records, events, stderr, and Pi session data outside the checkout with private POSIX permissions. These records may contain prompts, file contents, paths, or other sensitive output. There is no general secret-redaction guarantee or automatic deletion policy. Keep state on a trusted local filesystem and share only sanitized excerpts. Pi may also keep its own configuration and provider data.

A source archive contains Git-tracked regular files and excludes generated directories. Review the tracked contents before publishing; a packaging allowlist cannot identify a secret that was intentionally committed.

## Process lifecycle

Only one bridge worker runs per canonical worktree. The lock does not stop Claude, a person, or unrelated tools from editing files.

Cancellation sends a request to the owning runner. The runner clears queued Pi work, requests abort, and terminates its owned process group. It never signals a PID loaded from a saved record. A process that deliberately escapes its process group is outside that cleanup guarantee.

Cancellation, timeout, and interruption can leave partial changes. Abrupt runner death can also leave orphaned processes and a stale lock. Do not delete that lock until you have checked for remaining work. See [runtime recovery](docs/runtime.md).

## Reporting a problem

Do not publish credentials or private logs in an issue. Use GitHub's private vulnerability reporting if the repository has enabled it; otherwise contact the maintainer through an independently verified private channel. No security email address is assumed.

When reporting a runtime bug, include the relevant versions, a minimal reproduction, the terminal job state, and sanitized errors. Development-tooling dependency findings are separate from the dependency-free installed runtime; see [dependency security](docs/dependency-security.md).
