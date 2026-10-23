export const etfCurrentStateWindowPolicy = Object.freeze({
  sourceId: '0xrouter',
  assets: Object.freeze(['BTC', 'ETH'] as const),
  minimumCompleteRows: 5,
  maximumRowsPerAsset: 30,
  capitalConclusionRows: 5,
  maximumAbsoluteUsdFlow: Number.MAX_SAFE_INTEGER
})

export type EtfAsset = typeof etfCurrentStateWindowPolicy.assets[number]

export type EtfDailyFlow = Readonly<{
  asset: EtfAsset
  tradingDate: string
  netFlowUsd: number
  observedAt: string
  fetchedAt: string
  source: typeof etfCurrentStateWindowPolicy.sourceId
  sourceRevision?: string
}>

export type EtfCurrentStateWindow = Readonly<{
  btc: readonly EtfDailyFlow[]
  eth: readonly EtfDailyFlow[]
  windowEnd: string
  capitalConclusionDates: readonly string[]
  revision?: Readonly<{ providerCurrentStateId: string }>
}>

export type EtfCurrentStateWindowResult =
  | Readonly<{ state: 'available'; window: EtfCurrentStateWindow; windowEnd: string; capitalConclusionDates: readonly string[] }>
  | Readonly<{ state: 'unavailable' }>

export function buildEtfCurrentStateWindow(input: {
  asOf: string
  completeThrough: string
  completeDates: readonly string[]
  btc: readonly EtfDailyFlow[]
  eth: readonly EtfDailyFlow[]
}): EtfCurrentStateWindowResult {
  if (!isCanonicalUtcMillis(input.asOf) || !isCompleteDateSet(input.completeDates, input.completeThrough, input.asOf.slice(0, 10))) return unavailable()
  const btc = validateAssetRows(input.btc, 'BTC', input.completeThrough)
  const eth = validateAssetRows(input.eth, 'ETH', input.completeThrough)
  if (!btc || !eth || !sameDates(btc, eth) || !sameDatesAsCompleteSet(btc, input.completeDates)) return unavailable()

  const windowEnd = btc.at(-1)!.tradingDate
  if (windowEnd !== input.completeThrough) return unavailable()
  const capitalConclusionDates = btc.slice(-etfCurrentStateWindowPolicy.capitalConclusionRows).map((flow) => flow.tradingDate)
  const window = Object.freeze({
    btc: Object.freeze(btc),
    eth: Object.freeze(eth),
    windowEnd,
    capitalConclusionDates: Object.freeze(capitalConclusionDates)
  })
  return Object.freeze({ state: 'available' as const, window, windowEnd, capitalConclusionDates: window.capitalConclusionDates })
}

export function isValidEtfCurrentStateWindow(window: unknown): window is EtfCurrentStateWindow {
  if (!isPlainRecord(window) || !hasOnlyKeys(window, ['btc', 'eth', 'windowEnd', 'capitalConclusionDates', 'revision'])) return false
  if (!isTradingDate(window.windowEnd) || !Array.isArray(window.capitalConclusionDates) || !window.capitalConclusionDates.every(isTradingDate)) return false
  const btc = validateAssetRows(window.btc as readonly EtfDailyFlow[], 'BTC', window.windowEnd)
  const eth = validateAssetRows(window.eth as readonly EtfDailyFlow[], 'ETH', window.windowEnd)
  return !!btc && !!eth && sameDates(btc, eth) &&
    btc.at(-1)?.tradingDate === window.windowEnd && eth.at(-1)?.tradingDate === window.windowEnd &&
    window.capitalConclusionDates.length === etfCurrentStateWindowPolicy.capitalConclusionRows &&
    sameDatesAsCompleteSet(btc.slice(-etfCurrentStateWindowPolicy.capitalConclusionRows), window.capitalConclusionDates) &&
    isSafeWindowRevision(window.revision)
}

function validateAssetRows(rows: readonly EtfDailyFlow[], asset: EtfAsset, completeThrough: string): readonly EtfDailyFlow[] | undefined {
  if (!Array.isArray(rows) || rows.length < etfCurrentStateWindowPolicy.minimumCompleteRows || rows.length > etfCurrentStateWindowPolicy.maximumRowsPerAsset) return undefined
  const dates = new Set<string>()
  const canonical: EtfDailyFlow[] = []
  for (const row of rows) {
    if (!isFlow(row, asset) || row.tradingDate > completeThrough || dates.has(row.tradingDate)) return undefined
    dates.add(row.tradingDate)
    canonical.push(Object.freeze({ ...row }))
  }
  return canonical.every((row, index) => index === 0 || canonical[index - 1]!.tradingDate < row.tradingDate) ? canonical : undefined
}

function isFlow(value: unknown, asset: EtfAsset): value is EtfDailyFlow {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['asset', 'tradingDate', 'netFlowUsd', 'observedAt', 'fetchedAt', 'source', 'sourceRevision'])) return false
  return value.asset === asset && isTradingDate(value.tradingDate) && isUsdFlow(value.netFlowUsd) &&
    isCanonicalUtcMillis(value.observedAt) && isCanonicalUtcMillis(value.fetchedAt) &&
    value.source === etfCurrentStateWindowPolicy.sourceId && (value.sourceRevision === undefined || isSafeRevision(value.sourceRevision))
}

function sameDates(left: readonly EtfDailyFlow[], right: readonly EtfDailyFlow[]): boolean {
  return left.length === right.length && left.every((flow, index) => flow.tradingDate === right[index]?.tradingDate)
}

function sameDatesAsCompleteSet(flows: readonly EtfDailyFlow[], completeDates: readonly string[]): boolean {
  return flows.length === completeDates.length && flows.every((flow, index) => flow.tradingDate === completeDates[index])
}

function isCompleteDateSet(value: unknown, completeThrough: string, asOfDate: string): value is readonly string[] {
  return Array.isArray(value) && value.length >= etfCurrentStateWindowPolicy.minimumCompleteRows && value.length <= etfCurrentStateWindowPolicy.maximumRowsPerAsset &&
    value.every(isTradingDate) && value.every((date, index) => index === 0 || value[index - 1]! < date) && value.at(-1) === completeThrough && completeThrough <= asOfDate
}

function isUsdFlow(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= etfCurrentStateWindowPolicy.maximumAbsoluteUsdFlow
}

function isTradingDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}

function isCanonicalUtcMillis(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function isSafeRevision(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
}

function isSafeWindowRevision(value: unknown): boolean {
  return value === undefined || (isPlainRecord(value) && hasOnlyKeys(value, ['providerCurrentStateId']) && isSafeRevision(value.providerCurrentStateId))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function unavailable(): Extract<EtfCurrentStateWindowResult, { state: 'unavailable' }> {
  return Object.freeze({ state: 'unavailable' as const })
}
