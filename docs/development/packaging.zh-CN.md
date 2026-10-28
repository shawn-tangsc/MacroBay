[English](./packaging.md) | [中文](./packaging.zh-CN.md)

# 打包与发布

本文说明如何从这个仓库产出可分发桌面版本。

## 当前支持范围

- **macOS（arm64）**：`pnpm dist:mac` 产出未签名的 `.dmg`，已验证从挂载到看板正常渲染。
- **Windows（x64）**：`pnpm dist:win` 产出 NSIS 安装器。发布 workflow 在 `windows-latest` 上构建
  它，构建也已在 Windows 11 x64 真机上跑通。安装后的运行态尚未验收。
- **Linux**：尚未配置打包。

## CI 校验与发布

`.github/workflows/ci.yml` 在每次 push 到 `main` 和每个 PR 上运行，只做校验：`pnpm docs:check`、
typecheck、test、`pnpm build`。它不打包，所以日常 PR 不会为了一个 dmg 多等十分钟。

`.github/workflows/release.yml` 是唯一的打包入口，推送 `v*` tag 时运行：

```bash
git switch main
git pull --ff-only
git tag -a v0.1.1 -m "MacroBay 0.1.1"
git push origin v0.1.1
```

它在 `macos-latest` 上产出 `release/MacroBay-arm64.dmg`、在 `windows-latest` 上产出 NSIS
安装器，然后把这两个文件、各自的 blockmap 和自动更新元数据挂到同一个 GitHub Release。两条链路都
不需要签名密钥。

dmg 与安装器的文件名不含版本号，所以 README 可以长期链接
`releases/latest/download/MacroBay-arm64.dmg` 和 `.../MacroBay-x64-setup.exe`；任一名字变化，
打包 job 会直接失败。

- tag 必须是 `v` 加上 `package.json` 里的 `version`，否则 job 在打包前就停下——electron-builder 是
  按 manifest 而不是 tag 命名产物的。
- 对已有 release 的 tag 重跑，只替换 assets、保留原有说明，所以 tag 不用移动也能补救失败的运行。
- 产物未签名；Release 说明里写明 macOS 的 Gatekeeper 与 Windows 的 SmartScreen 放行方式。

想在打 tag **之前**确认打包没问题，用 **Actions → Release → Run workflow**，ref 填分支（或某个
commit），`publish` 不勾。两个安装包都会构建出来并留在该次运行的 artifacts 里，不动任何 Release。

两个构建必须分平台运行，因为智能体运行时的原生 CLI 是可选依赖，pnpm 只为宿主平台安装。合到一个
runner 上会让其中一个产物缺少可用的智能体。

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
pnpm dist:mac        # 先构建 bundle，再产出 release/MacroBay-arm64.dmg
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
3. `hdiutil verify release/MacroBay-arm64.dmg`，挂载后把应用拖进 Applications，再从那里
   启动。
4. `0.1.0` 在 arm64 上的参考体积：`.dmg` 约 184 MB，安装后约 550 MB。

## 打 Windows 包

```bash
pnpm dist:win        # 先构建 bundle，再产出 release/MacroBay-x64-setup.exe
pnpm dist:win:dir    # 先构建 bundle，只产出 release/win-unpacked/
```

前置条件：Windows 10/11 x64 主机、Node.js 22、pnpm 10。首次构建会下载 Electron 的 win32 发行包和
NSIS 打包器，之后的构建命中本地缓存。

请在 Windows 上执行，或交给发布 workflow 在打 tag 时完成。macOS 上通过 Wine 也能构建，但 pnpm 只在
Windows 上安装 win32 的智能体 CLI，交叉构建出来的安装器缺少这个二进制，智能体无法启动。所以
Windows 产物放在 `windows-latest` 上产出。

安装器默认按当前用户安装，允许选择安装目录，并创建桌面和开始菜单快捷方式。签名需要 Authenticode
证书（`CSC_LINK`、`CSC_KEY_PASSWORD`）；未签名的安装器会触发 SmartScreen 警告，需要用户自行放行。

### 安装器行为

`pnpm dist:win` 产出的是 NSIS **引导式**安装器（`oneClick: false`），不是一键静默安装。双击后依次是
「安装选项」→「安装位置」→「安装进度」→「完成」；安装选项可以在「为使用这台电脑的任何人安装」和
「仅为我安装」之间选择（`perMachine: false`）。安装器会创建桌面与开始菜单快捷方式，并在「应用和功能」
里注册卸载入口。

页头与侧栏图由 `resources/installerHeader.bmp`（150×57）和 `resources/installerSidebar.bmp`（164×314）
提供，对应 `nsis.installerHeader` / `nsis.installerSidebar`。这两个资源缺失时 MUI 页头是空白的，装出来
的界面会像「没有引导」。

`0.1.0` 在 Windows 11 x64 上的参考体积：安装器约 164 MB，解包目录约 613 MB，其中智能体原生 CLI
`claude.exe` 约 247 MB（不压缩，见上文 `asar: false`）。

### 验证一个 Windows 构建

1. `pnpm dist:win:dir`，运行 `release\win-unpacked\MacroBay.exe`：主窗口标题是 `MacroBay 观潮` 并能
   渲染看板。
2. 本地数据写入 `%APPDATA%\MacroBay`；关掉最后一个窗口进程即退出。
3. 双击 `release\MacroBay-x64-setup.exe`，确认四步引导都在、桌面与开始菜单快捷方式可用、
   「应用和功能」里有卸载入口。
4. 从开始菜单启动已安装版本，核对任务栏图标与分组、通知；卸载后 `%APPDATA%\MacroBay` 应当保留。

构建本身已在 Windows 11 x64 真机上跑通并产出安装器，但**安装后的运行态**还没有完成端到端验收。

## Linux

尚未配置。需要按同一份清单过一遍：图标资源、Linux target，以及在该 OS 上构建的 CI job。

## Windows 侧的遗留项

- `openWithSystemApp` 仍然调用 macOS 的 `open -a`，「用其他应用打开」的候选也都是 macOS 名字，
  Windows 上这些入口暂时不可用。
- 托盘图标是空图，在 Windows 上不可见。好在 Windows 上关闭最后一个窗口就退出，所以不阻塞使用，
  但也不算可用的托盘。

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
