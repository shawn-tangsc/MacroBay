import {
  capitalConditionsDailyFlowPolicy,
  capitalConditionsSnapshotPolicy,
  isCanonicalCapitalConditionsSnapshotTime,
  isValidCapitalConditionsDailyFlows,
  isVisibleEtfPublicSnapshot,
  type EtfPublicAssetSnapshot
} from '../../../../contracts/intelligenceQueryContracts'

export const dashboardCapitalConditionsPresentationPolicy = {
  usd: {
    maximumFractionDigits: 1,
    compactUnits: [
      { suffix: 'B', threshold: 1_000_000_000 },
      { suffix: 'M', threshold: 1_000_000 },
      { suffix: 'K', threshold: 1_000 }
    ]
  },
  percent: { fractionDigits: 2, includePositiveSign: true },
  etfState: 'unavailable',
  flowChart: {
    defaultVisibleRows: 7,
    maximumMagnitudePercent: 100,
    minimumVisibleMagnitudePercent: 2,
    series: ['funds', 'btc', 'eth'],
    directions: { inflow: 'inflow', outflow: 'outflow', zero: 'zero' }
  }
} as const

type DashboardEtfFlowRow = { tradingDate: string; netFlowUsd: number; direction: 'inflow' | 'outflow' | 'zero'; magnitudePercent: number }
type DashboardEtfFlowAsset = { asset: 'BTC' | 'ETH'; latestNetFlowUsd: string; observedAt: string; rows: readonly DashboardEtfFlowRow[] }
type DashboardEtfFlow = { state: 'available'; btc: DashboardEtfFlowAsset; eth: DashboardEtfFlowAsset }
type DashboardStablecoinFlow = { tradingDate: string; netFlowUsd: number }
type DashboardFlowHistory = { state: 'available'; rows: readonly { tradingDate: string; funds: number; btc: number; eth: number }[] }

export type DashboardCapitalConditionsState =
  | { state: 'loading' }
  | {
      state: 'available'
      conclusion: 'partial' | 'unavailable'
      etf: DashboardEtfFlow | 'unavailable'
      flowHistory?: DashboardFlowHistory
      observedAt: string
      currentUsd: string
      change1dUsd: string
      change1dPercent: string
      change7dUsd: string
      change7dPercent: string
      change30dUsd: string
      change30dPercent: string
      dailyFlows?: readonly DashboardStablecoinFlow[]
      usdStablecoinSupplyUsd?: string
    }
  | { state: 'empty' }
  | { state: 'unavailable' }

