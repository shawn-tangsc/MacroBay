# 宏观日历

工具：`query_macro_calendar`、`get_source_health`、`operate_macro_calendar`。

## 先读

- `query_macro_calendar({ month: 'YYYY-MM', asOf })` 看这个月有哪些事件、官方值是否已发布。
- `get_source_health` 看日历供应商的健康与最近刷新。
- 需要单个事件的细节时，用 `query_macro_calendar` 返回里的 `eventKey` 再查（工具会把详情一并带回）。

## 能改什么

全部通过 `operate_macro_calendar` 的 action 表达：

| action | 参数 | 说明 |
| --- | --- | --- |
| `save-provider-profile` | `providerId`、`enabled` | 只启停供应商，不改凭据 |
| `set-release-time` | `eventKey`、`scheduledAt`（UTC ISO）、`scheduledDate`（YYYY-MM-DD） | 用户自己的发布时间覆盖；两个字段必须指同一时刻 |
| `clear-release-time` | `eventKey` | 取消覆盖 |
| `run-provider-now` | `providerId` | 立即抓一次 |
| `test-provider-connection` | `providerId` | 测试连接 |
| `refresh-bls-employment` | `eventKey`、`acknowledgeOverwrite: true` | 会改写已发布的数值 |
| `refresh-fed-fomc` | `eventKey`、`acknowledgeOverwrite: true` | 同上 |
| `sync-bls-schedule` | `year: 'YYYY'` | 同步官方日程 |
| `preview-manual-ics` | `body`、`truncated` | 只预览，不落库 |
| `import-manual-ics` | `body`、`truncated` | 导入用户提供的内容 |

`acknowledgeOverwrite` 是你对用户的声明，不是权限开关；真正的确认来自用户在审批卡上点允许。

## 工序

1. 先复述当前发布时间与来源（官方日程 / 用户覆盖）。
2. 要改覆盖：`set-release-time`，然后回读确认 `scheduledAt` 与 `scheduledDate` 一致。
3. 要刷新已发布值：先说明“这会改写已有数值”，再调 refresh，并在结果里说明 `updated`/`unchanged`/`unavailable`。
4. 手工 ICS：**先 preview，把解析结果告诉用户，再 import**。

## 禁止

- 猜测事件的 `eventKey`；必须来自查询结果。
- 在用户没确认时把 `acknowledgeOverwrite` 设为 true。
- 把日历事件当成交易建议的依据。
