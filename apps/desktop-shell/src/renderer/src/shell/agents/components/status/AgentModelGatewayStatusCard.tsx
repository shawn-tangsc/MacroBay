import { LoaderCircle, Network, Play, Square } from 'lucide-react'

import { useAgentText } from '../../agentTextProvider'
import {
  resolveAgentModelGatewayStatusView,
  type AgentModelGatewayUiSnapshot
} from '../../agentModelGatewayStatus'

type AgentModelGatewayStatusCardProps = {
  snapshot: AgentModelGatewayUiSnapshot | null
  busy?: boolean
  /** Human-readable provider / model that needs the route, e.g. `TokenRhythm / deepseek-v4`. */
  modelLabel?: string
  onStart: () => void
  onStop: () => void
  onOpenModelService: () => void
}

export default function AgentModelGatewayStatusCard({
  snapshot,
  busy = false,
  modelLabel,
  onStart,
  onStop,
  onOpenModelService
}: AgentModelGatewayStatusCardProps): React.ReactElement {
  const t = useAgentText()
  const view = resolveAgentModelGatewayStatusView(snapshot)
  const labels = t.gatewayStatus
  const starting = view.state === 'starting'
  const running = view.state === 'running'

  return (
    <section className={`agent-gateway-route tone-${view.tone}`} data-testid="agent-model-gateway-status">
      <header className="agent-gateway-route__header">
        <span className="agent-gateway-route__icon" aria-hidden="true">
          <Network size={18} />
        </span>
        <div className="agent-gateway-route__copy">
          <h2>{labels.requiredTitle}</h2>
          <p>{labels.requiredDescription}</p>
          {modelLabel ? <p className="agent-gateway-route__model">{labels.currentModel(modelLabel)}</p> : null}
        </div>
        <span className="agent-gateway-route__state" data-state={view.state}>
          {labels.state[view.state]}
        </span>
      </header>

      <div className="agent-gateway-route__facts">
        <span>{labels.localOnly}</span>
        {snapshot?.baseUrl ? <code>{snapshot.baseUrl}</code> : null}
      </div>

      <footer className="agent-gateway-route__actions">
        {running ? (
          <button type="button" className="secondary-button compact" disabled={busy} onClick={onStop}>
            <Square size={14} />
            {labels.stop}
          </button>
        ) : (
          <button
            type="button"
            className="primary-button compact"
            disabled={busy || starting}
            onClick={onStart}>
            {busy || starting ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
            {starting ? labels.startingButton : labels.enableAndStart}
          </button>
        )}
        <button type="button" className="secondary-button compact" onClick={onOpenModelService}>
          {labels.openModelService}
        </button>
      </footer>
    </section>
  )
}
