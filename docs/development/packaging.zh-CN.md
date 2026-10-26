[English](./packaging.md) | [中文](./packaging.zh-CN.md)

# 打包与发布

本文说明如何从这个仓库产出可分发桌面版本。

## 当前支持范围

- **macOS（arm64）**：`pnpm dist:mac` 产出未签名的 `.dmg`，已验证从挂载到看板正常渲染。
- **Windows / Linux**：尚未配置打包。Electron 代码能在这些平台以开发方式运行，但没有已验证的
  安装包。

## 构建应用 bundle

```bash
pnpm build
```

构建写出未打包的应用：

```text
out/main/       Electron 主进程
out/preload/    preload 桥
out/renderer/   React 渲染层
```

这是打包器的输入，不是可分发产物。

## 打 macOS 包

前置条件：macOS 主机、Node.js 22、pnpm 10，以及 Xcode 命令行工具（`hdiutil`）。

```bash
pnpm install
pnpm dist:mac        # 先构建 bundle，再产出 release/MacroBay-<version>-arm64.dmg
pnpm dist:mac:dir    # 先构建 bundle，只产出 release/mac-arm64/MacroBay.app
```

`dist:mac` 会先跑 `pnpm build`，因此产品注册表和 Vite bundle 一定是最新的。产物目录是
`release/`，已被 git 忽略。

### 包里有什么

- `out/` 下的 bundle 和 `package.json`；
- 根 `package.json` 的生产依赖（不含 devDependencies、测试和文档）；
- `resources/skills` 通过 `extraResources` 复制到 `Contents/Resources/skills`，打包态主进程正是
  从这里读取内置技能；
- `resources/icon.icns` 作为应用图标；
- 智能体运行时：`@anthropic-ai/claude-agent-sdk` 及其平台原生 CLI
  （`@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`，约 237 MB）。

### 为什么应用目录不归档（`asar: false`）

智能体运行时会把这个原生 CLI 作为独立进程启动，而 SDK 从自己的包目录解析该二进制。Node 无法执行
只存在于 asar 归档内部的文件，所以第一版打包输出的是未归档的应用目录。开启 asar 需要同时为 SDK
相关包配置 `asarUnpack`，并显式传入指向 `app.asar.unpacked` 的 `pathToClaudeCodeExecutable`；这是
一处独立改动，不是改一行开关。

### 签名与公证

`electron-builder.yml` 里的 `mac.identity: null` 让本地构建保持未签名。从网络下载的未签名构建会被
Gatekeeper 拦截，用户需要右键 → **打开**，或者执行：

```bash
xattr -dr com.apple.quarantine /Applications/MacroBay.app
```

要签名，设置 `CSC_LINK`/`CSC_KEY_PASSWORD`（或在钥匙串中安装身份），把 `identity: null` 换成该身份，
并启用 `hardenedRuntime`。公证还需要 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和
`APPLE_TEAM_ID`。两者都不属于本次发布范围。

### 其他架构

当前目标架构是 arm64，因为这是已验证的机器。构建 x64 或 universal 还需要智能体 CLI 对应平台的
可选包，pnpm 不会自动为其他平台安装它。先安装该可选包，确认
`node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/claude` 存在，再运行
`pnpm exec electron-builder --mac --x64`。

### 下载镜像（可选）

如果 Electron 或打包工具的下载超时，可以为单次命令指定镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
pnpm dist:mac
```

## 验证一个构建

1. `pnpm dist:mac:dir`，然后 `open release/mac-arm64/MacroBay.app`。
2. 主窗口标题是 `MacroBay 观潮` 并能渲染情报看板；本地数据写入
   `~/Library/Application Support/MacroBay`。
3. `hdiutil verify release/MacroBay-<version>-arm64.dmg`，挂载后把应用拖进 Applications，再从那里
   启动。
4. `0.1.0` 在 arm64 上的参考体积：`.dmg` 约 184 MB，安装后约 550 MB。

## Windows 与 Linux

尚未配置。每个平台都要按同一份清单过一遍：图标资源（`.ico`）、替换「用其他应用打开」里的 macOS
`open -a` 调用、跨平台的 `pnpm dev` 脚本，以及在该 OS 上构建的 CI job。

## 版本

`package.json` 当前是 `0.1.0`。首个公开版本需要定义：

- 应用和产品 manifest 的版本策略；
- changelog；
- 本地 `userData` 和数据库迁移的升级说明；
- macOS、Windows、Linux 的支持矩阵。

## 发布前验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm docs:check
```

然后在干净机器上安装产物，验证：

- 首次启动和模型服务配置；
- 一次真实智能体对话；
- 本地数据写入 `userData`；
- 日志中没有凭据和本地路径；
- 卸载和数据清除行为。

## 下一步

- [状态与限制](../reference/status-and-limitations.zh-CN.md)
- [测试](./testing.zh-CN.md)
