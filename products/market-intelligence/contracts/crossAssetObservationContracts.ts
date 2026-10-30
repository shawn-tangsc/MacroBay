// Product-owned boundary from CA1 design 125. No main-process or other-product imports.
export function parseCrossAssetCommandResult(method: string, value: unknown, now: number): CrossAssetCommandResult | undefined {
  const allowed: Record<string, readonly string[]> = {
    acquire: ['limited', 'unavailable'], renew: ['expired', 'unavailable'], release: ['released'],
    refresh: ['accepted', 'busy', 'disabled', 'limited', 'expired', 'unavailable'],
    getSourceConfiguration: ['unknown'], cancelInterfaceTest: ['cancelled'], testInterface: ['busy', 'limited', 'unavailable']
  }
  if (exact(value, ['state']) && typeof value.state === 'string' && allowed[method]?.includes(value.state)) return { state: value.state } as CrossAssetCommandResult
  if ((method === 'acquire' || method === 'renew') && exact(value, ['state', 'leaseId', 'expiresAt']) && value.state === 'active' &&
    parseCrossAssetInput(crossAssetMethods.renew, { leaseId: value.leaseId }, now) && Number.isSafeInteger(value.expiresAt) && (value.expiresAt as number) > now) {
    return { state: 'active', leaseId: value.leaseId as string, expiresAt: value.expiresAt as number }
  }
  if (method === 'getSourceConfiguration' && exact(value, ['state', 'enabled']) && (value.state === 'configured' || value.state === 'default') &&
    typeof value.enabled === 'boolean') return { state: value.state, enabled: value.enabled }
  if (method === 'testInterface' && exact(value, ['state', 'assets', 'testedAt']) &&
    exact(value.assets, [...crossAssetContractPolicy.assets]) && Number.isSafeInteger(value.testedAt) &&
    (value.testedAt as number) >= 0 && (value.testedAt as number) <= now) {
    const results = Object.values(value.assets)
    if (!results.every(result => exact(result, ['rest', 'ws']) && typeof result.rest === 'boolean' && typeof result.ws === 'boolean')) return
    const checks = results as { rest: boolean; ws: boolean }[]
    const state = checks.every(result => result.rest && result.ws) ? 'passed' : checks.some(result => result.rest || result.ws) ? 'partial' : 'failed'
    if (value.state === state) return structuredClone(value) as CrossAssetCommandResult
  }
}

export type CrossAssetCommandResult =
  | { state: 'active'; leaseId: string; expiresAt: number }
  | { state: 'configured' | 'default'; enabled: boolean }
  | { state: 'passed' | 'partial' | 'failed'; assets: Record<CrossAssetId, { rest: boolean; ws: boolean }>; testedAt: number }
  | { state: 'limited' | 'unavailable' | 'expired' | 'released' | 'accepted' | 'busy' | 'disabled' | 'unknown' | 'cancelled' }

