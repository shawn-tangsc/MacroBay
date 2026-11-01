[English](./git-workflow.md) | [中文](./git-workflow.zh-CN.md)

# Git workflow

This document is the repository policy for branches, pull requests, merges, tags, releases, and
local Git configuration. It applies once the `main` ruleset is enabled in GitHub.

## Principles

- `main` is always releasable and always green.
- Changes land through short-lived branches and pull requests.
- A pull request stays reviewable: keep it to one area when you can, and bundle related work
  otherwise. While the project is maintained by a single person, a change set that spans one
  feature area is acceptable; unrelated areas still get their own pull request.
- Releases are tags and GitHub Releases, not long-lived branches.
- Published history is never rewritten.

## Branch model

`main` is the only permanent branch. There is no `develop` branch.

| Branch | Use |
| --- | --- |
| `main` | Protected integration branch; every commit is releasable |
| `feat/<slug>` | New user-visible capability |
| `fix/<slug>` | Bug fix |
| `docs/<slug>` | Documentation, screenshots, templates |
| `chore/<slug>` | Dependencies, build, cleanup |
| `ci/<slug>` | CI and release automation |
| `test/<slug>` | Test-only change |
| `refactor/<slug>` | Internal restructuring without behavior change |
| `release/<major.minor>` | Only when more than one minor line must be supported |
| `hotfix/<version>-<slug>` | Only when patching an older supported line |

Rules:

- Create every branch from the latest `main`.
- Use lowercase kebab-case; no personal or permanent branches.
- Keep a branch alive for days, not weeks.
- Delete the branch after merge.
- `release/*` and `hotfix/*` are introduced only when a second supported version exists. They are
  not part of the normal flow.

## Daily flow

```bash
git switch main
git pull --ff-only
git switch -c feat/source-health

# edit code and docs
pnpm docs:check
pnpm typecheck
pnpm test
pnpm build

git add <files>
git commit -m "feat: add source health summary"
git push -u origin feat/source-health
```

Before opening or updating a pull request:

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease
```

`--force-with-lease` is allowed only on your own topic branch, never on `main`.

## Pull requests

- One semantic change per PR. Do not mix a refactor, a rename, and a feature.
- Use a Conventional Commit prefix in the PR title:
  `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`, `refactor:`.
- The PR description follows the repository template.
- Keep the diff reviewable; if it grows beyond roughly 400 changed lines, split it.
- Add or update tests for behavior changes.
- Update public documentation when user-visible behavior changes.
- Do not commit generated registries, build output, local data, logs, credentials, or private notes.

A solo maintainer does not need another approval. GitHub does not allow self-approval, and the CI
check is the merge gate. When a second maintainer joins, require one approval.

## Merge policy

- Use **Squash and merge** only.
- Disable merge commits and rebase merging.
- The squash subject is the PR title, so the PR title must follow the commit convention.
- Require linear history on `main`.
- Delete the head branch after merge.

## `main` protection

Configure a GitHub ruleset or branch protection rule for `main`:

- Require a pull request before merging.
- Require the `verify` status check.
- Require branches to be up to date before merging.
- Require conversation resolution.
- Require linear history.
- Block force pushes.
- Block deletions.
- Do not require approvals while the project has one maintainer.
- Do not include administrators at first; turn this on after the CI path is stable.

Protect release tags with a tag ruleset for `v*`:

- Block tag deletion.
- Block tag updates.
- Never move a published tag; ship the next patch instead.

## Versioning and releases

Use Semantic Versioning:

```text
0.1.0         first alpha source release
0.1.1         patch
0.2.0         new capability
1.0.0         stable contract
0.2.0-alpha.1 pre-release
```

Release from `main` with an annotated tag:

```bash
git switch main
git pull --ff-only
git tag -a vX.Y.Z -m "MacroBay X.Y.Z (alpha)"
git push origin vX.Y.Z
```

Pushing the tag runs `.github/workflows/release.yml`, which builds the macOS dmg and the Windows
installer and creates the GitHub Release from them. Release assets are installers or archives; they are
not committed to Git. If that run fails after the tag exists, re-run it from
**Actions → Release → Run workflow** with the same tag: an existing release keeps its notes and only
gets its assets replaced.

Published tags are immutable. Do not move them; ship the next release as a new tag from current
`main`.

## Hotfixes

For the current supported line:

```bash
git switch main
git pull --ff-only
git switch -c fix/short-description
# fix, verify, PR, squash merge
git tag -a v0.2.3 -m "MacroBay 0.2.3"
git push origin v0.2.3
```

For an older supported line, only after a `release/<minor>` branch exists:

1. Branch `hotfix/<version>-<slug>` from that release branch.
2. PR into the release branch.
3. Tag the patch from the release branch.
4. Merge the fix back into `main`.

Do not create a release branch just to avoid the normal flow.

## Local Git configuration

Recommended global settings:

```bash
git config --global init.defaultBranch main
git config --global pull.rebase true
git config --global fetch.prune true
git config --global rebase.autoStash true
git config --global merge.conflictStyle zdiff3
git config --global push.default current
git config --global core.autocrlf input
```

Authentication: use the macOS keychain or SSH. Never put a personal access token in the remote URL.

```bash
# HTTPS + macOS keychain
git config --global credential.helper osxkeychain

# or SSH
git remote set-url origin git@github.com:shawn-tangsc/MacroBay.git
ssh -T git@github.com
```

### Commit identity

Current published history contains the maintainer's personal email. Do not rewrite published
history to remove it.

For future commits, enable GitHub's **Keep my email addresses private** setting and use the
GitHub-provided noreply address:

```bash
git config --global user.name "Shawn Tang"
git config --global user.email "<github-id>+shawn-tangsc@users.noreply.github.com"
```

Signing commits is optional. If enabled, use the same key consistently and do not require signed
commits until every contributor can satisfy the rule.

## Commit messages

Use an imperative subject with a Conventional Commit prefix:

```text
feat: add source health summary
fix: keep zero offset labelled as GMT
docs: document the Git workflow
ci: run verification on pull requests
```

Keep the subject under 72 characters. Use the body for why, trade-offs, and verification. Do not use
the body to restate the diff.

## Exceptions

The initial bootstrap commits on `main` are the only direct pushes:

```text
b99c952 Initial public release
7f01795 Add CI verification workflow
fb2e7dc Pin test timezone for CI
4f3e49b Normalize zero-offset timezone labels
```

After the `main` ruleset is enabled, even the maintainer uses a PR. If CI is unavailable, fix CI in a
branch first; do not bypass the protection rule as a routine path.

## Checklist

Before merge:

- [ ] Branch name follows the convention.
- [ ] One semantic change.
- [ ] `pnpm docs:check` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm build` passes.
- [ ] Public docs and screenshots are updated when needed.
- [ ] No credentials, local data, generated registries, or private notes are staged.
- [ ] PR title follows the commit convention.
- [ ] Branch is rebased on `main`.
