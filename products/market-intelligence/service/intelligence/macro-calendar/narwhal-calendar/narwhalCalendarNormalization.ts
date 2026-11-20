/**
 * 两条源之间的三条归一规则（用户 2026-11-13 批准的口径）。
 *
 * 全部是纯函数，输入输出都不碰网络/库，换算过程作为证据返回——规矩是「不猜、不静默、留证据」：
 * 1. **量纲/符号**：万↔千、十亿↔美元、赤字/逆差记负；换算后数值相等，这**不算冲突**；
 * 2. **期间标错**：同一次发布却报出不同期间 → 用发布时刻反推（11-06 发的就业报告，数据期是 10 月），
 *    纠正结果连同依据一起留下；
 * 3. **同一身份被源拆成两次发布** → 按「精确时刻优先 > 带共识 > revision 大 > id 字典序」取一条，
 *    另一条留档不显示。
 */

export type NarwhalUnitScale = Readonly<{ factor: number; canonicalUnit: string }>

/**
 * 量纲换算表：**只收实测出现过的**（映射表里那几条）。
 *
 * 一万 = 10 千；十亿美元 = 1e9 美元。`display` 是换算后的规范单位，
 * 换算说明会随值一起存，方便读者/对账时看见「这个数是怎么来的」。
 */
export const narwhalUnitScales: Readonly<Record<string, NarwhalUnitScale>> = {
  '万人': { factor: 10, canonicalUnit: '千人' },
  '万': { factor: 10, canonicalUnit: '千' },
  '十亿美元': { factor: 1_000_000_000, canonicalUnit: '美元' },
  '百万美元': { factor: 1_000_000, canonicalUnit: '美元' },
  '千人': { factor: 1, canonicalUnit: '千人' },
  '人': { factor: 1, canonicalUnit: '人' },
  '%': { factor: 1, canonicalUnit: '%' }
}

/** 赤字/逆差记负：源里「财政赤字」常给正数，我们要的是有方向的量。 */
const negativeWhenDeficit = new Set(['财政赤字', '贸易逆差', 'federal_deficit', 'trade_balance_deficit'])

export type NarwhalNormalizedValue = Readonly<{
  /** 换算后的数值；`undefined` 表示给的不是数（来源写的是 `-` 或空）。 */
  value?: number
  unit: string
  /** 换算说明：`'万人 ×10 → 千人'`；没有换算就是 undefined。 */
  conversion?: string
}>

export function normalizeUnit(raw: string | undefined, unit: string | undefined, label?: string): NarwhalNormalizedValue {
  const numeric = numberOf(raw)
  const resolvedUnit = unit ?? ''
  if (numeric === undefined) return { unit: resolvedUnit }
  const scale = narwhalUnitScales[resolvedUnit]
  const negated = label !== undefined && negativeWhenDeficit.has(label) && numeric > 0
  const signed = negated ? -numeric : numeric
  const value = scale === undefined ? signed : signed * scale.factor
  const steps: string[] = []
  if (scale !== undefined && scale.factor !== 1) steps.push(`${resolvedUnit} ×${scale.factor} → ${scale.canonicalUnit}`)
  if (negated) steps.push('赤字/逆差记负')
  return {
    value,
    unit: scale?.canonicalUnit ?? resolvedUnit,
    ...(steps.length === 0 ? {} : { conversion: steps.join('；') })
  }
}

/** 半个显示位以内算一致；半个到一个是「一致但要能查」；超一个显示位才是冲突。 */
export type NarwhalValueAgreement = 'equal' | 'within-display' | 'conflict'

export function compareNormalized(left: number, right: number, displayDecimals: number): NarwhalValueAgreement {
  const unit = 10 ** -displayDecimals
  const difference = Math.abs(left - right)
  if (difference <= unit / 2) return 'equal'
  if (difference <= unit) return 'within-display'
  return 'conflict'
}

/**
 * 同一次发布却报出不同期间：用发布时刻反推数据期。
 *
 * 依据是发布惯例——期间为月的指标，发布时刻所在月的前一个月就是数据期（11-06 发 10 月就业）。
 * **只在「同一次发布（`at` 差 ≤ 5 分钟）却给出不同期间」时调用**；期间本来就不同的，各存各的，不比较。
 */
export function inferPeriodFromReleaseAt(at: string): string | undefined {
  const parsed = Date.parse(at)
  if (!Number.isFinite(parsed)) return undefined
  const date = new Date(parsed)
  const previous = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1))
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`
}

export type NarwhalCurrentCandidate = Readonly<{
  releaseId: string
  at: string
  dateBasis: 'exact' | 'indicative'
  hasConsensus: boolean
  revision: number
}>

/**
 * 同一身份被源拆成两次发布时，取哪一条当 `current`。
 *
 * 顺序固定：**精确时刻优先 > 带共识 > `revision` 大 > id 字典序**。
 * 「带共识」排在 revision 之前，是因为丢掉带共识那条，恰好丢掉换这个源的理由。
 */
export function pickCurrentRelease(candidates: readonly NarwhalCurrentCandidate[]): NarwhalCurrentCandidate | undefined {
  return [...candidates].sort((left, right) => {
    if (left.dateBasis !== right.dateBasis) return left.dateBasis === 'exact' ? -1 : 1
    if (left.hasConsensus !== right.hasConsensus) return left.hasConsensus ? -1 : 1
    if (left.revision !== right.revision) return right.revision - left.revision
    return left.releaseId < right.releaseId ? -1 : left.releaseId > right.releaseId ? 1 : 0
  })[0]
}

function numberOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const cleaned = raw.replace(/[,%+\s]/g, '').trim()
  if (cleaned === '' || cleaned === '-' || cleaned === '—') return undefined
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : undefined
}
