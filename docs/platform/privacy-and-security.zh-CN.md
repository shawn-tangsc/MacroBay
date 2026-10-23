[English](./privacy-and-security.md) | [中文](./privacy-and-security.zh-CN.md)

# 隐私与安全

MacroBay 是本地优先应用。没有 MacroBay 账号、没有托管工作区，也没有产品分析埋点。

## 数据在哪里

应用状态保存在 Electron 的 `userData` 目录：

```text
macOS:     ~/Library/Application Support/MacroBay
Windows:   %APPDATA%/MacroBay
Linux:     ~/.config/MacroBay
```

其中包括设置、供应商配置、会话、本地数据库、日志和产品自己的记录。这个目录不是整体加密的，
请保护操作系统账号和磁盘。

## 凭据

供应商 API Key 保存在平台密钥库中，底层是 Electron `safeStorage`。渲染层拿到的是：

- `hasApiKey`：是否存在 Key；
- 掩码预览：默认不返回完整值。

用户可以在设置页显式查看已保存的 Key，但只持续很短时间。应用不会在该流程中记录 Key 或把它复制到
剪贴板。

## 网络

- 主进程和产品服务的 HTTP 请求走平台代理适配器。
- WebSocket 走平台 WebSocket 适配器。
- 渲染层不直接调用外部服务。
- 系统代理或自定义代理会作用于模型供应商和数据源请求。

## 遥测

没有产品分析服务。智能体运行时追踪是本地、可选开启的，不会发送到 MacroBay 服务器。

## 备份

备份 `userData` 目录可以保留设置、会话和本地记录。备份中包含受操作系统钥匙串保护的凭据，请按
敏感数据对待。

## 截图和日志

分享截图或日志前，请移除：

- API Key 和可能识别账号的掩码预览；
- 本机绝对路径；
- 个人工作区或会话名称；
- 真实持仓或账户数据。

## 应用不防护什么

- 被攻破的操作系统账号。
- 能访问用户文件的恶意软件。
- 你配置的供应商或数据源收到的请求。
- 你主动导出或复制出应用的数据。

## 下一步

- [状态与限制](../reference/status-and-limitations.zh-CN.md)
- [架构](./architecture.zh-CN.md)
