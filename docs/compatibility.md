# Compatibility

The bridge accepts stable Pi versions **>=1.5.2 <2.0.0** and checks the required RPC behavior. It does not require an exact patch version. Prereleases and other major versions require separate verification.

Accepted versions and tested versions are different. Pi 1.5.2 is the initial contract baseline; inspect CI and the validation record for versions and environments actually exercised. Accepting a newer stable 1.x version is not a claim that every future release was tested.

| Component         | Requirement                                               |
| ----------------- | --------------------------------------------------------- |
| Pi package        | `@earendil-works/pi-coding-agent`                         |
| Pi binary         | `pi`, or an executable selected with `CC_PI_BIN`          |
| Pi version        | Stable `>=1.5.2 <2.0.0` plus required RPC capabilities    |
| Node.js           | `>=22.19.0`                                               |
| Claude Code       | Plugin support; validate manifests with the installed CLI |
| Git               | Required for reviews and worktree resolution              |
| Operating systems | POSIX process groups on Linux/macOS; WSL2 on Windows      |
| Provider          | Existing trusted Pi configuration and credentials         |

The older `@mariozechner/pi-coding-agent` package and other programs called `pi` are not this project's compatibility target. A matching binary name alone does not prove a compatible runtime.

## Model and thinking selection

Explicit models use `provider/model-id`, split at the first slash. Discovery, selection, and returned model identity are checked rather than relying on fuzzy CLI matching. Supported thinking levels are queried for the selected model before setting one. The known values are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; a model may support only a subset.

The bridge must reject an unsupported requested level instead of accepting Pi's automatic clamping. When options are omitted, it uses Pi's selected defaults and records the effective values for continuation.

## Contract checks

A meaningful real-binary test covers model selection, literal prompts, actual tool execution, explicit session continuation, review tool schemas, cancellation, and terminal events against a local deterministic provider. Mock process tests cover malformed and split events, failures, deadlines, controls, and locks.

For compatibility changes, inspect the versioned Pi CLI and RPC sources, run the real-binary tests, update CI, and record actual outcomes. Do not claim signed-in Claude usage, paid-provider access, model quality, or marketplace publication from a local mock-provider test.

References: [Pi 1.5.2 CLI](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/cli.md), [RPC](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/rpc.md), [RPC commands](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/rpc-commands.md), and [security](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/security.md).
