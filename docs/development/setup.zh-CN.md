[English](./setup.md) | [中文](./setup.zh-CN.md)

# 开发环境

本文面向修改 MacroBay 本身的贡献者。

## 环境要求

- Node.js 22+
- pnpm 10
- 能运行 Electron 的桌面会话

## 安装与运行

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会重新生成产品注册表，并启动 Electron 和 Vite 渲染层。

## 仓库结构

```text
apps/desktop-shell/   Electron 宿主和 React shell
platform/             通用 AI 运行时和桌面能力
products/             可拆卸产品模块
products/generated/   生成的产品注册表（忽略）
scripts/              构建与仓库工具
docs/                 公开文档
```

## 命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 开发模式运行桌面应用 |
| `pnpm build` | 构建 main、preload、renderer 到 `out/` |
| `pnpm typecheck` | TypeScript 项目检查 |
| `pnpm test` | Vitest 测试 |
| `pnpm generate:products` | 重新生成产品注册表 |
| `pnpm lint` | 当前等同于 `pnpm typecheck` |

## 边界

- `platform` 不得 import `products`。
- `products` 可以 import `platform`。
- `apps/desktop-shell` 通过生成注册表加载产品。
- 产品专属提示词、数据源和页面留在产品内。
- 不要提交 `products/generated/*`、本地数据库、日志或凭据。

## 改动位置

| 改动 | 位置 |
| --- | --- |
| 模型供应商行为 | `platform/ai/providers` |
| 智能体运行时 | `platform/ai/agent-platform` |
| shell 导航或通用 UI | `apps/desktop-shell/src/renderer/src/shell` |
| 市场情报行为 | `products/market-intelligence` |
| 公开文档 | `docs/` |

## 提交 PR 前

```bash
pnpm typecheck
pnpm test
pnpm build
```

保持代码树可构建。如果改动涉及受保护的平台接缝，例如 `platform/desktop/main/app.ts`、
`preload/index.ts` 或 IPC channels，请保留现有的智能体、助手和产品接线，并补充回归保护。

## 下一步

- [测试](./testing.zh-CN.md)
- [新增产品](./adding-a-product.zh-CN.md)
- [架构](../platform/architecture.zh-CN.md)
