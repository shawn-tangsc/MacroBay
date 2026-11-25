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
  fearGreed: {
    name: string
    axis: string
    asOf: string
    buckets: Record<FearGreedSnapshotBucket, string>
    infoLabel: string
    info: { volatility: string; percentile: string; percentileInsufficient: string }
  }
  skew: {
    name: string
    notConnected: string
    /** 偏斜自己的空态句：复用恐惧贪婪那句会变成「暂无已采集的恐惧与贪婪指数」。 */
    empty: string
    infoLabel: string
    info: { definition: string; relative: string; since: string }
    asOf: string
    unit: string
    /** 轴说明整句（名字 + 带括号的单位）：组件不自己拼括号。 */
    axis: string
    /** 只有**读数行**用的四个词（「走阔 · 近 5 天」那一处）。方向未知的三句原因不在这里：
        用户 2026-11-24 把它并进结论键、界面不再渲染；留着类型就是「配了、看不见」。 */
    direction: { window: string; steeper: string; flatter: string; flat: string }
    unavailable: { connection: string; source: string; read: string }
  }
  chart: { fearGreedAria: string; skewAria: string; fearGreedSummary: string; skewSummary: string }
  stale: { pill: string; stopsAt: string }
  action: { refresh: string; enable: string; viewSource: string }
  loading: string
  empty: string
}

type Source = {
  defensivePremium: {
    title: string
    titleInfoLabel: string
    fearGreed: {
      name: string
      axis: string
      asOf: string
      infoLabel: string
      info: { volatility: string; percentile: string; percentileInsufficient: string }
    }
    skew: {
      name: string
      notConnected: string
      empty: string
      infoLabel: string
      asOf: string
      unit: string
      axis: string
      info: { definition: string; relative: string; since: string }
      direction: { window: string; steeper: string; flatter: string; flat: string }
      unavailable: { connection: string; source: string; read: string }
    }
    stale: { pill: string; stopsAt: string }
    chart: { fearGreedAria: string; skewAria: string; fearGreedSummary: string; skewSummary: string }
    action: { refresh: string; enable: string; viewSource: string }
  }
  /** 格里的「截至」与档位名只该有一份。 */
  fearGreed: { loading: string; empty: string; buckets: Record<FearGreedSnapshotBucket, string> }
}

export function defensivePremiumCardText(text: Source): DefensivePremiumCardText {
  return {
    title: text.defensivePremium.title,
    titleInfoLabel: text.defensivePremium.titleInfoLabel,
    fearGreed: {
      name: text.defensivePremium.fearGreed.name,
      axis: text.defensivePremium.fearGreed.axis,
      asOf: text.defensivePremium.fearGreed.asOf,
      buckets: text.fearGreed.buckets,
      infoLabel: text.defensivePremium.fearGreed.infoLabel,
      info: text.defensivePremium.fearGreed.info
    },
    skew: text.defensivePremium.skew,
    chart: text.defensivePremium.chart,
    stale: text.defensivePremium.stale,
    action: text.defensivePremium.action,
    loading: text.fearGreed.loading,
    empty: text.fearGreed.empty
  }
}
