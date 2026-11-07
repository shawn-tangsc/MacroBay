import type { AgentFact } from '../../../contracts/marketAnalysisContracts'

/**
 * 背离一致性（`02` 系统设计 §8「分析输出校验：背离一致性」）。
 *
 * 卡说背离、分析说没背离，原来只有提示词的软约束。这块只做一件事：把模型**说出口的**立场与快照里
 * 已有的事实比一遍，返回一个可命名缺陷；错误码与修复流程留在校验器那侧。
 *
 * 三条口径，缺一不可：
 * - **沉默不判**：不带这个块、空数组、或只提别的对 → 没有缺陷（否则等于逼分析对每一对点头）。
 * - **不说反**：`divergence-<pairId>` 事实存在即该对背离成立（值 `bearish` / `bullish` / `unpriced`）；
 *   值是 `none` 或读不出来按"查过、没背离"。
 * - **不编对**：`pairId` 只能取自快照；认不出来是引用缺陷，不是"意见不同"。
 */
export type AnalysisDivergenceStance = Readonly<{ pairId: string; stance: 'diverging' | 'not-diverging' }>

/** 缺陷种类：由调用方映射成自己的错误码与 rule 名（本模块不认识错误码）。 */
export type AnalysisDivergenceDefect = 'shape' | 'unknown-pair' | 'contradiction'

const STANCES: readonly string[] = Object.freeze(['diverging', 'not-diverging'])

/** 可选块的形状：数组、条数不超上限、每项恰好两个键、取值在闭集里。 */
export function isAnalysisDivergenceBlock(value: unknown, maximumItems: number): value is readonly AnalysisDivergenceStance[] {
  return Array.isArray(value) && value.length <= maximumItems && value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const keys = Object.keys(entry)
    if (keys.length !== 2 || !keys.every((key) => key === 'pairId' || key === 'stance')) return false
    const candidate = entry as { pairId?: unknown; stance?: unknown }
    return typeof candidate.pairId === 'string' && candidate.pairId.trim().length > 0 && candidate.pairId.length <= 64
      && typeof candidate.stance === 'string' && STANCES.includes(candidate.stance)
  })
}

/**
 * 快照里每对背离的**证据立场**。`divergence-escalation` 是汇总行，不对应某一对，跳过。
 * 同一对出现两次时取第一条——事实表按 factId 唯一，重复是数据问题，不是两种立场。
 */
export function divergenceEvidenceStances(facts: readonly Pick<AgentFact, 'metric' | 'value'>[]): ReadonlyMap<string, 'diverging' | 'not-diverging'> {
  const stances = new Map<string, 'diverging' | 'not-diverging'>()
  for (const fact of facts) {
    const metric = String(fact.metric ?? '')
    if (!metric.startsWith('divergence-')) continue
    const pairId = metric.slice('divergence-'.length).trim()
    if (pairId.length === 0 || pairId === 'escalation') continue
    if (stances.has(pairId)) continue
    const value = typeof fact.value === 'string' ? fact.value.trim() : ''
    stances.set(pairId, value === 'bearish' || value === 'bullish' || value === 'unpriced' ? 'diverging' : 'not-diverging')
  }
  return stances
}

/** 说出口的立场与证据比一遍。没说 → 无缺陷；认不出 → `unknown-pair`；相反 → `contradiction`。 */
export function divergenceDefectOf(
  stated: readonly AnalysisDivergenceStance[] | undefined,
  facts: readonly Pick<AgentFact, 'metric' | 'value'>[]
): AnalysisDivergenceDefect | undefined {
  if (stated === undefined || stated.length === 0) return undefined
  const stances = divergenceEvidenceStances(facts)
  for (const entry of stated) {
    const known = stances.get(entry.pairId)
    if (known === undefined) return 'unknown-pair'
    if (known !== entry.stance) return 'contradiction'
  }
  return undefined
}
