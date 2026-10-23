import { Link2 } from 'lucide-react'

/** Neutral fallback when a host has not registered a renderer for a context kind. */
export default function AgentContextCard({
  label,
  detail
}: {
  label: string
  detail?: string
}): React.ReactElement {
  return (
    <div className="agent-message-context-card">
      <span className="agent-message-context-card__icon" aria-hidden="true">
        <Link2 size={14} />
      </span>
      <span className="agent-message-context-card__copy">
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  )
}
