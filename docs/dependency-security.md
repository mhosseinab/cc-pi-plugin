# Dependency security

Audit date: 2026-11-19.

The installed plugin uses Node's standard library and declares no runtime npm dependencies. Pi and Claude Code are separately installed programs with their own dependencies and release processes. The repository's npm dependencies support development and release tooling.

## Verified audit result

From a clean `npm ci --ignore-scripts` install of this lockfile:

| Command                       | Result                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `npm audit --omit=dev --json` | Zero reported vulnerabilities                                                      |
| `npm audit --json`            | 35 moderate affected package entries, zero high or critical; two unique advisories |

The 35 entries include dependency propagation. They do not represent 35 different vulnerabilities. The remaining findings are in the development graph installed through `semantic-release` and its dependency on the npm publication tooling. This project does not configure npm publication, but that does not remove the installed packages or prove that every vulnerable path is unreachable.

## Remaining development findings

The lockfile pins the transitive npm CLI to 11.21.2. That package bundles its own dependency tree, including:

| Bundled package  | Reported advisory                                                                                                                                            | Patched version in the advisory |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| glob 13.0.6      | [GHSA-3g3m-2fjr-6pw4](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4): traversal may continue after cancellation                | 14.0.2                          |
| minimatch 10.2.5 | [GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249): pattern expansion can cause excessive CPU and memory use | 11.0.1                          |

For minimatch, npm's advisory range flags the bundled 10.2.5, while the maintainer's reproduction describes 10.2.6. This report records the audit finding; it does not claim an exploit has been demonstrated against this plugin.

The npm registry was also checked for newer candidates on the audit date. npm 11.21.3 and latest 12.2.3 still declare `glob ^13.0.6` and `minimatch ^10.2.5`; neither provides a supported dependency-range fix for these advisories. npm 12.2.3 also requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`, above this plugin’s minimum. The tested 11.21.2 override is retained rather than raising the Node requirement without resolving the findings.

A root override pins non-bundled minimatch to 11.0.1. npm does not apply that override inside npm's published bundled dependencies. The bundled findings remain visible. No audit suppression, installation-time patch, or unsupported transitive major replacement is used to hide them.

## Maintenance

This repository uses one package manager and one lockfile: npm and `package-lock.json`. Run:

```bash
npm ci --ignore-scripts
npm audit
npm audit --omit=dev
npm run check
```

When upgrading semantic-release, npm, or the override, inspect the resolved graph and rerun the package/release tests. Remove an override only after the normal resolution includes the patched version and the supported Node 22/24 checks pass. Dependabot is configured for monthly npm and GitHub Actions updates.

Tests of the release machinery use an isolated local Git remote. CI grants write access only to the release job after all test and manifest checks succeed. The release configuration disables automated issue and PR comments.
