import { BarChart3, CalendarDays } from 'lucide-react'

import type { AgentContextMessagePart } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentContextRendererRegistry } from '@renderer/shell/agents/agentContextRenderers'

import { MarketAnalysisRunSessionCard } from './MarketAnalysisRunSessionCard'
import type { MarketAnalysisRunSessionText } from './marketAnalysisRunSessionText'

/**
 * Product-owned card styles for the two market contexts. The platform only transports the
 * context; a future module registers its own kind and keeps its own visual language.
 */
function MarketAnalysisContextCard({
  part,
  labels
}: {
  part: AgentContextMessagePart
  labels: Readonly<{ analysis: string; event: string }>
}): React.ReactElement {
  const analysis = part.kind === 'market-analysis-node'
  const kindLabel = analysis ? labels.analysis : labels.event
  const showKind = part.label.trim() !== kindLabel
  return (
    <div className={`mi-agent-context-card${analysis ? ' is-analysis' : ' is-event'}`} data-context-kind={part.kind}>
      <span className="mi-agent-context-card__icon" aria-hidden="true">
        {analysis ? <BarChart3 size={14} /> : <CalendarDays size={14} />}
      </span>
      <span className="mi-agent-context-card__copy">
        {showKind ? <small>{kindLabel}</small> : null}
        <strong>{part.label}</strong>
        {part.detail ? <span>{part.detail}</span> : null}
      </span>
    </div>
  )
}

/** 运行卡片只认 payload 里的 runId；没有就是「没有留下记录」，不去猜。 */
function runIdOf(part: AgentContextMessagePart): string | null {
  const value = part.payload?.runId
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function createMarketAnalysisContextRenderers(
  labels: Readonly<{
    analysis: string
    event: string
    runSession: MarketAnalysisRunSessionText
    /** 运行失败码 → 读者说法；复用时间轴那一张，不另抄。 */
    failureReasons: Readonly<Record<string, string>>
  }>
): AgentContextRendererRegistry {
  return {
    'market-analysis-node': ({ part }) => <MarketAnalysisContextCard part={part} labels={labels} />,
    'market-calendar-event': ({ part }) => <MarketAnalysisContextCard part={part} labels={labels} />,
    // 自动会话的卡片：会话里没有正文时，这里写清那次运行的结果。
    'market-analysis-run': ({ part }) => (
      <MarketAnalysisRunSessionCard
        failureReasons={labels.failureReasons}
        runId={runIdOf(part)}
        text={labels.runSession}
      />
    )
  }
}
