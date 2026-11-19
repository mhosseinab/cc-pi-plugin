# Releases

The `release` job in `.github/workflows/ci.yml` runs only after a push to `main` passes the Linux/macOS Node 22/24 checks, Pi contract tests, and Claude Code manifest validation. Pull requests cannot publish. Release jobs are serialized and cannot cancel one another midway.

## Repository setup

1. Push the repository to GitHub with `main` as its default and release branch.
2. Allow GitHub Actions to use the release job's `contents: write` permission. The job uses GitHub's automatic `GITHUB_TOKEN`; it needs no npm token or additional secret when repository rules allow that token to push commits and tags.
3. If repository rules require pull requests or prohibit bot pushes and tags, use a dedicated GitHub App token whose actor is explicitly permitted by those rules. `contents: write` does not override branch protection. Keep the existing protections for human changes.
4. Use Conventional Commits. When squash merging, preserve the intended release type in the squash title and any `BREAKING CHANGE:` footer in its body.

CI uses Pi with a local mock provider. It exercises the real CLI and RPC protocol without sending requests to a paid model service. Separately, use a small task from your own Claude Code session to confirm your provider credentials and workflow.

## Release output

Semantic-release determines the next version, writes release notes and `CHANGELOG.md`, updates the package and plugin metadata, builds a source archive with a SHA-256 sidecar, commits the release metadata, tags that commit, and creates a GitHub Release with both files attached.

The release hook synchronizes:

- `package.json`.
- The root and root-package versions in `package-lock.json`.
- `plugins/pi/.claude-plugin/plugin.json`.
- The `pi` entry in `.claude-plugin/marketplace.json`.

Before the first release, the marketplace points to `./plugins/pi`, so installation does not depend on a tag that does not exist yet. During release preparation, its source becomes a `git-subdir` source for `plugins/pi` at `v<version>` in the actual repository from `GITHUB_REPOSITORY`. The catalog on `main` then points to the tagged release.

The source archive contains Git-tracked regular files, using current working-tree bytes so prepared metadata is included. It includes the root and installed plugin GPLv3 license files. Packaging excludes untracked and ignored local files and generated dependency, coverage, and distribution directories. It rejects symlinks and paths outside the checkout.

The root package is private. No npm publication plugin is configured. The GitHub release plugin's issue comments, PR comments, and release labels are disabled; the release job needs only repository contents write access. This workflow does not submit the plugin to Anthropic's official directory.

## Version rules

| Commit                                                         | Release               |
| -------------------------------------------------------------- | --------------------- |
| `fix: correct worker cancellation`                             | Patch                 |
| `feat: add a model selection option`                           | Minor                 |
| A commit with a `BREAKING CHANGE:` footer                      | Major                 |
| `docs:`, `test:`, or `chore:` without a breaking-change footer | No release by default |

With no prior release tag, the first releasable commit produces **1.0.0**, matching this repository's initial metadata. Subsequent versions come from commits after the latest release tag. Never move a published tag to a different commit.

## Install and update

Inside Claude Code:

```text
/plugin marketplace add mhosseinab/cc-pi-plugin
/plugin install pi@cc-pi
/reload-plugins
/pi:setup
```

For an update:

```text
/plugin marketplace update cc-pi
/plugin update pi@cc-pi
/reload-plugins
/pi:setup
```

GitHub marketplace installation works before a GitHub Release exists. Releases add immutable source selection, version history, and downloadable archives.

## Preview and recovery

After `npm ci`, preview a release from a checkout with the real origin and release history:

```bash
GITHUB_REPOSITORY=mhosseinab/cc-pi-plugin npm run release:dry-run
```

Provide `GITHUB_TOKEN` through the environment when required. A dry run checks access and determines the next version and notes, but skips release preparation and publication. Do not put tokens in source files or command arguments. Run live releases through the configured CI job.

To verify a downloaded archive, place it beside its checksum file and run one of:

```bash
# Linux
sha256sum --check cc-pi-plugin-1.0.0.tar.gz.sha256

# macOS
shasum -a 256 --check cc-pi-plugin-1.0.0.tar.gz.sha256
```

Use the filename for the version you downloaded. A checksum detects accidental corruption; it is not an independent signature of the publisher.

After a failed release, inspect the release commit, tag, GitHub Release, and assets before retrying. They are not one atomic transaction. If the tag exists but publication failed, recover the missing release or assets from that exact tag. A rerun may otherwise report no new releasable commits.

`tests/release.test.mjs` runs preparation, a dry run, metadata commit, tag push, archive/checksum creation, and a repeat no-op against an isolated local bare Git remote. It never publishes to GitHub and does not establish that the real repository grants release permissions.

References: [semantic-release with GitHub Actions](https://semantic-release.gitbook.io/semantic-release/recipes/ci-configurations/github-actions), [release commit plugin](https://github.com/semantic-release/git), [GitHub release plugin](https://github.com/semantic-release/github), and [Claude marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference).
