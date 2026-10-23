import { BarChart3, CalendarDays } from 'lucide-react'

import type { AgentContextMessagePart } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentContextRendererRegistry } from '@renderer/shell/agents/agentContextRenderers'

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

export function createMarketAnalysisContextRenderers(
  labels: Readonly<{ analysis: string; event: string }>
): AgentContextRendererRegistry {
  return {
    'market-analysis-node': ({ part }) => <MarketAnalysisContextCard part={part} labels={labels} />,
    'market-calendar-event': ({ part }) => <MarketAnalysisContextCard part={part} labels={labels} />
  }
}
