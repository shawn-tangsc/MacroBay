import {
  crossAssetContractPolicy,
  type CrossAssetReading
} from './crossAssetObservationContracts'

/**
 * 快照校验的零件：形状、字段集、时刻、指标、判读、最后收盘。从 `crossAssetObservationContracts.ts`
 * 搬出来只为控体积（门禁 500 行），**行为与导出面一字未改**；`parseCrossAssetSnapshot` 仍在原文件导出。
 *
 * 为什么这些还是独立函数而不是内联：它们的判据被多处共用（输入校验、快照校验、判读与兜底描述），
 * 内联会让同一规则出现第二份。
 */

export function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
  return Object.getOwnPropertySymbols(value).length === 0 &&
    Object.getOwnPropertyNames(value).every(key => 'value' in Object.getOwnPropertyDescriptor(value, key)!)
}

export function exact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.getOwnPropertyNames(value).length === fields.length && fields.every(field => Object.hasOwn(value, field))
}
export function utc(value: unknown): value is string {
  return typeof value === 'string' && crossAssetContractPolicy.canonicalUtcPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
export function metric(value: unknown, correlation = false): boolean {
  if (!record(value)) return false
  const extras = correlation ? ['sampleCount', 'expectedCount'] : []
  if (correlation && (!Number.isSafeInteger(value.sampleCount) || (value.sampleCount as number) < 0 ||
    (value.sampleCount as number) > crossAssetContractPolicy.expectedPairs || value.expectedCount !== crossAssetContractPolicy.expectedPairs)) return false
  // `atMs` 是**可选**的：只有 `closedReturns` 那几格带它，`relativeReturns` 与可用的相关性都不带。
  // `exact()` 数属性个数，所以字段表要按有没有这个键分别给——写成固定字段就把它变成了必填
  // （2026-11-11 事故：服务真产出的快照被自己拒在 `keys`）。
  const metricFields = value.atMs === undefined ? ['state', 'value', ...extras] : ['state', 'value', 'atMs', ...extras]
  return value.state === 'available' ? exact(value, metricFields) && typeof value.value === 'number' && Number.isFinite(value.value) &&
    (value.atMs === undefined || (typeof value.atMs === 'string' && crossAssetContractPolicy.canonicalUtcPattern.test(value.atMs) && Number.isFinite(Date.parse(value.atMs)))) &&
    (!correlation || (Math.abs(value.value) <= 1 && (value.sampleCount as number) >= crossAssetContractPolicy.minimumPairs)) : value.state === 'unavailable' && exact(value, ['state', 'reason', ...extras]) &&
      typeof value.reason === 'string' && crossAssetContractPolicy.reasons.includes(value.reason)
}
/**
 * The reading's own validator: every id has to come from the policy above, every number has to be a real
 * number, and the refutation list may not exceed the bound the renderer phrases.
 */
/** 四条腿的形状（顺序、id、方向、有限数值）：判读与兜底描述共用同一份校验。 */
export function legs(value: unknown): boolean {
  const policy = crossAssetContractPolicy
  return Array.isArray(value) && value.length === policy.readingLegs.length &&
    value.every((leg, index) => record(leg) && exact(leg, ['leg', 'direction', 'returnPercent']) &&
      leg.leg === policy.readingLegs[index] && typeof leg.direction === 'string' && policy.readingDirections.includes(leg.direction as never) &&
      typeof leg.returnPercent === 'number' && Number.isFinite(leg.returnPercent))
}

export function reading(value: unknown, range: string): value is CrossAssetReading {
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
 * The last closed bar each row prints, held to one shape whoever asks.
 *
 * Both modes carry it now, and the same rules apply: every asset present, `null` for "this market had
 * no bar at or before the window end", and otherwise a real decimal price with a UTC instant that does
 * not sit after the window end. One implementation on purpose — a second, looser check on the historical
 * branch is how an unvalidated number would reach a row that prints it as a level.
 */
export function lastClosedMap(value: unknown, analysisEnd: string): boolean {
  const policy = crossAssetContractPolicy
  if (!exact(value, policy.assets)) return false
  const map = value as Record<string, unknown>
  return policy.assets.every((asset) => {
    const closed = map[asset]
    if (closed === null) return true
    if (!exact(closed, ['at', 'close'])) return false
    const { at, close } = closed as Record<string, unknown>
    return utc(at) && typeof close === 'string' && close.length <= policy.maxPriceLength &&
      policy.pricePattern.test(close) && Number.isFinite(Number(close)) && Number(close) > 0 &&
      Date.parse(at) <= Date.parse(analysisEnd)
  })
}
