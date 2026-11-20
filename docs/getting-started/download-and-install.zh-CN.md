[English](./download-and-install.md) | [中文](./download-and-install.zh-CN.md)

# 下载与安装

这一页只讲一件事：从 Releases 下载安装包之后，怎么把它装起来、怎么打开。不需要 Node.js，也不用命令行。

要从源码运行或自己打包，看[安装](./installation.zh-CN.md)。

## 先选对文件

所有文件都在 [Releases](https://github.com/shawn-tangsc/MacroBay/releases) 页面。

- **macOS，Apple 芯片**（M1/M2/M3/M4）：`MacroBay-arm64.dmg`
- **macOS，Intel 芯片**：`MacroBay-x64.dmg`
- **Windows x64**：`MacroBay-x64-setup.exe`
- **Linux**：没有安装包。Linux 尚未配置打包。

不确定 Mac 是哪颗芯片：左上角 菜单 → 关于本机，看「芯片」那一行。

## macOS：拖进应用程序，再用右键打开

1. 双击 `.dmg`，把 MacroBay 拖进「应用程序」。
2. 打开「应用程序」，**右键（或按住 Control 点按）MacroBay → 打开**，在弹出的窗口里再点「打开」。

**直接双击会被系统拦下**，提示「Apple 无法验证开发者」之类。这不是文件坏了，原因见下面的「为什么会有这个提示」。

菜单里没有「打开」这一项（较新的 macOS 版本移除了它）时，打开**系统设置 → 隐私与安全性**，在页面下方找到 MacroBay，点「仍要打开」。

两种方式都试过还是打不开（有的系统版本会直接报「已损坏」），在终端执行一次：

```bash
xattr -dr com.apple.quarantine /Applications/MacroBay.app
```

然后重新打开。

## Windows：装的时候要过 SmartScreen

1. 运行 `MacroBay-x64-setup.exe`。
2. 出现「Windows 已保护你的电脑」时，点**更多信息 → 仍要运行**。

装完从开始菜单启动。

## 怎么确认装对了

装完先做三步，每一步都能自己看到：

1. **看应用里的版本号。** 打开 **设置 → 关于我们**，右上那段有「**当前版本**」，它应当等于你在 Releases 页面下载的那个版本号。如果那一格显示「未知」，说明这次没读到版本，不要当成装对了。
2. **首启没有落到失败页。** 正常启动直接进主界面；如果看到「这个页面没有加载成功」的失败页，先完全退出（macOS 用 `Command+Q`），再开一次；仍然失败就带上日志报 issue。
3. **数据目录已经建出来。** macOS 是 `~/Library/Application Support/MacroBay/`，Windows 是 `%APPDATA%\MacroBay\`。里面有 `platform/agents.sqlite` 和 `logs/app.log`——日志文件只有应用真的跑起来过才会出现。

想再确认一步（可选）：在模型服务里配好一个 API Key，发一次对话，能拿到回复就说明打包里的智能体运行时也是好的。

## 装成了旧版、或者装错了芯片

- **macOS 装的是哪一份**：在「应用程序」里选中 MacroBay，按 `Command+I`，看「种类」那一行——写「应用程序（Apple 芯片）」或「应用程序（Intel）」。在 Apple 芯片机器上跑 Intel 版会要求装 Rosetta，能用但慢，建议换对的包。
- **版本号对不上**：先完全退出应用，再确认启动的是「应用程序」里那一份，而不是还挂在 `.dmg` 挂载卷里的那份。
- **装新版本直接覆盖旧版本**，不用先卸载；应用数据在数据目录里，不随覆盖安装变动。

## 每次更新都要重走一遍

没有自动更新：新版本要自己回到 Releases 页面下载、重新装一次。装的时候旧文件被替换，macOS 的隔离标记和 Windows 的 SmartScreen 判断每次都重新来——**不是只有第一次安装需要放行**。

## Intel 版说明

`MacroBay-x64.dmg` 已构建、已随版本发布，但**还没有在 Intel 真机上验收**。在 Intel 机器上遇到问题，欢迎报 issue，写清卡在哪一步、报什么错。

## 为什么会有这个提示：未签名、未公证

两个平台上的安装包都**没有做代码签名，也没有做 Apple 公证**。这是当前的发布状态，所以系统第一次见到它时会要求你手动放行。这两个提示来自发布状态，不是应用本身的要求。

也因为没有签名，请只从 [Releases](https://github.com/shawn-tangsc/MacroBay/releases) 页面下载。

## 打开之后

第一次启动会要求配置模型供应商的 API Key——应用不内置 Key，也不内置数据。步骤见[第一次运行](./first-run.zh-CN.md)和[模型服务](./model-service.zh-CN.md)。

数据留在你自己的机器上，不需要注册账号。
