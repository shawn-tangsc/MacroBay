[English](./packaging.md) | [中文](./packaging.zh-CN.md)

# 打包与发布

本文说明当前的构建产物，以及距离可分发桌面版本还缺什么。

## 当前构建

```bash
pnpm build
```

构建写出：

```text
out/main/       Electron 主进程
out/preload/    preload 桥
out/renderer/   React 渲染层
```

这是未打包的应用，适合本地开发和验证，不适合直接交给最终用户。

## 尚未包含

- `.dmg`、`.exe`、`.AppImage` 或 `.deb` 打包；
- 各平台应用图标；
- 代码签名和公证；
- 自动更新；
- 发布流水线。

在这些能力实现并验证之前，不要对外宣称项目有可下载安装包。

## 接入打包器

未来的打包改动应该：

1. 接入 `electron-builder` 或 Electron Forge 等打包器。
2. 声明 application id、产品名、图标和目标平台。
3. 让 Vite 输出路径与打包器 `files` 配置对齐。
4. 从安装包中排除本地数据、测试、文档和生成缓存。
5. 增加在目标 OS 上构建安装包的 CI job。
6. 签名身份放在 CI secret 中，绝不写入仓库文件。

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
