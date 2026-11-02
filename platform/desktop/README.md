# platform/desktop

Electron 宿主层：主进程、preload 桥、窗口、菜单、托盘，以及所有 IPC 的装配点。

## 管什么

- `main`（210 文件）：进程启动与装配（`app.ts`，2785 行）、Agent 模型网关、通道适配器宿主、各类 IPC handler 文件的注册与依赖注入。
- `preload`（2）：`contextBridge` 暴露的 `window.platform`，207 处 `invoke`/`send`/`on`。
- `ipc`（6）：`channels.ts`（234 行）是通道名常量表；`productIpcRegistry` 按 `productId` + `method` 分发产品调用。
- `window`（11）：窗口创建、尺寸策略、渲染进程日志。
- `menu`（2）、`tray`（1）：菜单与托盘，各只有一处定义。
- `appIdentity.ts`：`APP_BUNDLE_ID` 等身份常量，必须与打包配置一致。
- `packaging`（2）：打包侧的宿主辅助。

## 不管什么（这一节是判断入口）

- **不管业务语义。** 这里出现产品名词就是越界；产品能力经生成的注册表注入，`main` 里不该有 `from 'products/...'`。
- **不管 AI 运行时。** 模型调用、智能体、助手运行时都在 `platform/ai`；这里只负责把它们装配起来。
- **不管存储实现。** SQLite 打开、迁移、仓储在 `platform/storage` 与各产品；这里只决定路径与生命周期。
- **不管调度逻辑。** 定时、去重、保留期在 `platform/jobs`；这里只在启动时注册与在退出时停止。
- **不管出网。** 一律经 `platform/network` 注入的 `platformFetch`。
- **不管界面长什么样。** 渲染层在 `apps/desktop-shell` 与产品模块；这里只给 `BrowserWindow` 和桥。

## 该下沉到哪：三条判断

1. **它是「Electron 的能力」还是「某个能力的策略」？** 窗口、菜单、托盘、单实例锁、协议注册属于前者，留在这里；「该多久重试」「保留几天」「哪个模型是默认」属于后者，归 `platform/<area>`。
2. **它需要 `app`/`BrowserWindow`/`ipcMain` 才能工作吗？** 需要——留在这里，但**把纯逻辑抽成不依赖 Electron 的函数**，由这里调用。`productBootstrap.ts`、`taskResultSourceId.ts`、`failurePresentation.ts` 都是这么抽出来的：宿主留接线，判断留纯函数。
3. **它会不会被第二个宿主复用？** 会（例如将来的本地服务、CLI、测试夹具），那它不该依赖 `ipcMain` 的存在。

## 别人该怎么用它

1. **新增 IPC 必须同时改三处**：`ipc/channels.ts` 的常量、`main` 的注册、`preload` 的暴露。少一处就是「注册了但界面调不到」或「界面能调但没人处理」。
2. **`app.ts`、`preload/index.ts`、`ipc/channels.ts` 是受保护接缝。** 改动要保留现有 Agent/Assistant 接线、对比改动前后的 IPC 面、并让回归守卫（`appIpcSurface.test.ts`）跟上。
3. **`app.ts` 有体积基线（只减不增）。** 加逻辑前先问「能不能抽出去」——今天有三次提交因为多写十几行就越线，其中两次的正确修法都是抽离。
4. **产品服务通过生成的 `productServices.ts` 注入**，不在 `main` 里逐个产品 import。
5. **启动失败要留具名日志并给出可见失败页**，不许静默返回让窗口停在白屏（`productBootstrap.ts` + `bootFailurePage.ts` 是样板）。

**用错了会怎样**：把产品策略写进 `main`，第一后果是 `app.ts` 只增不减、最终没人敢动启动路径；第二后果是换一个宿主就必须重写这些策略；第三后果最隐蔽——**策略藏在装配里，测试只能连整个 Electron 一起启动才测得到**，于是它通常没有测试。
