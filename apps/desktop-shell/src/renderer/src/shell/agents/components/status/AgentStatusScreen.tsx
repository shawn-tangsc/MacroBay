import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type AgentStatusScreenProps = {
  icon: LucideIcon
  title: string
  description: string
  actions?: ReactNode
}

export default function AgentStatusScreen({
  icon: Icon,
  title,
  description,
  actions
}: AgentStatusScreenProps): React.ReactElement {
  return (
    <div className="agent-status-screen">
      <Icon size={54} strokeWidth={1.25} />
      <strong>{title}</strong>
      <span>{description}</span>
      {actions ? <div className="agent-status-actions">{actions}</div> : null}
    </div>
  )
}
