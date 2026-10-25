# 翻译

工具：`get_translation_status`、`configure_translation`。

## 先读

`get_translation_status` 返回模块状态（待翻、失败、已完成）、当前设置（开关、目标语言、供应商、
要翻译哪些字段）和最近任务时间。先复述，再问要改什么。

## 能改什么

全部通过 `configure_translation`：

| action | 参数 |
| --- | --- |
| `save-settings` | `autoTranslateEnabled`、`targetLocale`、`providerId?`、`modelId?`、`translateTitle`、`translateSummary`、`translateEvidenceExcerpt` |
| `queue-missing` | `itemIds?`、`clusterIds?`、`filters?`、`targetLocale?` |
| `retry-failed` | 同上 |

`queue-missing` 与 `retry-failed` 只排队，不会立刻返回译文；回报时说明“已排队 N 条”，
让用户稍后用状态工具确认，不要假装已经翻好。

## 工序

1. 改设置：只传要改的字段，回读确认。
2. 补翻：先用 `get_translation_status` 看积压量，再 `queue-missing`，回报 `queuedCount`。
3. 失败重试：先看 `failedCount`，再 `retry-failed`；如果同一批连续失败，停下来说明原因，不要循环重试。

## 禁止

- 打开自动翻译却不告诉用户它会影响后续所有新条目。
- 在没有积压时反复 `queue-missing`。
- 把译文当作原文证据引用。
