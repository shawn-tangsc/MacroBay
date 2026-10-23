# 跨资产接口

工具：`get_cross_asset_snapshot`、`configure_cross_asset_interface`。

## 先读

`get_cross_asset_snapshot({ range })` 返回读数、口径与接口状态（是否启用、租约是否有效、
到期时间）。读数不可比时它会说明原因，不要用别的窗口凑数。

## 接口动作

全部通过 `configure_cross_asset_interface`：

| action | 参数 | 说明 |
| --- | --- | --- |
| `acquire` | 无 | 申请租约；返回 `leaseId` 或 `limited` |
| `renew` | `leaseId` | 续租 |
| `refresh` | `leaseId` | 刷新数据通道 |
| `release` | `leaseId` | 释放租约 |
| `test-interface` | 无 | 探测接口 |
| `cancel-test` | 无 | 取消探测 |

## 工序

1. 先看快照与接口状态，说明现在是“正常 / 受限 / 未启用”。
2. 接口断了：`test-interface` → 按结果决定 `refresh` 或 `acquire` → 再看一次快照。
3. 任务结束时如果拿到过租约，主动 `release`，不要一直占着。
4. 回报：动作、租约状态、读数是否恢复、`revisionAfter`（如涉及配置）。

## 禁止

- 在 `limited` 状态下反复 `acquire`。
- 拿租约不释放。
- 把跨资产代理读数说成官方指数；口径以快照返回的说明为准。
