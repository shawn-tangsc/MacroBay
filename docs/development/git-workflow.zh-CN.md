[English](./git-workflow.md) | [中文](./git-workflow.zh-CN.md)

# Git 工作流

本文是仓库的分支、PR、合并、tag、发布和本地 Git 配置规范。GitHub 上的 `main` 规则启用后，以本文
为准。

## 原则

- `main` 始终可发布、始终是绿的。
- 所有改动通过短分支和 PR 进入。
- PR 要控制在可审的范围内：能只做一个领域的就只做一个；同一功能领域内的相关改动可以合并提交。
  单人维护阶段允许多个相关改动的合集，但互不相关的领域仍然分开提。
- 发布用 tag 和 GitHub Release，不靠长期分支。
- 已发布的历史不重写。

## 分支模型

`main` 是唯一的长期分支，不设 `develop`。

| 分支 | 用途 |
| --- | --- |
| `main` | 受保护的集成分支，每个提交都可发布 |
| `feat/<slug>` | 新的用户可见能力 |
| `fix/<slug>` | Bug 修复 |
| `docs/<slug>` | 文档、截图、模板 |
| `chore/<slug>` | 依赖、构建、清理 |
| `ci/<slug>` | CI 和发布自动化 |
| `test/<slug>` | 只改测试 |
| `refactor/<slug>` | 不改变行为的内部重构 |
| `release/<major.minor>` | 只有需要并行维护多个 minor 时才建 |
| `hotfix/<version>-<slug>` | 只有修旧支持线时才建 |

规则：

- 所有分支从最新 `main` 切出。
- 用小写 kebab-case，不用个人分支或长期分支。
- 分支活几天，不活几周。
- 合并后删除分支。
- `release/*` 和 `hotfix/*` 只有在出现第二条受支持版本线时才引入，不进入日常流程。

## 日常流程

```bash
git switch main
git pull --ff-only
git switch -c feat/source-health

# 改代码和文档
pnpm docs:check
pnpm typecheck
pnpm test
pnpm build

git add <files>
git commit -m "feat: add source health summary"
git push -u origin feat/source-health
```

开 PR 或更新 PR 前：

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease
```

`--force-with-lease` 只允许用在自己的主题分支，永远不要对 `main` 用。

## Pull Request

- 一个 PR 只做一件语义上的事，不要混重构、改名和功能。
- PR 标题用 Conventional Commit 前缀：
  `feat:`、`fix:`、`docs:`、`chore:`、`ci:`、`test:`、`refactor:`。
- PR 描述按仓库模板写。
- diff 尽量可审；超过约 400 行就拆。
- 行为变化要加或更新测试。
- 用户可见行为变化要更新公开文档。
- 不提交生成注册表、构建产物、本地数据、日志、凭据或私有笔记。

单人维护不需要别人 approve；GitHub 不允许自己批准自己的 PR，CI 就是合并门禁。等有第二个维护者，
再要求 1 个 approval。

## 合并策略

- 只用 **Squash and merge**。
- 关闭 merge commit 和 rebase merge。
- squash 的标题就是 PR 标题，所以 PR 标题必须符合提交规范。
- `main` 要求线性历史。
- 合并后自动删除 head branch。

## `main` 保护

在 GitHub 为 `main` 配置 ruleset 或 branch protection：

- Require a pull request before merging
- Require the `verify` status check
- Require branches to be up to date before merging
- Require conversation resolution
- Require linear history
- Block force pushes
- Block deletions
- 单人阶段不要求 approvals
- 先不勾 Include administrators；CI 路径稳定后再打开

给 `v*` 加 tag ruleset：

- 禁止删除 tag
- 禁止更新 tag
- 已发布 tag 永不移动；发错了就发下一个 patch

## 版本与发布

使用 Semantic Versioning：

```text
0.1.0         首个 alpha 源码版
0.1.1         patch
0.2.0         新能力
1.0.0         稳定契约
0.2.0-alpha.1 预发布
```

从 `main` 打 annotated tag：

```bash
git switch main
git pull --ff-only
git tag -a v0.2.2 -m "MacroBay 0.2.2 (alpha)"
git push origin v0.2.2
```

推送该 tag 会触发 `.github/workflows/release.yml`，由它构建 macOS dmg 和 Windows 安装器并据此创建
GitHub Release。安装包或压缩包是 Release assets，不提交进 Git。如果 tag 已存在但这次运行失败，用
**Actions → Release → Run workflow** 填入同一个 tag 重跑：已存在的 release 保留原有说明，只替换
assets。

已发布的 tag 不可移动。不要移动它们；下一个版本从当前 `main` 打新 tag。

## 热修复

当前支持线：

```bash
git switch main
git pull --ff-only
git switch -c fix/short-description
# 修复、验证、PR、squash 合并
git tag -a v0.2.3 -m "MacroBay 0.2.3"
git push origin v0.2.3
```

旧支持线只有在已经有 `release/<minor>` 分支时才这样走：

1. 从 release 分支切 `hotfix/<version>-<slug>`。
2. PR 到 release 分支。
3. 从 release 分支打 patch tag。
4. 把修复合并回 `main`。

不要为了绕开正常流程而创建 release 分支。

## 本地 Git 配置

推荐的全局配置：

```bash
git config --global init.defaultBranch main
git config --global pull.rebase true
git config --global fetch.prune true
git config --global rebase.autoStash true
git config --global merge.conflictStyle zdiff3
git config --global push.default current
git config --global core.autocrlf input
```

认证用 macOS keychain 或 SSH。不要把 personal access token 写进 remote URL。

```bash
# HTTPS + macOS keychain
git config --global credential.helper osxkeychain

# 或 SSH
git remote set-url origin git@github.com:shawn-tangsc/MacroBay.git
ssh -T git@github.com
```

### 提交身份

当前已发布历史包含维护者的个人邮箱。不要为了移除它而重写已发布历史。

以后提交时，在 GitHub 开启 **Keep my email addresses private**，使用 GitHub 提供的 noreply 地址：

```bash
git config --global user.name "Shawn Tang"
git config --global user.email "<github-id>+shawn-tangsc@users.noreply.github.com"
```

提交签名是可选项。如果启用，就保持一致；在所有贡献者都能满足之前，不要强制要求签名。

## 提交信息

用祈使句 + Conventional Commit 前缀：

```text
feat: add source health summary
fix: keep zero offset labelled as GMT
docs: document the Git workflow
ci: run verification on pull requests
```

标题不超过 72 个字符。正文写为什么、权衡和验证方式，不要复述 diff。

## 例外

初始 bootstrap 提交是唯一允许的直接 push：

```text
b99c952 Initial public release
7f01795 Add CI verification workflow
fb2e7dc Pin test timezone for CI
4f3e49b Normalize zero-offset timezone labels
```

`main` 规则启用后，维护者也走 PR。CI 不可用时，先在分支修 CI，不要把绕过保护当成常规路径。

## 检查清单

合并前：

- [ ] 分支名符合规范。
- [ ] 只做一件语义上的事。
- [ ] `pnpm docs:check` 通过。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm test` 通过。
- [ ] `pnpm build` 通过。
- [ ] 需要时更新了公开文档和截图。
- [ ] 没有暂存凭据、本地数据、生成注册表或私有笔记。
- [ ] PR 标题符合提交规范。
- [ ] 分支已 rebase 到 `main`。