export const crossAssetMethods = Object.freeze({
  acquire: 'intelligence.crossAsset.acquire', renew: 'intelligence.crossAsset.renew',
  release: 'intelligence.crossAsset.release', refresh: 'intelligence.crossAsset.refresh',
  getSourceConfiguration: 'intelligence.crossAsset.getSourceConfiguration', testInterface: 'intelligence.crossAsset.testInterface',
  cancelInterfaceTest: 'intelligence.crossAsset.cancelInterfaceTest', query: 'intelligence.crossAsset.query'
} as const)
export const crossAssetContractPolicy = Object.freeze({
  // 30d 不准入（读者 2026-10-16 决定），相关的表项已随之下线：这里只留准入的三个窗口，避免再出现
  // "策略里还写着 30 天"这种读者看得见却做不到的说法。
  ranges: Object.freeze(['1h', '24h', '7d'] as const), leaseIdMaxLength: 128,
  canonicalUtcPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  leaseIdPattern: /^[a-zA-Z0-9-]+$/,
  assets: Object.freeze(['index', 'btc', 'eth'] as const),
  /**
   * The macro lines drawn beside those three: the dollar and gold, the two instruments this product
   * collects on a bar cadence of their own. They are *not* collected symbols — the bars live in the
   * macro store, on another schedule and through other providers — so they are their own list rather
   * than members of `assets`, which is also the list the collector fills and the coverage table counts.
   */
  macroProxies: Object.freeze(['dxy', 'gold'] as const), maxSnapshotBytes: 192 * 1024,
  points: Object.freeze({ '1h': 13, '24h': 289, '7d': 169 }),
  coveragePoints: Object.freeze({ '1h': 13, '24h': 289, '7d': 2017 }),
  /**
   * What each range's history coverage counts, and against what.
   *
   * `instants`: every five-minute instant in the window. The retention hot tier (eight days) holds them
   * all, so a missing one is a real hole. `curve`: the points of the same-anchor curve the reader is
   * looking at — for a window that reaches the cold tier (one bar per hour out to thirty days), where
   * eleven of every twelve instants are thinned by policy rather than missing. Counting instants there
   * would report `2832/8641`, which reads as a defect and is not one.
   */
  coverageCounting: Object.freeze({
    '1h': { expected: 13, mode: 'instants' as const }, '24h': { expected: 289, mode: 'instants' as const },
    '7d': { expected: 2017, mode: 'instants' as const }
  }),
  reasons: Object.freeze(['missing', 'insufficient', 'zero-variance', 'stale']),
  sourceStates: Object.freeze(['disabled', 'connecting', 'live', 'stale', 'limited', 'unavailable']),
  expectedPairs: 288, minimumPairs: 231, maxPriceLength: 64, pricePattern: /^(?:0|[1-9]\d*)(?:\.\d+)?$/,
  intervalMs: 300_000, hourMs: 3_600_000,
  observationKeys: Object.freeze({ indexBtc: ['up', 'down', 'diverging', 'mixed', 'unavailable'], ethBtc: ['stronger', 'weaker', 'flat', 'unavailable'] }),
  /**
   * Which leg answers the Nasdaq 100 row: the licensed index, the tokenised Binance proxy that fills
   * it when the real source cannot answer, or nothing at all. The renderer reads this to decide
   * whether the row must carry the proxy label — the label is never inferred from a price.
   */
  indexSources: Object.freeze(['real', 'proxy', 'unavailable'] as const),
  /** A row is `closed` when its market is shut, not when its feed is quiet. */
  marketStates: Object.freeze(['open', 'closed', 'unavailable'] as const),
  /**
   * The cross-market reading's wire vocabulary (design 142).
   *
   * The *conditions* that make a scenario true live with the computation; only the words that may travel —
   * and the bounds the renderer can rely on — are named here, exactly as `observationKeys` does for the
   * older symbol comparison. `maximumRefuted` is here rather than in the service because it also bounds the
   * payload: the computation reads it from this policy so the two cannot disagree.
   */
  readingLegs: Object.freeze(['dxy', 'gold', 'index', 'btc'] as const),
  readingDirections: Object.freeze(['up', 'down', 'flat'] as const),
  readingScenarios: Object.freeze(['risk-off', 'discount-rate', 'risk-on', 'risk-on-recovery', 'crypto-specific'] as const),
  readingNotices: Object.freeze(['index-proxy', 'dxy-synthetic', 'gold-synthetic'] as const),
  readingReasons: Object.freeze(['window-not-judged', 'legs-missing', 'stale', 'no-match'] as const),
  maximumRefuted: 3,
  emptyMethods: Object.freeze([crossAssetMethods.acquire, crossAssetMethods.getSourceConfiguration, crossAssetMethods.testInterface, crossAssetMethods.cancelInterfaceTest]),
  leaseMethods: Object.freeze([crossAssetMethods.renew, crossAssetMethods.release, crossAssetMethods.refresh])
})
export type CrossAssetRange = typeof crossAssetContractPolicy.ranges[number]
/**
 * Which version of a historical window answers it: `as-of` is what was known at that instant, `latest`
 * is what is known now.
 *
 * The store is bitemporal (bar instant plus `observed_at`), and `as-of` is the default because a
 * historical chart honestly reproduces "what the reader saw then". That same rule also hides every bar
 * ingested after the instant — a late poll, or a whole window backfilled after a restart — which is
 * wrong for a derived reading of a past window: the calendar card's ±30-minute reaction asks what the
 * market did, not what this machine had already downloaded at minute +35. Such readers ask for `latest`.
 */
