# Pi workers for Claude Code

Delegate implementation, investigation, and code review to local [Pi](https://pi.dev/) workers. Claude coordinates the work and verifies the result. Pi uses your existing provider configuration and credentials.

Requires Node.js 22.19+, stable Pi >=1.5.2 <2.0.0, and Claude Code plugin support. Git is required for reviews. Use Linux, macOS, or WSL2.

## Set up

If Pi is not installed, run this in a terminal:

```bash
npm install -g --ignore-scripts '@earendil-works/pi-coding-agent@^1.5.2'
pi
```

Use Pi's `/login` or configure your provider's API key. After loading this plugin, run inside Claude:

```text
/pi:setup
/pi:models
/pi:task Implement the agreed change and run its focused tests
```

Setup checks the runtime without making a model request. It cannot prove your credentials or quota work.

For development, start Claude with the absolute path to this directory using `claude --plugin-dir /path/to/cc-pi-plugin/plugins/pi`. Install from the GitHub marketplace with:

```text
/plugin marketplace add mhosseinab/cc-pi-plugin
/plugin install pi@cc-pi
/reload-plugins
/pi:setup
```

## Use

```text
/pi:task --model PROVIDER/MODEL --thinking high Investigate the failing test
/pi:task --background Implement the agreed change
/pi:status
/pi:steer JOB_ID Focus first on the cancellation case
/pi:result JOB_ID
/pi:task --resume JOB_ID Address the remaining failure
/pi:cancel JOB_ID
/pi:review
/pi:review --base main Focus on authorization
/pi:adversarial-review Challenge failure handling
```

Use exact model identifiers from `/pi:models` and complete job IDs. `--tools read,grep,find,ls` limits a task to those built-in tools. A requested thinking level must be supported by the selected model.

`/pi:rescue` delegates a difficult issue. `/pi:transfer` creates a concise task handoff from visible context. Foreground is the default; `--background` uses Claude's Bash background execution. One worker runs per worktree; separate worktrees can run concurrently.

## Boundaries

The bridge disables extensions, MCP, skills, prompt templates, and themes. Protected project resources are skipped by default. Tasks can explicitly opt in with `--trust-project`; reviews cannot, and continuation does not inherit that opt-in. Existing trusted user-level Pi configuration is still used and may execute credential helpers or resolve packages.

Reviews use fresh sessions with read/grep/find/ls only. These limits do not sandbox Pi or confine file reads to the checkout. Task tools include shell and write access by default. Claude's permission rules do not automatically transfer to Pi.

Results and sessions may contain sensitive information. Cancellation can leave partial changes. A completed turn is not proof of correctness; inspect the diff and independently verify changes.

See [RUNTIME.md](RUNTIME.md) for the complete JSON contract, controls, privacy, limits, and recovery. No plugin build or runtime npm install is required.

## License

GNU General Public License version 3 only (`GPL-3.0-only`). See [LICENSE](LICENSE) and [NOTICE](NOTICE) for terms and attribution.
