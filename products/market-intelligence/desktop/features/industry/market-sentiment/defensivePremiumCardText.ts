import type { FearGreedSnapshotBucket } from '../../../../contracts/intelligenceQueryContracts'

/**
 * 恐惧与防跌溢价卡的文案形状：卡面只认这一份，宿主把产品文案装配成它。
 *
 * 键名与 `productText` 里的 `dashboard.defensivePremium` 一一对应，不是第二套词汇；把装配放在
 * 这里是因为卡住在 features 里、不该反向依赖页面层，同时让「卡要哪些字」在类型上看得见。
 */
export type DefensivePremiumCardText = {
  title: string
  titleInfoLabel: string
  observedAt: string
  provenance: string
  fearGreed: { name: string; axis: string; asOf: string; buckets: Record<FearGreedSnapshotBucket, string> }
  gaugeMarkers: { fear: string; neutral: string; greed: string }
  skew: { name: string; notConnected: string }
  action: { refresh: string; enable: string; viewSource: string }
  loading: string
  empty: string
}

type Source = {
  defensivePremium: {
    title: string
    titleInfoLabel: string
    observedAt: string
    provenance: string
    fearGreed: { name: string; axis: string; asOf: string }
    skew: { name: string; notConnected: string }
    action: { refresh: string; enable: string; viewSource: string }
  }
  /** 两个半条和旧情绪卡共用同一批字：读数的「截至」与档位名只该有一份。 */
  fearGreed: { loading: string; empty: string; buckets: Record<FearGreedSnapshotBucket, string> }
  sentiment: { gaugeMarkers: { fear: string; neutral: string; greed: string } }
}

export function defensivePremiumCardText(text: Source): DefensivePremiumCardText {
  return {
    title: text.defensivePremium.title,
    titleInfoLabel: text.defensivePremium.titleInfoLabel,
    observedAt: text.defensivePremium.observedAt,
    provenance: text.defensivePremium.provenance,
    fearGreed: {
      name: text.defensivePremium.fearGreed.name,
      axis: text.defensivePremium.fearGreed.axis,
      asOf: text.defensivePremium.fearGreed.asOf,
      buckets: text.fearGreed.buckets
    },
    gaugeMarkers: text.sentiment.gaugeMarkers,
    skew: text.defensivePremium.skew,
    action: text.defensivePremium.action,
    loading: text.fearGreed.loading,
    empty: text.fearGreed.empty
  }
}
