[English](./install-verification.md) | [中文](./install-verification.zh-CN.md)

# 安装验收记录（打包产物）

这一页只回答一个问题：**某个打包产物真的被装上、被用过吗，验到哪一步？** README、
[状态与限制](../reference/status-and-limitations.zh-CN.md) 与[打包](./packaging.zh-CN.md) 里能写什么，
只以这一页为依据。**这里没有记录，就等于没验收。**

## 什么样算一条记录

- **谁**（人）、**什么机器**（型号、芯片、系统版本）、**哪个产物**（版本号、文件名、提交）、
  **每一步做了什么**（挂载 → 拖进「应用程序」→ 首启 → 看版本行 → 看看板 → 发一次对话）、
  **结果**，以及证据在哪（日志行、截图、issue 链接）。
- `dist:*` 跑通只是**构建级**。只有人把包装上并用了，这一行才算「已安装」。

## 各平台状态

| 平台 | 版本 | 证据 | 状态 |
|---|---|---|---|
| macOS arm64 | 0.4.0 | 用户，Apple 芯片 Mac；0.4.1 的跟踪记录里两条缺陷报告写明截图来自**装好的 0.4.0 安装包** | 装过、用过；不是一次正式验收 |
| macOS arm64 | 0.4.1 – 0.4.3 | 无 | 0.4.1 起没有真机安装 |
| macOS arm64 | 0.4.4（准备中） | 下面 2026-11-19 那一次 | 构建级通过；真机安装待做 |
| macOS x64 | 0.4.x | CI dry run `42605502965`（2026-11-09）：`MacroBay-x64.dmg` 203,351,759 B、`hdiutil verify` VALID、主程序与包内 CLI 均 `x86_64` | 未在 Intel 真机安装（用户已认领这项验收） |
| Windows x64 | 0.4.x | CI 可构建；Windows 11 x64 机器上构建跑通（据打包文档记载） | 安装后运行态未验收；缺 Windows 环境 |

## 2026-11-19：arm64 包的构建级检查（0.4.4 准备）

- 机器：Apple 芯片（`uname -m` = `arm64`），macOS 14.4。
- 提交 `07f45eb`；构建时工作区还有 **10 个别的线的未提交路径**，所以这不是干净树的产物。
- `pnpm dist:mac` → 退出码 0，6 分 00 秒。
- 产物 `release/MacroBay-arm64.dmg`，**268,626,471 字节**；`hdiutil verify` → `checksum … is VALID`。
- `release/mac-arm64/MacroBay.app/Contents/MacOS/MacroBay` → `Mach-O 64-bit executable **arm64**`；
  `Info.plist` 的 `CFBundleShortVersionString` = `0.4.3`（版本号在这之后才 bump）。
- 包内智能体 CLI `…/claude-agent-sdk-darwin-arm64/claude` → **arm64**。
- 同一个包里还带着 `claude-agent-sdk-darwin-x64/claude`（`x86_64`），因为这台机器的 `node_modules`
  里还留着 2026-11-09 做 Intel 验证时放的 x64 变体；arm64 上干净安装不会有它，发布用的 arm64 job
  也是在新跑起来的 arm64 runner 上重新装依赖。
- **没有做的：没有安装、没有启动。** 团队规矩：只有人才能启动应用。

## 这次检查暴露的缺口

1. arm64 的发布作业只断言「runner 是 arm64」，**没有断言 `.dmg` 里的 CLI 也是 arm64**——只有 x64
   作业有那条断言。所以本机构建可能带着错架构的 CLI 而看起来一切正常。
2. Apple 芯片真机自 0.4.1 起没有安装记录。
3. Windows 的安装与运行态：没有环境，因此没有验收。

## 以后怎么补一条

写清版本与产物、机器、谁、每一步和结果，并附证据链接。打包改动需要时可以在本页加一节构建级记录；
构建级永远不能把某个平台变成「已安装」。