export function projectDashboardCapitalConditionsSnapshot(value: unknown, asOf: string): Exclude<DashboardCapitalConditionsState, { state: 'loading' }> {
  try {
    if (!isCanonicalCapitalConditionsSnapshotTime(asOf)) return { state: 'unavailable' }
    if (isExactRecord(value, ['state', 'asOf']) && value.state === 'empty' && value.asOf === asOf) return { state: 'empty' }
    if (isExactRecord(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === capitalConditionsSnapshotPolicy.unavailableFailureCode) return { state: 'unavailable' }
    if (!isAvailable(value, asOf)) return { state: 'unavailable' }
    const core = value.coreStablecoins
    const currentUsd = formatUsd(core.currentUsd, false)
    const change1dUsd = formatUsd(core.change1dUsd, true)
    const change1dPercent = formatPercent(core.change1dPercent)
    const change7dUsd = formatUsd(core.change7dUsd, true)
    const change7dPercent = formatPercent(core.change7dPercent)
    const change30dUsd = formatUsd(core.change30dUsd, true)
    const change30dPercent = formatPercent(core.change30dPercent)
    const background = value.usdStablecoinSupplyUsd === undefined ? undefined : formatUsd(value.usdStablecoinSupplyUsd, false)
    if (!currentUsd || !change1dUsd || !change1dPercent || !change7dUsd || !change7dPercent || !change30dUsd || !change30dPercent || (value.usdStablecoinSupplyUsd !== undefined && !background)) return { state: 'unavailable' }
    const dailyFlows = isValidCapitalConditionsDailyFlows(core.dailyFlows, asOf) ? core.dailyFlows : undefined
    const etf = projectEtf(value.etf, asOf)
    const flowHistory = projectFlowHistory(dailyFlows, etf)
    return {
      state: 'available', conclusion: value.conclusion, etf, ...(flowHistory === 'unavailable' ? {} : { flowHistory }), observedAt: core.observedAt,
      currentUsd, change1dUsd, change1dPercent, change7dUsd, change7dPercent, change30dUsd, change30dPercent,
      ...(dailyFlows ? { dailyFlows } : {}),
      ...(background ? { usdStablecoinSupplyUsd: background } : {})
    }
  } catch {
    return { state: 'unavailable' }
  }
}

function isAvailable(value: unknown, asOf: string): value is {
  coreStablecoins: {
    observedAt: string
    verifiedAt: string
    currentUsd: number
    change1dUsd: number
    change1dPercent: number
    change7dUsd: number
    change7dPercent: number
    change30dUsd: number
    change30dPercent: number
    dailyFlows?: unknown
  }
  usdStablecoinSupplyUsd?: number
  etf: unknown
  conclusion: 'partial' | 'unavailable'
} {
  if (!isExactRecord(value, ['state', 'asOf', 'etf', 'coreStablecoins', 'conclusion']) && !isExactRecord(value, ['state', 'asOf', 'etf', 'coreStablecoins', 'usdStablecoinSupplyUsd', 'conclusion'])) return false
  if (value.state !== 'available' || value.asOf !== asOf || value.conclusion !== 'partial' && value.conclusion !== 'unavailable') return false
  const core = value.coreStablecoins
  if ((!isExactRecord(core, ['observedAt', 'verifiedAt', 'currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent']) &&
    !isExactRecord(core, ['observedAt', 'verifiedAt', 'currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent', 'dailyFlows'])) || !isCanonicalCapitalConditionsSnapshotTime(core.observedAt) || !isCanonicalCapitalConditionsSnapshotTime(core.verifiedAt) || core.observedAt > core.verifiedAt || core.verifiedAt > asOf) return false
  if (!['currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent'].every((key) => isDisplayNumber(core[key]))) return false
  return value.usdStablecoinSupplyUsd === undefined || isDisplayNumber(value.usdStablecoinSupplyUsd)
}

function projectEtf(value: unknown, asOf: string): DashboardEtfFlow | 'unavailable' {
  if (!isVisibleEtfPublicSnapshot(value, asOf)) return dashboardCapitalConditionsPresentationPolicy.etfState
  const btc = projectEtfAsset(value.btc)
  const eth = projectEtfAsset(value.eth)
  return btc && eth ? { state: 'available', btc, eth } : dashboardCapitalConditionsPresentationPolicy.etfState
}

function projectFlowHistory(stablecoinHistory: readonly DashboardStablecoinFlow[] | undefined, etf: DashboardEtfFlow | 'unavailable'): DashboardFlowHistory | 'unavailable' {
  if (!stablecoinHistory || etf === 'unavailable') return 'unavailable'
  const funds = new Map(stablecoinHistory.map((row) => [row.tradingDate, row.netFlowUsd]))
  const eth = new Map(etf.eth.rows.map((row) => [row.tradingDate, row.netFlowUsd]))
  const rows = etf.btc.rows.flatMap((btc) => {
    const fund = funds.get(btc.tradingDate)
    const ether = eth.get(btc.tradingDate)
    return fund === undefined || ether === undefined ? [] : [{ tradingDate: btc.tradingDate, funds: fund, btc: btc.netFlowUsd, eth: ether }]
  })
  return rows.length >= capitalConditionsDailyFlowPolicy.minimumRows
    ? { state: 'available', rows: rows.slice(-dashboardCapitalConditionsPresentationPolicy.flowChart.defaultVisibleRows) }
    : 'unavailable'
}

function projectEtfAsset(value: EtfPublicAssetSnapshot): DashboardEtfFlowAsset | undefined {
  const latest = value.rows.at(-1)
  if (!latest) return undefined
  const latestNetFlowUsd = formatUsd(latest.netFlowUsd, true)
  const largestAbsoluteFlow = Math.max(...value.rows.map((row) => Math.abs(row.netFlowUsd)))
  if (!latestNetFlowUsd || !Number.isFinite(largestAbsoluteFlow)) return undefined
  const rows = value.rows.map((row) => ({
    tradingDate: row.tradingDate,
    netFlowUsd: row.netFlowUsd,
    direction: row.netFlowUsd > 0 ? dashboardCapitalConditionsPresentationPolicy.flowChart.directions.inflow : row.netFlowUsd < 0 ? dashboardCapitalConditionsPresentationPolicy.flowChart.directions.outflow : dashboardCapitalConditionsPresentationPolicy.flowChart.directions.zero,
    magnitudePercent: row.netFlowUsd === 0 ? 0 : Math.max(1, Math.min(dashboardCapitalConditionsPresentationPolicy.flowChart.maximumMagnitudePercent, Math.round(Math.abs(row.netFlowUsd) / largestAbsoluteFlow * dashboardCapitalConditionsPresentationPolicy.flowChart.maximumMagnitudePercent)))
  }))
  return { asset: value.asset, latestNetFlowUsd, observedAt: latest.observedAt, rows }
}

function isDisplayNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 999_999_999_999_999
}

function formatUsd(value: number, signed: boolean): string | undefined {
  if (!isDisplayNumber(value)) return undefined
  const normalized = Object.is(value, -0) ? 0 : value
  const absolute = Math.abs(normalized)
  const unit = dashboardCapitalConditionsPresentationPolicy.usd.compactUnits.find((candidate) => absolute >= candidate.threshold)
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: dashboardCapitalConditionsPresentationPolicy.usd.maximumFractionDigits, useGrouping: false }).format(absolute / (unit?.threshold ?? 1))
  return `${signed && normalized > 0 ? '+' : normalized < 0 ? '-' : ''}$${number}${unit?.suffix ?? ''}`
}

function formatPercent(value: number): string | undefined {
  if (!isDisplayNumber(value)) return undefined
  const normalized = Object.is(value, -0) ? 0 : value
  const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: dashboardCapitalConditionsPresentationPolicy.percent.fractionDigits, maximumFractionDigits: dashboardCapitalConditionsPresentationPolicy.percent.fractionDigits, useGrouping: false }).format(Math.abs(normalized))
  return `${normalized > 0 ? '+' : normalized < 0 ? '-' : ''}${number}%`
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
  const names = Object.getOwnPropertyNames(value)
  return names.length === fields.length && fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}
