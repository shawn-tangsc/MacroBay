import type { CrossAssetRange } from '../../../../contracts/crossAssetObservationContracts'

/**
 * 本面板全部文案键与窗口选项键，一处一份。
 *
 * 抽出来是因为它同时被面板和它抽出的行组件用到：同一个键表写两遍，就是「同一件事两个名字」。
 */
export const crossAssetTextKeys = Object.freeze({
  subtitle: 'pages.intelligence.portal.dashboard.crossAsset.subtitle',
  analysis: 'pages.intelligence.portal.dashboard.crossAsset.analysis',
  refresh: 'pages.intelligence.portal.dashboard.crossAsset.refresh',
  noData: 'pages.intelligence.portal.dashboard.crossAsset.noData',
  syntheticCaveat: 'pages.intelligence.portal.dashboard.crossAsset.syntheticCaveat',
  proxyCaveat: 'pages.intelligence.portal.dashboard.crossAsset.proxyCaveat',
  marketClosedHint: 'pages.intelligence.portal.dashboard.crossAsset.marketClosedHint',
  rangeLabel: 'pages.intelligence.portal.dashboard.crossAsset.rangeLabel',
  hintAnalysis: 'pages.intelligence.portal.dashboard.crossAsset.hintAnalysis',
  hintCoverage: 'pages.intelligence.portal.dashboard.crossAsset.hintCoverage',
  hintCorrelations: 'pages.intelligence.portal.dashboard.crossAsset.hintCorrelations',
  /** 本段没有可比数据的线：原因句，图标题 ⓘ 的最后一行。 */
  noComparableDataReason: 'pages.intelligence.portal.dashboard.crossAsset.lineNoComparableDataReason',
  /** 读数比阈值旧时挂在行名旁的那句（与 LiveBadge 同槽）。 */
  staleAsOf: 'pages.intelligence.portal.dashboard.crossAsset.staleAsOf',
  /** 行名旁那颗 ⓘ：这一行的说明句只在浮层里，正文不留。 */
  rowHint: 'pages.intelligence.portal.dashboard.crossAsset.rowHint',
  /** 供应商永久不提供这个品种：整行遮住，只留这一句状态。 */
  sourceRefused: 'pages.intelligence.portal.dashboard.crossAsset.sourceRefused',
  /** 标题右上的勾：不显示这类行（勾上＝隐藏）。 */
  /** 品种被供应商永久拒绝时 ⓘ 的那一行（有更多只被拒时用 `…More` 合并成一句，仍只占一行）。 */
  planNotServedReason: 'pages.intelligence.portal.dashboard.crossAsset.planNotServedReason',
  planNotServedReasonMore: 'pages.intelligence.portal.dashboard.crossAsset.planNotServedReasonMore',
  unavailable: 'pages.intelligence.portal.dashboard.crossAsset.unavailable',
  states: Object.freeze({
    disabled: 'pages.intelligence.portal.dashboard.crossAsset.states.disabled',
    connecting: 'pages.intelligence.portal.dashboard.crossAsset.states.connecting',
    live: 'pages.intelligence.portal.dashboard.crossAsset.states.live',
    stale: 'pages.intelligence.portal.dashboard.crossAsset.states.stale',
    limited: 'pages.intelligence.portal.dashboard.crossAsset.states.limited',
    unavailable: 'pages.intelligence.portal.dashboard.crossAsset.states.unavailable'
  })
})

export const crossAssetWindowLabelKeys: Readonly<Record<CrossAssetRange, string>> = Object.freeze({
  '1h': 'pages.intelligence.portal.dashboard.crossAsset.ranges.1h',
  '24h': 'pages.intelligence.portal.dashboard.crossAsset.ranges.24h',
  '7d': 'pages.intelligence.portal.dashboard.crossAsset.ranges.7d'
})
