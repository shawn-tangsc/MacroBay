import { createHash } from 'node:crypto'

export const etfCurrentStateWindowPolicy = Object.freeze({
  /** 新写入一律带这个 id；它同时是注册表 id（架构师裁定，一处定义）。 */
  sourceId: 'cryptoetf-etf-flows' as const,
  /** 旧值只用于读迁移，永不新写；窗口内仍必须同值。 */
  legacySourceId: '0xrouter' as const,
  allowedSourceIds: Object.freeze(['0xrouter', 'cryptoetf-etf-flows'] as const),
  assets: Object.freeze(['BTC', 'ETH'] as const),
  minimumCompleteRows: 5,
  maximumRowsPerAsset: 30,
  capitalConclusionRows: 5,
  maximumAbsoluteUsdFlow: Number.MAX_SAFE_INTEGER
})

export type EtfAsset = typeof etfCurrentStateWindowPolicy.assets[number]
export type EtfFlowSourceId = typeof etfCurrentStateWindowPolicy.allowedSourceIds[number]

export type EtfDailyFlow = Readonly<{
  asset: EtfAsset
  tradingDate: string
  netFlowUsd: number
  observedAt: string
  fetchedAt: string
  source: EtfFlowSourceId
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
  if (!canonical.every((row, index) => index === 0 || canonical[index - 1]!.tradingDate < row.tradingDate)) return undefined
  // **允许混源**（用户 2026-11-17：主源 + 备源互相补充）。每一行自己带 `source`，
  // 窗口归属由 `etfWindowSource` 统一回答（主源在就用主源），所以 DTO 的 `sourceId` 不会说谎；
  // 累计只按数值求和，行上哪来的不影响口径——它本来就只是这一天的净流。
  return canonical
}

function isFlow(value: unknown, asset: EtfAsset): value is EtfDailyFlow {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['asset', 'tradingDate', 'netFlowUsd', 'observedAt', 'fetchedAt', 'source', 'sourceRevision'])) return false
  return value.asset === asset && isTradingDate(value.tradingDate) && isUsdFlow(value.netFlowUsd) &&
    isCanonicalUtcMillis(value.observedAt) && isCanonicalUtcMillis(value.fetchedAt) &&
    (etfCurrentStateWindowPolicy.allowedSourceIds as readonly string[]).includes(value.source as string) && (value.sourceRevision === undefined || isSafeRevision(value.sourceRevision))
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

/**
 * 注册表 id → 窗口 id。**两个词表对同一件事只有一个翻译点**（就这里）。
 *
 * 窗口契约的 `allowedSourceIds` 是换源期留下的词表：主源用注册表 id，旧聚合源用窗口 id
 * `'0xrouter'`（旧行按它写的，读迁移只认它）。采集侧拿到的是注册表 id
 * `'0xrouter-aggregate-provider'`——直接写进行里，整窗就会 fail-closed：既不落库、也不记拒绝，
 * 读者只看到「数据一直不更新」（2026-11-17 的现场）。
 */
const etfWindowSourceIdsByRegistryId: Readonly<Record<string, EtfFlowSourceId>> = Object.freeze({
  'cryptoetf-etf-flows': 'cryptoetf-etf-flows',
  '0xrouter-aggregate-provider': '0xrouter',
  // 旧行与旧调用点本来就用窗口 id：认同一个值，不逼调用方先查表。
  '0xrouter': '0xrouter'
})

/** 认不出来就返回 undefined：宁可不写这一支，也不写一行会被整窗拒绝的来源。 */
export function etfWindowSourceIdFor(sourceId: string): EtfFlowSourceId | undefined {
  return etfWindowSourceIdsByRegistryId[sourceId]
}


/**
 * 窗口归属哪个来源：**主源在场就是主源**（用户 2026-11-17 的「新的覆盖旧的」），
 * 主源一天都没有才归备源。行级的 `source` 才是「这一天这条线是谁给的」。
 */
export function etfWindowSource(window: EtfCurrentStateWindow): EtfFlowSourceId {
  const rows = [...window.btc, ...window.eth]
  return rows.some((row) => row.source === etfCurrentStateWindowPolicy.sourceId)
    ? etfCurrentStateWindowPolicy.sourceId
    : rows[0]!.source
}

/**
 * 窗口的身份摘要：刷新与迁移共用这一份。两个地方各写一个哈希，换源那天就会一边认一边不认。
 * 旧行（source 为 legacy）也能算，迁移用它给无 revision 的窗口补一个确定性身份。
 */
export function etfWindowRevision(rows: readonly EtfDailyFlow[]): Readonly<{ providerCurrentStateId: string }> {
  return Object.freeze({
    providerCurrentStateId: createHash('sha256')
      .update(rows.map((row) => `${row.asset}:${row.tradingDate}:${row.netFlowUsd}:${row.source}:${row.sourceRevision ?? ''}`).join('|'))
      .digest('hex')
  })
}

function unavailable(): Extract<EtfCurrentStateWindowResult, { state: 'unavailable' }> {
  return Object.freeze({ state: 'unavailable' as const })
}
