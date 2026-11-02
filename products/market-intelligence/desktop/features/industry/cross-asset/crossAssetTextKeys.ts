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
  dailyFrequency: 'pages.intelligence.portal.dashboard.crossAsset.dailyFrequency',
  dailyMixedDates: 'pages.intelligence.portal.dashboard.crossAsset.dailyMixedDates',
  dailyCaveat: 'pages.intelligence.portal.dashboard.crossAsset.dailyCaveat',
  dailySpreadAndInflation: 'pages.intelligence.portal.dashboard.crossAsset.dailySpreadAndInflation',
  dailySpreadOnly: 'pages.intelligence.portal.dashboard.crossAsset.dailySpreadOnly',
  dailyChangeWithDate: 'pages.intelligence.portal.dashboard.crossAsset.dailyChangeWithDate',
  dailyChangeUnknownWithDate: 'pages.intelligence.portal.dashboard.crossAsset.dailyChangeUnknownWithDate',
  inflationExpectationWithDate: 'pages.intelligence.portal.dashboard.crossAsset.inflationExpectationWithDate',
  syntheticCaveat: 'pages.intelligence.portal.dashboard.crossAsset.syntheticCaveat',
  proxyCaveat: 'pages.intelligence.portal.dashboard.crossAsset.proxyCaveat',
  marketClosedHint: 'pages.intelligence.portal.dashboard.crossAsset.marketClosedHint',
  rangeLabel: 'pages.intelligence.portal.dashboard.crossAsset.rangeLabel',
  hintAnalysis: 'pages.intelligence.portal.dashboard.crossAsset.hintAnalysis',
  hintCoverage: 'pages.intelligence.portal.dashboard.crossAsset.hintCoverage',
  hintCorrelations: 'pages.intelligence.portal.dashboard.crossAsset.hintCorrelations',
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
