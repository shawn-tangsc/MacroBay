/**
 * 健康阈值常量的**已登记外露点**（C6，2026-11-10）。
 *
 * 五态只在 `sourceProjection.sourceHealthState` 判一次，重复失败那个阈值常量因此只允许出现在派生处。
 * 这份登记是「还没迁完」的清单——**今天为空**：`ProviderDetail.tsx` 的健康药丸已改成读
 * `SourceView.healthState`（C16，`1b801af`），那一处不再自己比阈值。
 *
 * 迁完就把那一行删掉，守卫会自动收紧到「全仓只一处」。**不许新增**——新增一处阈值判断，
 * 就是又造出一个「同一份数据两处说不一样」的入口。
 */
export const SOURCE_HEALTH_THRESHOLD_DEBT: readonly string[] = Object.freeze([])
