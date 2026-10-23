/**
 * 数值口径（设计 144）：读者能看到的每一族数，其来源、节律、观测时刻、算式与降级规则的**公共形状**。
 *
 * 形状放契约、内容按 owner 分处：算式里引用到的策略常量与函数各自在自己的进程里（服务侧的策略常量、
 * 渲染侧的取整函数），谁也不 import 对方——跨进程 import 是这条要求最容易踩坏的边界。
 *
 * `marketIntelligenceTraceabilityPolicy.families` 是**读者能看到的族**的完整清单：两张目录（服务侧、
 * 渲染侧）由测试断言**互不重叠且合起来等于它**，所以新增一族必须先登记在这里。
 */
export type TraceabilityFamilyId = 'cross-market-reading' | 'daily-rate-row' | 'chart-sampling'

export const marketIntelligenceTraceabilityPolicy = Object.freeze({
  /** 读者能看到的数的族。目录只能覆盖它，测试会断言两边合起来正好等于它。 */
  families: Object.freeze(['cross-market-reading', 'daily-rate-row', 'chart-sampling'] as const)
})

export type TraceabilityEntry = Readonly<{
  id: TraceabilityFamilyId
  /** 读者叫它什么：渲染层的 i18n key（服务侧不 import 渲染代码，所以这里只放 key）。 */
  nameKey: string
  /** 服务侧可读标签：给 agent 的索引要能读懂，`nameKey` 只在渲染侧能被解析。 */
  label: string
  /** 来源：哪条路线、哪个提供方、哪些序列。 */
  source: Readonly<{ route: string; providerIds: readonly string[]; seriesIds: readonly string[] }>
  /** 频率：bar 类给间隔引用，发布类给节律。 */
  cadence: Readonly<{ kind: 'bar'; intervalMsRef: string }> | Readonly<{ kind: 'release'; releaseCadence: string }>
  /** 观测时刻的规则。 */
  instant: Readonly<{ rule: 'bar-end' | 'release-day' | 'provider-observed' }>
  /**
   * 算式。文字给人读；**数字与阈值一律走引用**（`policyRefs` 是各自 owner 里的引用 id，`functionRefs` 是
   * 真实存在的函数名）——抄数字的目录会在策略改动后悄悄说谎。
   */
  formula: Readonly<{ id: string; expression: string; policyRefs: readonly string[]; functionRefs: readonly string[] }>
  /** 替身：代理/合成。 */
  substitutions: readonly string[]
  /** 降级：抽稀、携带上限、数据洞、未发布…… */
  degradations: readonly string[]
  /** 命中的 caveat id（与路由/分析侧用同一批 id，不另造字符串）。 */
  caveatIds: readonly string[]
}>

/** 口径查询的 method（设计 144 §4.2）：只读、无副作用。 */
export const provenanceMethods = Object.freeze({ explainFigure: 'intelligence.provenance.explainFigure' })

export type ProvenanceExplanation =
  | Readonly<{
    state: 'available'
    family: TraceabilityFamilyId
    nameKey: string
    source: Readonly<{ route: string; providerIds: readonly string[]; seriesIds: readonly string[] }>
    cadence: Readonly<{ kind: 'bar'; intervalMs: number }> | Readonly<{ kind: 'release'; releaseCadence: string }>
    instant: Readonly<{ rule: 'bar-end' | 'release-day' | 'provider-observed' }>
    formula: Readonly<{ id: string; expression: string; functionRefs: readonly string[] }>
    values: Readonly<Record<string, number | string>>
    substitutions: readonly string[]
    degradations: readonly string[]
    caveatIds: readonly string[]
  }>
  | Readonly<{ state: 'unavailable'; family: string; reason: 'not-on-this-side' | 'unknown-family'; ownedHere: readonly string[] }>

const familyPattern = /^[a-z][a-z0-9-]{0,63}$/

/** 请求只允许一个族名，长度与字符集都受限：这是一条只读的门，不该接受自由文本。 */
export function isProvenanceExplainQuery(value: unknown): value is Readonly<{ family: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.getOwnPropertyNames(value)
  return keys.length === 1 && keys[0] === 'family' &&
    typeof (value as { family?: unknown }).family === 'string' && familyPattern.test((value as { family: string }).family)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
/** 键集必须**正好**是这些：产品边界上的其它解析器同样 fail-closed，多一个键就是可疑形状。 */
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.getOwnPropertyNames(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
const strings = (value: unknown, maximum: number): value is string[] =>
  Array.isArray(value) && value.length <= maximum && value.every(item => typeof item === 'string')

/** 结果解析器：形状必须逐字合法，否则返回 undefined，由调用方降级为 unavailable。 */
export function parseProvenanceExplanation(value: unknown): ProvenanceExplanation | undefined {
  if (!record(value) || typeof value.state !== 'string' || typeof value.family !== 'string') return undefined
  if (!exact(value, value.state === 'unavailable' ? ['state', 'family', 'reason', 'ownedHere'] : ['state', 'family', 'nameKey', 'source', 'cadence', 'instant', 'formula', 'values', 'substitutions', 'degradations', 'caveatIds'])) return undefined
  if (value.state === 'unavailable') {
    const reason = value.reason
    if (reason !== 'not-on-this-side' && reason !== 'unknown-family') return undefined
    return strings(value.ownedHere, 32) ? (value as unknown as ProvenanceExplanation) : undefined
  }
  if (value.state !== 'available') return undefined
  const source = value.source
  const cadence = value.cadence
  const formula = value.formula
  const instant = value.instant
  if (!exact(source, ['route', 'providerIds', 'seriesIds']) || typeof source.route !== 'string' || !strings(source.providerIds, 16) || !strings(source.seriesIds, 32)) return undefined
  if (!record(cadence) || (cadence.kind !== 'bar' && cadence.kind !== 'release')) return undefined
  if (!exact(cadence, cadence.kind === 'bar' ? ['kind', 'intervalMs'] : ['kind', 'releaseCadence'])) return undefined
  if (cadence.kind === 'bar' ? typeof cadence.intervalMs !== 'number' || !Number.isFinite(cadence.intervalMs) : typeof cadence.releaseCadence !== 'string') return undefined
  if (!exact(instant, ['rule']) || !['bar-end', 'release-day', 'provider-observed'].includes(instant.rule as string)) return undefined
  if (!exact(formula, ['id', 'expression', 'functionRefs']) || typeof formula.id !== 'string' || typeof formula.expression !== 'string' || !strings(formula.functionRefs, 16)) return undefined
  if (!record(value.values) || !Object.values(value.values).every(item => typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)))) return undefined
  if (!strings(value.substitutions, 16) || !strings(value.degradations, 16) || !strings(value.caveatIds, 16)) return undefined
  return familyPattern.test(value.family) ? (value as unknown as ProvenanceExplanation) : undefined
}
