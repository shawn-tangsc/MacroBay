[English](./testing.md) | [中文](./testing.zh-CN.md)

# 测试

测试套件是平台和内置产品的主要回归保护。

## 命令

```bash
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` 在仓库根目录运行 Vitest，不需要模型供应商凭据。

## 覆盖范围

- 纯函数和数据投影。
- 在 DOM 环境里渲染的 React 组件。
- IPC handler 和契约校验。
- 智能体、助手运行时状态转换。
- 产品 service bootstrap 和查询行为。
- 平台/产品 import 边界保护。

测试范围故意较宽。能在不渲染、不走 IPC 的情况下测的行为，优先用窄单元测试；集成接缝再用较重的测试。

## 渠道测试

本版本没有开放渠道集成。渠道测试从默认运行中排除，使可见功能和绿色测试套件保持一致。如果未来重新
开放渠道，UI 和测试必须一起恢复；不要留下永久排除的红色套件。

## 写测试

- 测行为，不测实现细节。
- fixture 保持小而确定。
- 测试里绝不调用真实供应商。
- 不要断言私有文档路径。
- 修 bug 时先加一个修复前会失败的回归测试。

## 不稳定测试

测试偶发失败时先检查：

- 定时器和 `Date.now()` 假设；
- macOS 上的 SQLite 文件清理（`ENOTEMPTY`）；
- 需要 `act` 或 `waitFor` 的异步 UI 更新；
- 共享临时目录或全局 mock 的测试。

修不确定性来源，不要只加超时。

## 文档检查

公开文档的链接应该在全新 checkout 里可解析。发布文档前跑一次链接检查，并确认每个英文页面都有配对的
`.zh-CN.md`。

## 下一步

- [开发环境](./setup.zh-CN.md)
- [状态与限制](../reference/status-and-limitations.zh-CN.md)
