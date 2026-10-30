import type { AgentFact } from '../../../contracts/marketAnalysisContracts'
import { MARKET_ANALYSIS_POLICY_PATH_POLICY } from '../../../contracts/marketAnalysisContracts'

/**
 * The macro ceiling, applied with the policy path's fixed share protected.
 *
 * The ceiling exists because one provider's routine rows can crowd out capital, sentiment and
 * funding. A plain "newest ninety" also drops the policy path whenever a busy macro month is newer
 * than the last SEP or decision — the exact facts the reader asked for. The policy facts are a small
 * fixed set, so they are kept first and the remaining slots go to the newest other macro facts.
 */
export function applyMacroFactCap(
  sorted: readonly AgentFact[],
  maximum: number
): Readonly<{ facts: readonly AgentFact[]; truncated: boolean }> {
  const macro = sorted.filter(fact => fact.domain === 'macro')
  if (macro.length <= maximum) return { facts: [...sorted], truncated: false }
  const policy = macro.filter(fact => fact.sourceId === MARKET_ANALYSIS_POLICY_PATH_POLICY.sourceId)
  const others = macro.filter(fact => fact.sourceId !== MARKET_ANALYSIS_POLICY_PATH_POLICY.sourceId)
  const keptPolicy = policy.slice(0, maximum)
  const kept = new Set([
    ...keptPolicy.map(fact => fact.factId),
    ...others.slice(0, Math.max(0, maximum - keptPolicy.length)).map(fact => fact.factId)
  ])
  return {
    facts: sorted.filter(fact => fact.domain !== 'macro' || kept.has(fact.factId)),
    truncated: true
  }
}
