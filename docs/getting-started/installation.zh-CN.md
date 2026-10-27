[English](./installation.md) | [中文](./installation.zh-CN.md)

# 安装

预编译的 alpha 安装包（macOS Apple Silicon、Windows x64）在
[Releases 页面](https://github.com/shawn-tangsc/MacroBay/releases)。本文说明如何从源码构建；要把构建结果变成可分发的 `.dmg` 或 Windows
安装器，见[打包](../development/packaging.zh-CN.md)。

## 环境要求

- **Node.js 22 或更高版本**
- **pnpm 10**
- 能运行 Electron 的桌面会话
- 一个模型供应商账号和 API Key，用于第一次真实对话

当前版本主要在 macOS 上开发和验证。Windows、Linux 尚未做完整端到端验证，请按实验性支持对待。

## 安装依赖

在仓库根目录执行：

```bash
pnpm install
```

请使用仓库声明的 pnpm 版本。跨大版本可能生成不同的 lockfile。

## 生成产品注册表

shell 通过生成的产品注册表加载产品：

```bash
pnpm generate:products
```

`pnpm dev`、`pnpm test`、`pnpm typecheck`、`pnpm build` 都会自动执行这一步，通常不需要手动运行。
生成文件位于 `products/generated/`，不提交到仓库。

## 开发模式运行

```bash
pnpm dev
```

该命令会同时启动 Electron 主进程和 Vite 渲染层。如果提示已有实例在运行，先关闭已打开的 MacroBay
窗口。

### 常见启动问题

- **端口被占用**：开发服务器会自动选择其他本地端口；窗口会使用当前端口。如果窗口空白，先看终端输出。
- **受限环境无法启动 Electron**：部分沙箱或远程 Linux 会话会阻止 Chromium sandbox。开发时请使用正常的
  桌面会话；不要在生产构建里关闭 sandbox。
- **大改动后窗口空白**：停止 `pnpm dev`，执行 `pnpm generate:products`，再重新启动。过期的生成注册表
  是常见原因。

## 构建应用 bundle

```bash
pnpm build
```

产物写入 `out/`：

```text
out/main/       Electron 主进程
out/preload/    preload 桥
out/renderer/   React 渲染层
```

这是未打包的构建结果。`pnpm dist:mac` 会把它封成 `.dmg`，`pnpm dist:win` 会封成 NSIS 安装器；前置
条件、签名与安装器自身的行为见[打包](../development/packaging.zh-CN.md)。

## 验证 checkout

```bash
pnpm typecheck
pnpm test
pnpm build
```

测试使用 Vitest。默认测试不要求模型供应商凭据。

## 下一步

- [第一次运行](./first-run.zh-CN.md)
- [模型服务](./model-service.zh-CN.md)
