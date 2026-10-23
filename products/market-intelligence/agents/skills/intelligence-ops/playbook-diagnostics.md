# 诊断

工具：`get_operations_health`、`get_source_health`、`list_intelligence_sources`、
`get_source_detail`、`get_intelligence_timeline`、`get_dashboard_feed_status`。

## 诊断顺序（固定）

1. `get_operations_health`：调度是否注册、任务是否积压、是否有卡住的运行。
2. `list_intelligence_sources`：哪些源停用、哪些失败、凭据是否齐全、当前 `revision`。
3. `get_source_health`（需要时间边界时）或 `get_source_detail`：定位到具体源与失败码。
4. `get_dashboard_feed_status`：看板每条数据流是否新鲜。
5. `get_intelligence_timeline`：确认“最近确实没有新数据”，而不是“有数据但没显示”。

## 怎么读结果

- `unavailable` 表示这条链路没接上，**不是空数据**，不要用 0 或旧值补。
- `empty` 表示接上了但确实没有内容。
- `stale` / `never-run` 要结合 `lastSuccessAt` 说明“多久没更新”。
- 失败码优先照原样引用，再给一句人话解释；不要编造原因。

## 输出格式

按严重度排序，每条一行：

```text
[失败] coingecko-trending    凭据失效（401），2 天无数据
[降级] macro-calendar-fed    最近一次刷新失败，已重试 3 次
[正常] binance-funding       5 分钟前更新
```

最后给一个建议动作（修凭据 / 重跑 / 改调度 / 无需处理），但不要自作主张执行写操作。

## 禁止

- 把“没有数据”直接归因为“源坏了”——先分清未启用、未配置、抓取失败、解析失败。
- 在诊断阶段顺手改配置；诊断只读，改之前要单独确认。
