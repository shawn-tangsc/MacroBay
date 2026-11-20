import {
  MARKET_ANALYSIS_MACRO_CALENDAR_FACT_METRICS,
  type MarketAnalysisContextAvailable
} from '../../../contracts/marketAnalysisContracts'

export function formatMarketAnalysisContextDiagnostic(input: Readonly<{
  asOf: string
  macroQueryState: string
  macroEventCount: number
  macroFactCount: number
  macroEvidenceCount: number
  macroCaveats: readonly string[]
}>): string {
  return JSON.stringify({ marker: 'MI_ANALYSIS_MACRO_CONTEXT', ...input })
}

/**
 * 把这一跑的上下文摘要打一行到主进程日志：排障时「这次为什么这么判」要能从运行记录里读出来。
 *
 * 只打形状与计数，不打事实内容、不打来源凭据——日志不是证据库。
 */
export function logMarketAnalysisContextDiagnostic(context: MarketAnalysisContextAvailable): void {
  const macro = context.domainAccess.find(domain => domain.domain === 'macro')
  console.log(formatMarketAnalysisContextDiagnostic({
    asOf: context.asOf,
    macroQueryState: macro?.queryState ?? 'missing',
    macroEventCount: context.facts.filter(fact => fact.domain === 'macro' && fact.metric === MARKET_ANALYSIS_MACRO_CALENDAR_FACT_METRICS.eventName).length,
    macroFactCount: context.facts.filter(fact => fact.domain === 'macro').length,
    macroEvidenceCount: context.evidenceRefs.filter(ref => ref.sourceId.startsWith('macro-calendar-')).length,
    macroCaveats: macro?.caveats ?? ['macro-domain-missing']
  }))
}
