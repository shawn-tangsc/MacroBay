# 示例数据（Sample data）

示例模式（设计 [155](../../../docs-private/products/market-intelligence/09-implementation/market-intelligence/155-sample-mode-product-design.md) /
[156](../../../docs-private/products/market-intelligence/09-implementation/market-intelligence/156-sample-mode-technical-design.md)）
在**断网、无 API Key、空 userData** 的机器上展示完整看板与一条真实结论。

数据不是手写的：它是一段**真实历史窗口**的接口返回，录制下来离线回放。

## 目录

```text
demo/
  scenarios/<scenarioId>/
    scenario.json          # 场景元数据（窗口、场景时钟、来源、说明）
    surfaces.json          # 这版数据承诺覆盖的接口名
    responses/
      common/<method>.json # 语言无关：数值、时间、枚举
      zh-CN/<method>.json  # 中文叙述（结论、事件标题）
      en-US/<method>.json  # 英文同构
  raw/                     # 录制产物，已被 .gitignore 排除
```

fixture 信封：

```json
{ "schemaVersion": 1, "method": "intelligence.queryFundingRateHistory", "effect": "read", "payload": { ... } }
```

按请求参数分档（日历按月、结论按 id）：

```json
{ "schemaVersion": 1, "method": "intelligence.macro.economicCalendar.queryMonth",
  "effect": "read", "byRequestKey": "month", "byRequest": { "2026-10": { ... } } }
```

## 录制（需要真实数据 + Key，只做一次）

```bash
MB_SAMPLE_RECORD=1 pnpm dev
```

然后按清单点一遍看板——录的是「渲染层真正收到的返回」，所以点什么就录什么：

1. 打开看板，等所有面板渲染完（市场状态、同起点收益率、资金面、情绪、资金费率、宏观发布动态）。
2. 同起点收益率切换 **1h → 24h → 7d**（三个窗口是三份返回，不切就只有一份）。
3. 等宏观发布动态自己出数（它会连查本月/上月/下月）。
4. 点开「最新 AI 结论」，再点开时间轴里另外 1–2 个节点。
5. （可选）打开宏观日历翻一格。

产物在 `demo/raw/<session>/`，**不入库**：录完挑出需要的文件，脱敏后改名放进
`scenarios/<scenarioId>/responses/`。

## 录前要有足够的历史

- 24h 曲线需要 289 根 5 分钟 bar，只能来自热层（最近 8 天）——**当天录**，不能事后补录上周。
- 7d 曲线按小时取样（169 点），需要库里有 8 天以上历史。
- 资金费率各 22 期；稳定币 30 日流；日历要有上月/本月/下月。

不达标就先补数或换一个没有洞的窗口，而不是让示例变短。

## 校验

```bash
pnpm demo:verify
```

检查：信封与文件名一致、`effect: read`、时间不晚于场景时钟、无 URL / 疑似密钥、无
`hasCredential: true`、单文件 ≤ 64 KB、总量 ≤ 2 MB、`surfaces.json` 声明的接口都有 fixture。
没有场景目录时退出 0（空仓库是正常状态）。

## 红线

- 示例数据**不得**进入 SQLite、pipeline、情绪聚合、来源健康统计或分析表——它只在内存里回放。
- 不提交 `demo/raw/`，不提交原始 provider 响应，只提交归一化后的契约 payload。
- 不放图片、不放数据库文件；需要更多数据就加 JSON。
