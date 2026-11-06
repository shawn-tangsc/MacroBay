# 手动运行的检查（不进 `verify`）

`verify` 只放**任何机器都能直接跑**的检查。需要外部条件（真机、装好的产物、真实凭据、图形环境）
的一律列在这里：**写清什么时候跑、谁跑、证据长什么样**——否则它们就是"写了但没人跑"的孤儿。

判据：**一个检查如果进不了 `verify`，就必须有一行在这里；否则守卫测试会红。**

这个文件**必须留在版本库里**：它是 `platform/desktop/main/verificationScripts.test.ts` 的输入。
早先它住在 `docs-private/`（gitignore），结果是**本地绿、干净快照红**——守卫自己变成了"只在某人
机器上成立"的东西。移动它的原因只有这一条，不是为了整齐。

| 脚本 | 什么时候跑 | 谁跑 | 证据形式 |
|---|---|---|---|
| `pnpm demo:verify` | 改动涉及示例模式（`sample mode`）或它的示例数据时；发布前若有涉及则跑一次 | 改这块的实现方 | 退出码 0 + 报告里"示例场景与断言条数"那一行 |
| `pnpm channel:acceptance` | 改动涉及真实通道投递（绑定、鉴权、出站限流）时；需要真机与真实凭据 | 通道线实现方 | 退出码 0 + 一份"哪个通道、哪条消息、落到了哪个设备/会话"的记录 |
| `pnpm check:boot-page` | 改动或审查启动失败页（`bootFailurePage`）的布局时 | 改这块的实现方 | 五条通过行（每行含卡片宽度与三个按钮高度）+ 退出码 0 |
| `pnpm seed:briefing-history` | 需要造「那一次已清理」的门槛 5 证据时；只写**临时目录**（`--out /tmp/...`），再用 `MACROBAY_USER_DATA` 指向它起应用 | 取这部分证据的人 | 临时目录里的 `daily-briefings.sqlite` 与 `daily-brief-sessions.sqlite` + 指向该目录的截图 |
| `pnpm seed:analysis-quota` | 需要造「今天的分析额度已用尽」来验 P3 时；只写**临时目录**（`--out /tmp/...`），再用 `MACROBAY_USER_DATA` 指向它起应用，然后触发一次自动分析（市场日历「Refresh now」或模块信号） | 验 P3 的这条线 | 脚本输出 `seeded <UTC 日>: event 48/48, calendar 9/9` 那一行 + 临时目录里的 `market-analysis.sqlite` + 中心出现一条 P3（正文含「今天已用 48 次 / 上限 48 次」），同一天再触发不新增 |
| `pnpm typecheck:products` | 清产品侧类型债务时（每清一批跑一次）、发布前 | 产品侧实现方 | 退出码 0 + 错误数（当前 **774**，其中 `products/` 内 771；2026-11-06 第二批清完 `desktop/shared` 后实测）**只减不增**；数字变大就是债务在长 |
| `pnpm docs:event-ids` | 改动通知事件 id、或改文档里引用这些 id 的段落时 | 改这块的实现方 | 报告里 `197 篇文档 / N 个已声明事件 id / 零处对不上` 那一行 + 退出码 0（**不接受 `skipped`**） |

## `check:boot-page` 为什么不进 `verify`

这条要写清，否则下一个人会想把它加进去。三条，任何一条单独成立就够：

- **它依赖绝对路径上的浏览器**：仓库里 playwright / puppeteer 依赖是 **0**，脚本默认写死
  `/Applications/Google Chrome.app/…`，只留 `CHROME_BIN` 一个口子。而发布流水线有 `windows-latest`
  与 `ubuntu-latest` 两个作业——**一个依赖某人机器路径的检查，不配叫"任何机器都能直接跑"**。
- **环境能导致红**：`verify` 里的红只应该是代码的红。没有 Chrome 的机器上，它红得像"页面坏了"。
- **它慢且有副作用**：本机实测 **5.5 秒**，会拉起图形进程；脚本自己文件头也写着「手动运行，不进 CI」。

**证据里不写截图，是因为截图本身会说谎**：Chrome headless 有 500px 最小布局宽度，按 350 截出来的图
是"按 500 布局再裁到 350"，两张图的 sha256 甚至相同。脚本因此不产截图、只产量测值——要求一个证据列
去收"已知会骗人的证据"，等于把那一列写成装饰。

**跑不起来时的报错也要是人话**：`CHROME_BIN` 未设且默认路径不存在时，脚本打
`check:boot-page: set CHROME_BIN to a Chrome/Chromium binary` 并 **退出码 2**（与"布局真的溢出"的 1
分开）。它现在是唯一能跑到它的路径，抛一段 `execFileSync` 的 ENOENT 堆栈就是它变孤儿的第 0 天。

## `docs:event-ids` 为什么也不进 `verify`

它扫的是 `docs-private/`——**那个目录是 gitignore 的，CI 上不存在**。脚本自己写着
「为什么不在 verify 链里」，并且在没有 `docs-private` 时打一行 `skipped` 然后**退出码 0**。

所以它的证据形式里有一条硬要求：**看到 `skipped` 不算通过**。一个"跳过 = 绿"的检查放进
`verify`，等于给链上加一个永远为真的成员；放在这里至少有人看得见它跳过了。

## `typecheck:products` 为什么不进 `verify`

一句话：**它现在一定是红的，而它看的那些文件主 typecheck 根本看不见。**

- 根 `tsconfig.json` 的 include 写的是 `products/**/*.{ts,tsx}`，而 **TypeScript 的 include 不支持花括号展开**，这一项匹配 **0 个文件**。主 typecheck 里那 845 个产品文件，是**被 import 图拽进去的**（`apps/` 真引用到的那些），`products/**/*.mts` 那条没有花括号，是有效的。
- 所以 products 全量 **1563** 个文件里，**718 个从来没被主 typecheck 检查过**——今天在这一千多文件里能数出 **861 条真错**（`products/` 内 858 条），例如缺字段的对象字面量、字面量联合传错。**把它们塞进 `verify`，所有人下一次提交就一起红**，而那与提交内容无关。
- 它的用途因此是**债务可见**，不是门禁：清一批、跑一次、看数字掉没掉。真正的修法另有一页（把根 include 拆成 `products/**/*.ts` 与 `products/**/*.tsx` 两行，再按目录分批清债），两件事必须一起排——只做第一步，主 typecheck 立刻红 861 条。

**基线怎么用**：跑一次记下错误数，只许变小。数字变大时先看是哪一批新代码，别调基线。等它归零，这一行就该删掉、把这项并进 `verify` 的 `typecheck` 里，而不是长期挂在门外。

## 与发布的关系

`demo:verify` 与 `channel:acceptance` 同时列在 `docs-private/10-development/release-process.md`
的发布检查单里——只写在这里而发布时没人看，等于又造一个孤儿。