export type CrossAssetKnowledge = 'as-of' | 'latest'
export type CrossAssetQueryInput = { range: CrossAssetRange; asOf?: string; knowledge?: CrossAssetKnowledge }
export type CrossAssetInput = Record<string, never> | { leaseId: string } | CrossAssetQueryInput
export type CrossAssetId = typeof crossAssetContractPolicy.assets[number]
export type CrossAssetMacroProxyId = typeof crossAssetContractPolicy.macroProxies[number]
export type CrossAssetMetric = { state: 'available'; value: number } | { state: 'unavailable'; reason: 'missing' | 'insufficient' | 'zero-variance' | 'stale' }
export type CrossAssetQuote = { state: 'missing' } | { state: 'live' | 'stale'; price: string; tradedAtMs: number; receivedAtMs: number }
export type CrossAssetIndexSourceId = typeof crossAssetContractPolicy.indexSources[number]
export type CrossAssetMarketStateId = typeof crossAssetContractPolicy.marketStates[number]
export type CrossAssetSnapshot = {
  schemaVersion: 1; mode: 'current' | 'historical'; servedAt: string; asOf: string; range: CrossAssetRange
  analysisEnd: string; windowStart: string
  historyCoverage: Record<CrossAssetId, { count: number; expectedCount: number; complete: boolean }>
  curves: Record<CrossAssetId, { at: string; returnPercent: number | null }[]>
  /**
   * The macro rows' own same-anchor curves, on the same grid as `curves` so the lines are comparable.
   *
   * Optional on purpose: a main process from before these lines existed must still produce a snapshot
   * this renderer accepts — the panel then simply draws three lines instead of five — rather than the
   * whole block failing closed until the app is restarted.
   */
  macroCurves?: Record<CrossAssetMacroProxyId, { at: string; returnPercent: number | null }[]>
  closedReturns: Record<CrossAssetId, Record<'5m' | '15m' | '1h' | '4h' | '24h' | '7d', CrossAssetMetric>>
  correlations: Record<'indexBtc' | 'indexEth', CrossAssetMetric & { sampleCount: number; expectedCount: number }>
  relativeReturns: Record<'btcMinusIndex' | 'ethMinusBtc', CrossAssetMetric>
  indexSource: CrossAssetIndexSourceId
  sourceState?: 'disabled' | 'connecting' | 'live' | 'stale' | 'limited' | 'unavailable'
  quotes?: Record<CrossAssetId, CrossAssetQuote>
  forming?: Record<CrossAssetId, { at: string; returnPercent: number } | null>
  /** Stated only in `current` mode: the session of each row, and the last bar that actually closed. */
  marketState?: Record<CrossAssetId, CrossAssetMarketStateId>
  lastClosed?: Record<CrossAssetId, { at: string; close: string } | null>
  observationKey: { indexBtc: 'up' | 'down' | 'diverging' | 'mixed' | 'unavailable'; ethBtc: 'stronger' | 'weaker' | 'flat' | 'unavailable' }
  /**
   * The cross-market reading (design 142), optional for the same reason `macroCurves` is: a main process
   * from before it existed must still produce a snapshot this renderer accepts, and the panel then simply
   * does not draw the reading line.
   */
  reading?: CrossAssetReading
}

type CrossAssetReadingLeg = typeof crossAssetContractPolicy.readingLegs[number]
type CrossAssetReadingDirection = typeof crossAssetContractPolicy.readingDirections[number]
type CrossAssetReadingScenarioId = typeof crossAssetContractPolicy.readingScenarios[number]
type CrossAssetReadingNoticeId = typeof crossAssetContractPolicy.readingNotices[number]
type CrossAssetReadingReason = typeof crossAssetContractPolicy.readingReasons[number]
type CrossAssetReadingRefutation = Readonly<{ scenario: CrossAssetReadingScenarioId; leg: CrossAssetReadingLeg }>
export type CrossAssetReading =
  | Readonly<{
    state: 'judged'
    window: '24h'
    scenario: CrossAssetReadingScenarioId
    legs: readonly Readonly<{ leg: CrossAssetReadingLeg; direction: CrossAssetReadingDirection; returnPercent: number }>[]
    refuted: readonly CrossAssetReadingRefutation[]
    correlation: Readonly<{ state: 'available'; value: number; sampleCount: number; expectedCount: number; window: '24h'; interval: '5m' }>
      | Readonly<{ state: 'unavailable'; reason: string }>
    relativeReturns: Readonly<{ btcMinusIndex: number | null; ethMinusBtc: number | null }>
    notices: readonly CrossAssetReadingNoticeId[]
  }>
  | Readonly<{
    state: 'undetermined'
    reason: CrossAssetReadingReason
    leg?: CrossAssetReadingLeg
    /** 只有"认不出组合"时才带四条腿：那是兜底描述的依据。 */
    legs?: readonly Readonly<{ leg: CrossAssetReadingLeg; direction: CrossAssetReadingDirection; returnPercent: number }>[]
    refuted: readonly CrossAssetReadingRefutation[]
  }>

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
  return Object.getOwnPropertySymbols(value).length === 0 &&
    Object.getOwnPropertyNames(value).every(key => 'value' in Object.getOwnPropertyDescriptor(value, key)!)
}

