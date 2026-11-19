# Pi workers for Claude Code

Use Claude Code to plan and review the work, and let local [Pi](https://pi.dev/) workers carry it out. Each worker uses your Pi providers and credentials, with an optional model and thinking level for that task.

This is a **Claude Code plugin**, licensed under **GPL-3.0-only**. It adapts [cc-opencode-plugin](https://github.com/mhosseinab/cc-opencode-plugin) to Pi's RPC interface. There is no plugin build step or runtime npm dependency.

## Requirements

- Node.js **22.19+**.
- A stable Pi release **>=1.5.2 <2.0.0**, installed from `@earendil-works/pi-coding-agent`.
- Claude Code with plugin support.
- A configured Pi provider; Git for reviews and worktree detection.
- Linux, macOS, or WSL2. Native Windows process-group cancellation is not supported.

Install Pi in your terminal if needed:

```bash
npm install -g --ignore-scripts '@earendil-works/pi-coding-agent@^1.5.2'
pi
```

Inside Pi, use `/login` for a supported login provider, or configure your provider's API key as described in [Pi's documentation](https://docs.pi.dev/latest/configuration). The plugin uses that existing setup; it does not handle your passwords or install Pi automatically.

## Install from this checkout

From the repository root, start Claude Code with:

```bash
claude --plugin-dir ./plugins/pi
```

Then run:

```text
/pi:setup
/pi:models
/pi:task Fix the failing pagination test and run the focused checks
```

To work in another repository, start Claude there with the absolute path to `plugins/pi`:

```bash
claude --plugin-dir /absolute/path/to/cc-pi-plugin/plugins/pi
```

`/pi:setup` checks the local runtime and RPC interface. It makes no model request, so it does not prove your credentials or quota work. A small task checks provider access.

### Marketplace installation

Install it inside Claude Code:

```text
/plugin marketplace add mhosseinab/cc-pi-plugin
/plugin install pi@cc-pi
/reload-plugins
/pi:setup
```

## Delegate work

```text
/pi:task Implement the agreed API change and run its focused tests
/pi:rescue Investigate why the upload occasionally stalls after reconnecting
/pi:transfer Continue the current task using our decisions and acceptance criteria
/pi:review
/pi:adversarial-review Challenge the retry, cancellation, and rollback design
```

Select a model from `/pi:models`:

```text
/pi:task --model PROVIDER/MODEL --thinking high Investigate the memory leak
```

Replace `PROVIDER/MODEL` with an exact returned identifier. The bridge separates the provider at the first slash, so model IDs can contain additional slashes. An omitted model uses Pi's selection. Requested thinking levels must be supported by that model; the bridge does not silently substitute a level or provider.

Restrict an investigation to Pi's read tools:

```text
/pi:task --tools read,grep,find,ls Find the code that handles expired sessions
```

Task tools default to `read,bash,edit,write,grep,find,ls`. Reviews always use `read,grep,find,ls`, start a fresh session, and do not apply fixes or run tests. Claude verifies findings and runs checks separately.

### Background jobs, steering, and continuation

```text
/pi:task --background Implement the agreed pagination fix and run its tests
/pi:status
/pi:steer JOB_ID Prioritize the empty-page case; leave the public API unchanged
/pi:result JOB_ID
/pi:task --resume JOB_ID Address the remaining failing test
/pi:cancel JOB_ID
```

Use the full job ID returned by the bridge. Steering queues new instructions for an active worker; a delivery receipt is not proof that the requested change was completed. Resume starts a new job using the earlier job's explicit session and recorded model, thinking level, and tools. There is no automatic continuation of a global last session.

Background jobs use Claude's own Bash background execution and depend on its host process. One worker runs in each canonical worktree at a time. Use separate Git worktrees for concurrent tasks, then inspect and integrate their changes yourself. The lock cannot stop a person or another program from editing the same files.

## Commands

| Command                         | Purpose                                        |
| ------------------------------- | ---------------------------------------------- |
| `/pi:task`                      | Delegate implementation or investigation       |
| `/pi:rescue`                    | Delegate a difficult investigation or fix      |
| `/pi:transfer`                  | Hand off a task with a concise context summary |
| `/pi:review`                    | Review staged, unstaged, and untracked work    |
| `/pi:adversarial-review`        | Review assumptions and failure handling        |
| `/pi:setup`                     | Check Pi and the RPC interface                 |
| `/pi:models`                    | Discover available model identifiers           |
| `/pi:status [JOB_ID]`           | Show recent jobs or one job in this checkout   |
| `/pi:result JOB_ID`             | Read recorded output and the exact job state   |
| `/pi:steer JOB_ID instructions` | Send new instructions to an active worker      |
| `/pi:cancel JOB_ID`             | Request cancellation of a specific worker      |

Tasks accept `--model`, `--thinking`, `--tools`, `--resume`, `--timeout`, and `--trust-project`. Reviews accept `--model`, `--thinking`, `--timeout`, and `--base REF`, plus optional focus text. Both support `--background` and `--wait`; foreground is the default.

`--base REF` reviews committed changes from the merge base of `REF` and `HEAD` through `HEAD`. Local uncommitted changes are outside that scope:

```text
/pi:review --base main Focus on authorization and race conditions
```

## Configuration and boundaries

The bridge reuses your trusted user-level Pi provider configuration and credentials. It disables extensions, MCP, skills, prompt templates, and themes for every worker. By default it also uses Pi's `--no-approve` behavior to skip protected project resources. `--trust-project` explicitly permits protected project configuration for a task; it is never inherited on resume and is not available for reviews. The other disabled resource categories stay disabled.

Project context such as `AGENTS.md` or `CLAUDE.md` can still be read. User-level Pi configuration can include executable credential helpers or package resolution. Disabling tools or extensions is **not an OS sandbox**. Task workers with `bash` can run commands, and read tools are not confined to the checkout. Claude's permission rules do not automatically transfer to Pi. See [security](SECURITY.md) for the concrete boundaries.

Prompts, diffs, and tool results go to the selected model provider. Local session files and bridge logs can contain private information. Cancellation and timeouts stop work without rolling back file changes. A `completed` result means a full Pi turn settled successfully; it does not mean the code is correct or tests passed.

## Update

For a marketplace installation:

```text
/plugin marketplace update cc-pi
/plugin update pi@cc-pi
/reload-plugins
/pi:setup
```

Compatible stable Pi updates within the accepted range are allowed. Supported and tested versions are separate; see [compatibility](docs/compatibility.md).

## Development

Use Node.js **26.13 or later** for repository tooling and releases. The installed plugin still needs only Node.js **22.19 or later**. Runtime compatibility tests run separately on Node 22, 24, and 26 without development dependencies.

```bash
npm ci
npm run check
npm run test:coverage
PI_LIVE_BIN="$(command -v pi)" node --test tests/live.test.mjs
npm run package
```

The optional live contract test uses the real Pi binary and a deterministic local provider, with synthetic credentials. It checks the integration rather than model quality. See [contributing](CONTRIBUTING.md) and the actual test output for validation evidence.

The release workflow uses Conventional Commits and semantic-release after successful main-branch checks. It synchronizes versions, creates a tagged source archive, and publishes a GitHub release. It does not publish an npm package. See [releasing](docs/releasing.md).

More detail: [architecture](docs/architecture.md), [runtime and recovery](docs/runtime.md), [installed contract](plugins/pi/RUNTIME.md), [validation](VALIDATION.md), and [upstream adaptation](docs/upstream-analysis.md).

## License and attribution

GNU General Public License version 3 only (`GPL-3.0-only`). See [LICENSE](LICENSE) and [NOTICE](NOTICE). Adapted from `mhosseinab/cc-opencode-plugin`; Pi and Claude Code are separate projects with their own licenses and terms. This plugin is not affiliated with Anthropic or the Pi maintainers.
