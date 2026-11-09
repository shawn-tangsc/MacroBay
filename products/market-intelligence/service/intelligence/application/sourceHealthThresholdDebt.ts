/**
 * 健康阈值常量的**已登记外露点**（C6，2026-11-10）。
 *
 * 五态只在 `sourceProjection.sourceHealthState` 判一次，重复失败那个阈值常量因此只允许
 * 出现在派生处。这份登记是「还没迁完」的那一处：`ProviderDetail.tsx` 的健康药丸今天仍
 * 自己比阈值，配置线在 C11–C13 落地时改成读 `SourceView.healthState`。
 *
 * 迁完就把这一行删掉，守卫会自动收紧到「全仓只一处」。**不许新增**——新增一处阈值判断，
 * 就是又造出一个「同一份数据两处说不一样」的入口。
 */
export const SOURCE_HEALTH_THRESHOLD_DEBT: readonly string[] = Object.freeze([
  'products/market-intelligence/desktop/settings/intelligence-sources/ProviderDetail.tsx'
])