export function parseCrossAssetInput(method: string, value: unknown, nowMs: number): CrossAssetInput | undefined {
  const policy = crossAssetContractPolicy
  try {
    if (!Number.isSafeInteger(nowMs) || !record(value)) return
    const keys = Object.getOwnPropertyNames(value)
    if ((policy.emptyMethods as readonly string[]).includes(method)) return keys.length === 0 ? {} : undefined
    if ((policy.leaseMethods as readonly string[]).includes(method)) {
      return keys.length === 1 && typeof value.leaseId === 'string' && value.leaseId.length <= policy.leaseIdMaxLength &&
        policy.leaseIdPattern.test(value.leaseId) ? { leaseId: value.leaseId } : undefined
    }
    if (method !== crossAssetMethods.query || !keys.includes('range') ||
      keys.some(key => key !== 'range' && key !== 'asOf' && key !== 'knowledge') ||
      !policy.ranges.includes(value.range as CrossAssetRange)) return
    const range = value.range as CrossAssetRange
    const knowledge = value.knowledge
    if (knowledge !== undefined && knowledge !== 'as-of' && knowledge !== 'latest') return
    // A version rule only means something next to a window end; without `asOf` the query is current and
    // already reads the newest version of everything.
    if (!Object.hasOwn(value, 'asOf')) return knowledge === undefined ? { range } : undefined
    const asOf = value.asOf
    if (typeof asOf !== 'string' || !policy.canonicalUtcPattern.test(asOf) || !Number.isFinite(Date.parse(asOf)) ||
      new Date(asOf).toISOString() !== asOf || Date.parse(asOf) > nowMs) return
    return knowledge === undefined ? { range, asOf } : { range, asOf, knowledge }
  } catch { return }
}

