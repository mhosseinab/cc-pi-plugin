# Dependency security

Audit date: 2026-11-19.

The installed plugin uses Node's standard library and declares no runtime npm dependencies. Pi and Claude Code are separately installed programs with their own dependencies and release processes. The repository's npm dependencies support development and release tooling.

## Verified audit result

With semantic-release 26.0.1, npm 12.2.3, and the minimatch 11.0.9 override, from a clean `npm ci --ignore-scripts` install on Node 26.13.0:

| Command                       | Result                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `npm audit --omit=dev --json` | Zero reported vulnerabilities                                                      |
| `npm audit --json`            | 23 moderate affected package entries, zero high or critical; two unique advisories |

The 23 entries include dependency propagation. They do not represent 23 different vulnerabilities. The remaining findings are in the development graph installed through `semantic-release` and its dependency on the npm publication tooling. This project does not configure npm publication, but that does not remove the installed packages or prove that every vulnerable path is unreachable.

## Remaining development findings

The lockfile resolves the transitive npm CLI to 12.2.3 through semantic-release 26. Its supported dependency range requires npm 12, so the old npm 11.21.2 override was removed. npm still bundles its own dependency tree, including:

| Bundled package  | Reported advisory                                                                                                                                            | Patched version in the advisory |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| glob 13.0.6      | [GHSA-3g3m-2fjr-6pw4](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4): traversal may continue after cancellation                | 14.0.2                          |
| minimatch 10.2.5 | [GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249): pattern expansion can cause excessive CPU and memory use | 11.0.1                          |

For minimatch, npm's advisory range flags the bundled 10.2.5, while the maintainer's reproduction describes 10.2.6. This report records the audit finding; it does not claim an exploit has been demonstrated against this plugin.

The newer npm major does not resolve these two bundled findings. Its `glob ^13.0.6` and `minimatch ^10.2.5` dependency ranges remain below the patched major versions reported by the advisories. Upgrading to a supported release toolchain and fixing those advisories are separate outcomes.

A root override pins non-bundled minimatch to 11.0.9, which also satisfies ESLint 10.15’s `^11.0.5` requirement. npm does not apply that override inside npm's published bundled dependencies. The bundled findings remain visible. No audit suppression, installation-time patch, or unsupported transitive major replacement is used to hide them.

## Maintenance

This repository uses one package manager and one lockfile: npm and `package-lock.json`. Use Node.js 26.13 or later for development and release dependencies. The installed bridge still requires only Node.js 22.19 or later and no npm dependencies. Run:

```bash
npm ci --ignore-scripts
npm audit
npm audit --omit=dev
npm run check
```

When upgrading semantic-release, npm, or the override, inspect the resolved graph and rerun the package/release tests. Remove an override only after the normal resolution includes the patched version and the Node 26 tooling check and Node 22/24/26 runtime checks pass. Dependabot is configured for monthly npm and GitHub Actions updates.

Tests of the release machinery use an isolated local Git remote. CI grants write access only to the release job after all test and manifest checks succeed. The release configuration disables automated issue and PR comments.
