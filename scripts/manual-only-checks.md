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
| `pnpm docs:event-ids` | 改动通知事件 id、或改文档里引用这些 id 的段落时 | 改这块的实现方 | 报告里 `197 篇文档 / N 个已声明事件 id / 零处对不上` 那一行 + 退出码 0（**不接受 `skipped`**） |
| `scripts/release/check-superseded-origins.mts`（命令见下） | 每次发版、在**装好这一版包**的机器上跑一次；指向安装版的数据目录，不是源码窗口 | 发版的人 | 输出里 `rows marked superseded without an origin reference: 0` + `PASS`；库/表/列不存在时也是 `PASS` 并说明「那段代码没跑过」 |
| `pnpm release:preflight`（带 `vX.Y.Z --online` 两个参数） | 打任何 `v*` 标签**之前**；必须在干净、且 HEAD 正好等于 `origin/main` 的 `main` 上 | 发版的人 | `preflight passed for vX.Y.Z` 那一行 + 退出码 0 |


上面那条发布自检的命令（`--user-data` 指到**安装版**的数据目录）：

```bash
pnpm exec tsx scripts/release/check-superseded-origins.mts --user-data "<安装版的数据目录>"
```

它的判据只有一句：0.4.1 那条问题构建会把「没有身份链接的历史会话」标成 `superseded` 且 `origin_ref` 为空；
跑过那条构建的机器上，这个计数必须为 0（不为 0 会逐条打印会话 id 与写入时间，并退 1）。

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

## `typecheck:products`（已于 2026-11-09 接进 `verify`）

它现在在链里（`typecheck` 之后），不再是人工项。本节保留，只说明历史：当初不进 `verify`
是因为它一定是红的、而主 typecheck 看不见产品文件；2026-11-09 起根 include 拆成两条
TypeScript 认识的通配，主 typecheck 与它一起暴露债务，按 `product-typecheck-debt-plan.md`
分批清。清到 0 之前 `verify` 会停在 `typecheck`，这一步还不会被执行——那是债务的代价，不是配置错误。

## 与发布的关系

`demo:verify` 与 `channel:acceptance` 同时列在 `docs-private/10-development/release-process.md`
的发布检查单里——只写在这里而发布时没人看，等于又造一个孤儿。

## `release:preflight` 为什么不进 `verify`

它不是"代码有没有坏"，是"这一笔该不该被打成标签"。三条，任何一条成立就进不了 `verify`：

- **它要问远端**：HEAD 是否等于 `origin/main`、远端同名标签是否指向别处、这批 CI 是否绿——`verify`
  是离线、可重复、在干净快照上跑的，查远端不满足任何一条。
- **它问的是这一笔自己的 CI 结果**：放进 `verify` 就成了自己证明自己，那是同义反复。
- **它有时间语义**：只在"准备打标签"那一刻有意义；每次改代码都跑它，只会把红变成噪音。

2026-11-07 那次事故就是它的理由：0.4.0 是从一个落后远端 5 笔、还带着一笔旧本地提交的检出处打的标签，
打出来的树还写着 0.3.1，发包作业已经开始构建，两分钟后才被工作流自己的版本检查拦下。