function exact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.getOwnPropertyNames(value).length === fields.length && fields.every(field => Object.hasOwn(value, field))
}
function utc(value: unknown): value is string {
  return typeof value === 'string' && crossAssetContractPolicy.canonicalUtcPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function metric(value: unknown, correlation = false): boolean {
  if (!record(value)) return false
  const extras = correlation ? ['sampleCount', 'expectedCount'] : []
  if (correlation && (!Number.isSafeInteger(value.sampleCount) || (value.sampleCount as number) < 0 ||
    (value.sampleCount as number) > crossAssetContractPolicy.expectedPairs || value.expectedCount !== crossAssetContractPolicy.expectedPairs)) return false
  return value.state === 'available' ? exact(value, ['state', 'value', ...extras]) && typeof value.value === 'number' && Number.isFinite(value.value) &&
    (!correlation || (Math.abs(value.value) <= 1 && (value.sampleCount as number) >= crossAssetContractPolicy.minimumPairs)) : value.state === 'unavailable' && exact(value, ['state', 'reason', ...extras]) &&
      typeof value.reason === 'string' && crossAssetContractPolicy.reasons.includes(value.reason)
}
/**
 * The reading's own validator: every id has to come from the policy above, every number has to be a real
 * number, and the refutation list may not exceed the bound the renderer phrases.
 */
/** 四条腿的形状（顺序、id、方向、有限数值）：判读与兜底描述共用同一份校验。 */
function legs(value: unknown): boolean {
  const policy = crossAssetContractPolicy
  return Array.isArray(value) && value.length === policy.readingLegs.length &&
    value.every((leg, index) => record(leg) && exact(leg, ['leg', 'direction', 'returnPercent']) &&
      leg.leg === policy.readingLegs[index] && typeof leg.direction === 'string' && policy.readingDirections.includes(leg.direction as never) &&
      typeof leg.returnPercent === 'number' && Number.isFinite(leg.returnPercent))
}

function reading(value: unknown, range: string): value is CrossAssetReading {
  const policy = crossAssetContractPolicy
  if (!record(value) || typeof value.state !== 'string') return false
  const refutations = (items: unknown): boolean => Array.isArray(items) && items.length <= policy.maximumRefuted &&
    items.every(item => record(item) && typeof item.scenario === 'string' && policy.readingScenarios.includes(item.scenario as never) &&
      typeof item.leg === 'string' && policy.readingLegs.includes(item.leg as never))
  if (value.state === 'undetermined') {
    const allowed = ['state', 'reason', 'refuted', 'leg', 'legs']
    const keys = Object.getOwnPropertyNames(value)
    if (keys.some(key => !allowed.includes(key)) || !['state', 'reason', 'refuted'].every(key => keys.includes(key))) return false
    if (typeof value.reason !== 'string' || !policy.readingReasons.includes(value.reason as never)) return false
    if (value.leg !== undefined && (typeof value.leg !== 'string' || !policy.readingLegs.includes(value.leg as never))) return false
    // 四条腿只解释"认不出组合"：缺腿或停更时不存在完整的腿集，那种载荷是伪造或 bug。
    if (value.legs !== undefined && (value.reason !== 'no-match' || !legs(value.legs))) return false
    return refutations(value.refuted)
  }
  if (value.state !== 'judged' || !exact(value, ['state', 'window', 'scenario', 'legs', 'refuted', 'correlation', 'relativeReturns', 'notices'])) return false
  // 判读恒为 24 小时口径：它出现在别的 range 的快照上就是把两个周期混进一句话（设计 142 §3.3/H1）。
  if (value.window !== '24h' || range !== '24h' || typeof value.scenario !== 'string' || !policy.readingScenarios.includes(value.scenario as never)) return false
  if (!legs(value.legs)) return false
  if (!refutations(value.refuted)) return false
  // 自相矛盾的判读不予通过：被判定的剧本不能同时出现在"不像"里，同一条腿也不能重复出现。
  const refutedList = value.refuted as readonly Readonly<{ scenario?: unknown; leg?: unknown }>[]
  if (refutedList.some(item => item.scenario === value.scenario)) return false
  const pairs = refutedList.map(item => `${String(item.scenario)}:${String(item.leg)}`)
  if (new Set(pairs).size !== pairs.length) return false
  const correlation = value.correlation
  if (!record(correlation) || typeof correlation.state !== 'string') return false
  if (correlation.state === 'available') {
    if (!exact(correlation, ['state', 'value', 'sampleCount', 'expectedCount', 'window', 'interval']) || correlation.window !== '24h' || correlation.interval !== '5m') return false
    if (typeof correlation.value !== 'number' || !Number.isFinite(correlation.value) || Math.abs(correlation.value) > 1 ||
      !Number.isSafeInteger(correlation.sampleCount) || (correlation.sampleCount as number) < policy.minimumPairs ||
      (correlation.sampleCount as number) > policy.expectedPairs || correlation.expectedCount !== policy.expectedPairs) return false
  } else if (correlation.state !== 'unavailable' || !exact(correlation, ['state', 'reason']) || typeof correlation.reason !== 'string') return false
  if (!exact(value.relativeReturns, ['btcMinusIndex', 'ethMinusBtc']) ||
    !Object.values(value.relativeReturns).every(item => item === null || (typeof item === 'number' && Number.isFinite(item)))) return false
  return Array.isArray(value.notices) && value.notices.every(notice => typeof notice === 'string' && policy.readingNotices.includes(notice as never))
}

/**
 * 曲线网格步长（毫秒）：窗口的 5 分钟网格 ÷ 该窗口曲线上的点数（7d 2017/169 → 每小时，30d 8641/181 → 每 4 小时）。
 *
 * 这是网格规则的**唯一**推导处：契约校验、服务侧画宏观线、渲染侧算步长都读它。评审发现服务侧仍在用
 * `range === '7d' ? hour : 5min` 的三元，于是 30d 的宏观线落在 5 分钟网格上、被契约自己拒收——整包快照
 * 因此非法（界面上就是「行情暂不可用」）。
 */
export function crossAssetCurveStrideMs(range: CrossAssetRange): number {
  return crossAssetContractPolicy.intervalMs *
    ((crossAssetContractPolicy.coveragePoints[range] - 1) / (crossAssetContractPolicy.points[range] - 1))
}

export function parseCrossAssetSnapshot(value: unknown): CrossAssetSnapshot | undefined {
  const policy = crossAssetContractPolicy
  try {
    if (!record(value)) return
    const fields = ['schemaVersion', 'mode', 'servedAt', 'asOf', 'range', 'analysisEnd', 'windowStart', 'historyCoverage', 'curves', 'closedReturns', 'correlations', 'relativeReturns', 'observationKey', 'indexSource']
    // The macro lines are optional, and `exact` counts fields: a snapshot that carries them must list
    // them, and one from a main process that does not must not be asked for them.
    if (value.macroCurves !== undefined) fields.push('macroCurves')
    // Optional like `macroCurves`: an older main process sends no field at all and must still pass. A field
    // that *is* sent has to be a reading this renderer can phrase without inventing anything.
    if (value.reading !== undefined) fields.push('reading')
    if (value.mode === 'current') fields.push('sourceState', 'quotes', 'forming', 'marketState', 'lastClosed')
    else if (value.mode !== 'historical') return
    if (!exact(value, fields) || value.schemaVersion !== 1 || !policy.ranges.includes(value.range as CrossAssetRange) ||
      ![value.servedAt, value.asOf, value.analysisEnd, value.windowStart].every(utc)) return
    const range = value.range as CrossAssetRange
    const end = Date.parse(value.analysisEnd as string)
    const start = Date.parse(value.windowStart as string)
    const asOf = Date.parse(value.asOf as string)
    const stride = crossAssetCurveStrideMs(range)
    if (asOf > Date.parse(value.servedAt as string) || end !== Math.floor(asOf / policy.intervalMs) * policy.intervalMs ||
      start !== end - (policy.coveragePoints[range] - 1) * policy.intervalMs) return
    if (!exact(value.observationKey, ['indexBtc', 'ethBtc']) || !Object.entries(value.observationKey).every(([key, item]) =>
      typeof item === 'string' && policy.observationKeys[key as 'indexBtc' | 'ethBtc'].includes(item) &&
      (value.mode !== 'historical' || item === 'unavailable'))) return
    if (typeof value.indexSource !== 'string' || !(policy.indexSources as readonly string[]).includes(value.indexSource)) return
    if (!exact(value.historyCoverage, policy.assets) || !exact(value.curves, policy.assets) || !exact(value.closedReturns, policy.assets) ||
      !exact(value.correlations, ['indexBtc', 'indexEth']) || !exact(value.relativeReturns, ['btcMinusIndex', 'ethMinusBtc'])) return
    for (const asset of policy.assets) {
      const coverage = value.historyCoverage[asset]
      if (!exact(coverage, ['count', 'expectedCount', 'complete']) || !Number.isSafeInteger(coverage.count) ||
        (coverage.count as number) < 0 || (coverage.count as number) > policy.coveragePoints[range] ||
        coverage.expectedCount !== policy.coverageCounting[range].expected || coverage.complete !== (coverage.count === coverage.expectedCount)) return
      const curve = value.curves[asset]
      if (!Array.isArray(curve) || curve.length !== policy.points[range]) return
      let last = -Infinity
      for (const [index, point] of curve.entries()) {
        if (!exact(point, ['at', 'returnPercent']) || !utc(point.at) || Date.parse(point.at) <= last ||
          Date.parse(point.at) !== start + index * stride ||
          (point.returnPercent !== null && (typeof point.returnPercent !== 'number' || !Number.isFinite(point.returnPercent)))) return
        last = Date.parse(point.at)
      }
      const returns = value.closedReturns[asset]
      if (!exact(returns, ['5m', '15m', '1h', '4h', '24h', '7d']) || !Object.values(returns).every(value => metric(value))) return
    }
    /**
     * The macro lines, when this build draws them. A main process that predates them sends no field at
     * all and must still pass — the panel then draws the three crypto lines — but a field that *is* sent
     * has to be a real curve: on the same grid, in the same order, with the same admissible points. An
     * empty curve is legal and means something specific: no close before the window start could anchor
     * it, so there is no same-anchor line to draw at all.
     */
    if (value.macroCurves !== undefined) {
      if (!exact(value.macroCurves, policy.macroProxies)) return
      for (const proxy of policy.macroProxies) {
        const curve = value.macroCurves[proxy]
        if (!Array.isArray(curve) || curve.length !== 0 && curve.length !== policy.points[range]) return
        let previous = -Infinity
        for (const [index, point] of curve.entries()) {
          if (!exact(point, ['at', 'returnPercent']) || !utc(point.at) || Date.parse(point.at) <= previous ||
            Date.parse(point.at) !== start + index * stride ||
            (point.returnPercent !== null && (typeof point.returnPercent !== 'number' || !Number.isFinite(point.returnPercent)))) return
          previous = Date.parse(point.at)
        }
      }
    }
    if (value.reading !== undefined && !reading(value.reading, range)) return
    if (!Object.values(value.correlations).every(value => metric(value, true)) || !Object.values(value.relativeReturns).every(value => metric(value))) return
    if (value.mode === 'current') {
      if (typeof value.sourceState !== 'string' || !policy.sourceStates.includes(value.sourceState) || !exact(value.quotes, policy.assets) ||
        !exact(value.forming, policy.assets) || !exact(value.marketState, policy.assets) || !exact(value.lastClosed, policy.assets)) return
      // The row's session, its last closed bar and the leg that answers it are one statement, and the
      // three have to agree: a row with no source has no reading, and a row with a source always has
      // the last bar it closed on. A snapshot that cannot say both is refused rather than displayed.
      const answersRow = value.indexSource !== 'unavailable'
      const hasReading = value.marketState.index !== 'unavailable' && value.lastClosed.index !== null
      if (answersRow !== hasReading) return
      for (const asset of policy.assets) {
        if (!(policy.marketStates as readonly string[]).includes(value.marketState[asset] as string)) return
        const closed = value.lastClosed[asset]
        if (closed === null) continue
        if (!exact(closed, ['at', 'close']) || !utc(closed.at) || typeof closed.close !== 'string' ||
          closed.close.length > policy.maxPriceLength || !policy.pricePattern.test(closed.close) ||
          !Number.isFinite(Number(closed.close)) || Number(closed.close) <= 0 ||
          Date.parse(closed.at) > Date.parse(value.analysisEnd as string)) return
      }
      // While the real index answers the row there is no live tick for it. A quote printed beside that
      // value would belong to the other instrument, so the contract refuses to carry one.
      const indexQuote = value.quotes.index as { state?: unknown } | undefined
      if (value.indexSource !== 'proxy' && indexQuote?.state !== 'missing') return
      for (const asset of policy.assets) {
        const tail = value.forming[asset]
        if (tail === null) continue
        const quote = value.quotes[asset]
        const curve = value.curves[asset] as { returnPercent: number | null }[]
        if (value.sourceState !== 'live' || !record(quote) || quote.state !== 'live' || curve[0].returnPercent !== 0 || curve.at(-1)?.returnPercent === null) return
        if (range === '7d' || !exact(tail, ['at', 'returnPercent']) || !utc(tail.at) || typeof tail.returnPercent !== 'number' ||
          !Number.isFinite(tail.returnPercent) || Date.parse(tail.at) <= Date.parse(value.analysisEnd as string) || Date.parse(tail.at) > Date.parse(value.asOf as string)) return
      }
      for (const quote of Object.values(value.quotes)) {
        if (!record(quote)) return
        if (quote.state === 'missing') { if (!exact(quote, ['state'])) return; continue }
        if (!exact(quote, ['state', 'price', 'tradedAtMs', 'receivedAtMs']) || (quote.state !== 'live' && quote.state !== 'stale') ||
          typeof quote.price !== 'string' || quote.price.length > policy.maxPriceLength || !policy.pricePattern.test(quote.price) ||
          !Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0 ||
          ![quote.tradedAtMs, quote.receivedAtMs].every(at => Number.isSafeInteger(at) && (at as number) >= 0)) return
      }
    }
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > policy.maxSnapshotBytes) return
    return structuredClone(value) as CrossAssetSnapshot
  } catch { return }
}
