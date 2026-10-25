# 情报源配置

工具：`list_intelligence_sources`、`get_source_detail`、`configure_intelligence_source`、
`operate_intelligence_source`、`request_source_credential`。

## 先读

1. `list_intelligence_sources`：拿到全部源的 `enabled`、`collectionPreset`、`credentialStatus`、
   `revision`。用户说“某个源”但没给 id 时，先在这里按名字定位。
2. `get_source_detail({ sourceId })`：拿健康、失败码、调度规则、凭据状态。

不要跳过这两步直接改。改之前复述一句：“它现在是启用的，预设是 balanced，上次成功 2 天前，凭据未配置。”

## 判断与动作

| 现状 | 动作 |
| --- | --- |
| `credentialStatus.hasCredential = false` | 调 `request_source_credential({ sourceId })`，把填写入口告诉用户；不要试其他写操作 |
| 已启用但一直失败 | 先 `operate_intelligence_source({ action: 'test-connection' })`；失败就按失败码解释 |
| 未启用、配置正确 | `configure_intelligence_source({ action: 'set-enabled', sourceId, enabled: true })` |
| 配置要改（预设、保留、范围、监控标的） | `configure_intelligence_source({ action: 'save-profile', sourceId, … })`，只传要改的字段 |
| 已启用但想立刻抓一次 | `operate_intelligence_source({ action: 'run-now', sourceId })` |

`save-profile` **不接受** `enabled`，启停只走 `set-enabled`；也不接受任何凭据字段。

## 改完验证

1. `get_source_detail` 回读：确认目标字段已变、`credentialStatus` 符合预期。
2. 需要时 `run-now`，再查一次健康与时间线。
3. 回报：改了哪些字段、旧值、新值、`revisionAfter`。

## 禁止

- 一次调用改多个源。
- 把 `credentialRef`、`sourceSpecificConfigJson` 写进参数（schema 里没有，传了会被拒）。
- 在用户没确认时连续改第二个源。
