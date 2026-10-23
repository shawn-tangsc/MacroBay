import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import { useAgentText } from '../agentTextProvider'
import { formatTokenCount, summarizeAgentSessionTokenUsage } from '../agentSessionUsage'

export default function AgentSessionUsageBar({
  messages,
  narrow = false
}: {
  messages: readonly AgentSessionMessageEntity[]
  narrow?: boolean
}): React.ReactElement | null {
  const t = useAgentText()
  const usage = summarizeAgentSessionTokenUsage(messages)
  if (!usage) return null

  return (
    <div className={narrow ? 'agent-session-usage narrow' : 'agent-session-usage'} aria-label={t.messages.tokenUsageAria}>
      <span className="agent-session-usage__total">
        {t.messages.tokenUsage(formatTokenCount(usage.totalTokens))}
      </span>
      <span className="agent-session-usage__detail">
        {t.messages.tokenUsageBreakdown(
          formatTokenCount(usage.promptTokens),
          formatTokenCount(usage.completionTokens)
        )}
      </span>
    </div>
  )
}
