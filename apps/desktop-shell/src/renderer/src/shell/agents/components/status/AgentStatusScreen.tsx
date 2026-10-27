import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { LoadingSpinner } from '@platform/ui/components/loading'

type AgentStatusScreenProps = {
  icon?: LucideIcon
  /** Swaps the glyph for the platform spinner: the surface is waiting, not reporting a state. */
  spinner?: boolean
  title: string
  description: string
  actions?: ReactNode
}

export default function AgentStatusScreen({
  icon: Icon,
  spinner = false,
  title,
  description,
  actions
}: AgentStatusScreenProps): React.ReactElement {
  return (
    <div className="agent-status-screen" aria-busy={spinner || undefined}>
      {spinner ? <LoadingSpinner size="lg" /> : Icon ? <Icon size={54} strokeWidth={1.25} /> : null}
      <strong>{title}</strong>
      <span>{description}</span>
      {actions ? <div className="agent-status-actions">{actions}</div> : null}
    </div>
  )
}
