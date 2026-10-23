import { marketIntelligenceTraceabilityPolicy } from '../../../contracts/provenanceContracts'
import type { TraceabilityFamilyId } from '../../../contracts/provenanceContracts'
import {
  isTraceabilityFamilyOwnedHere, resolveTraceability, resolveTraceabilityPolicyRefs, traceabilityFamiliesOwnedHere,
  traceabilityPolicyRefs
} from './traceabilityCatalog'

/**
 * `explainFigure` 的服务侧内核（设计 144 §4.2）：给定"哪一族"，说清**来源、节律、观测时刻、算式**，
 * 并附上这次真正用到的数字与阈值。
 *
 * 它只做一件事，但必须是**诚实**的那一件：
 *
 * - 属于这一侧的族 → 返回目录条目 + **回答时现读**的策略引用值（不是目录里抄下来的快照）；
 * - 属于**另一侧**的族（渲染侧算的日频行）→ 明说"不在这一侧"，让调用方去问对面，而不是编一条；
 * - 不认识的族 → 明说"没有这一族的记录"，**不猜**（设计 144 §5.7）。
 *
 * 这一层不含 IPC、不含快照：它是纯函数，所以"口径只有一个 owner"这件事能在这里被完整测掉；把当前读数
 * （例如判读的四条腿与各自的界线数值）拼进来是它外面那一层的事。
 */
export type TraceabilityExplanation =
  | Readonly<{
    state: 'available'
    family: TraceabilityFamilyId
    nameKey: string
    source: Readonly<{ route: string; providerIds: readonly string[]; seriesIds: readonly string[] }>
    cadence: Readonly<{ kind: 'bar'; intervalMs: number }> | Readonly<{ kind: 'release'; releaseCadence: string }>
    instant: Readonly<{ rule: 'bar-end' | 'release-day' | 'provider-observed' }>
    formula: Readonly<{ id: string; expression: string; functionRefs: readonly string[] }>
    /** 这次真正用到的数字与阈值：回答的那一刻从 owner 读出。 */
    values: Readonly<Record<string, number | string>>
    substitutions: readonly string[]
    degradations: readonly string[]
    caveatIds: readonly string[]
  }>
  | Readonly<{ state: 'unavailable'; family: string; reason: 'not-on-this-side' | 'unknown-family'; ownedHere: readonly string[] }>

export function explainFigure(family: string): TraceabilityExplanation {
  const ownedHere = traceabilityFamiliesOwnedHere
  if (!isTraceabilityFamilyOwnedHere(family)) {
    // 契约声明了但不归这一侧 → 让调用方去问对面；契约里根本没有 → 没有这一族的记录。两者必须分开说。
    const declared = (marketIntelligenceTraceabilityPolicy.families as readonly string[]).includes(family)
    return Object.freeze({ state: 'unavailable', family, reason: declared ? 'not-on-this-side' : 'unknown-family', ownedHere })
  }
  const entry = resolveTraceability(family)!
  const refs = resolveTraceabilityPolicyRefs(entry)
  // 节律里的间隔也是**引用**：回答时从同一个 owner 读，避免目录里再存一份毫秒数。
  // 节律的引用是它自己的引用（不必出现在算式的 policyRefs 里）：直接问注册表，回答时现读。
  const cadence = entry.cadence.kind === 'bar'
    ? Object.freeze({ kind: 'bar' as const, intervalMs: Number(traceabilityPolicyRefs[entry.cadence.intervalMsRef as keyof typeof traceabilityPolicyRefs]()) })
    : Object.freeze({ kind: 'release' as const, releaseCadence: entry.cadence.releaseCadence })
  return Object.freeze({
    state: 'available', family: entry.id, nameKey: entry.nameKey, source: entry.source, cadence,
    instant: entry.instant,
    formula: Object.freeze({ id: entry.formula.id, expression: entry.formula.expression, functionRefs: entry.formula.functionRefs }),
    values: Object.freeze({ ...refs }),
    substitutions: entry.substitutions, degradations: entry.degradations, caveatIds: entry.caveatIds
  })
}
