import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { AlertTriangle, PauseCircle } from 'lucide-react'

import { LoadingSpinner } from '@platform/ui/components/loading'
import { useAgentText } from '../agentTextProvider'

export default function AgentMessageStatusBadge({
  status
}: {
  status: AgentSessionMessageEntity['status']
}): React.ReactElement | null {
  const t = useAgentText()
  if (status === 'success') return null

  if (status === 'pending') {
    return (
      <span className="agent-message-status pending">
        <LoadingSpinner size="sm" />
        {t.messages.status.pending}
      </span>
    )
  }

  if (status === 'paused') {
    return (
      <span className="agent-message-status paused">
        <PauseCircle size={12} />
        {t.messages.status.paused}
      </span>
    )
  }

  return (
    <span className="agent-message-status error">
      <AlertTriangle size={12} />
      {t.messages.status.error}
    </span>
  )
}
