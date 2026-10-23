import type { SafeIntelligenceSourceDetailView } from '../../../service/intelligence/schema/intelligenceSourcesContracts'

export function SourceHealthSection(props: {
  health: SafeIntelligenceSourceDetailView['health']
  labels: {
    title: string
    runtimeStatus: string
    lastSuccessAt: string
    lastFailureAt: string
    consecutiveFailures: string
    lastRunSummary: string
    statuses: Record<string, string>
    empty: string
  }
}): React.ReactElement {
  const { health } = props
  return (
    <section className="intelligence-section">
      <div className="intelligence-section-title">{props.labels.title}</div>
      <div className="intelligence-health-list">
        <HealthItem
          label={props.labels.runtimeStatus}
          value={props.labels.statuses[health.runtimeStatus] ?? health.runtimeStatus}
          status={health.runtimeStatus}
        />
        <HealthItem label={props.labels.consecutiveFailures} value={String(health.consecutiveFailures)} />
        <HealthItem label={props.labels.lastSuccessAt} value={health.lastSuccessAt ?? props.labels.empty} />
        <HealthItem label={props.labels.lastFailureAt} value={health.lastFailureAt ?? props.labels.empty} />
      </div>
      <p className="intelligence-source-note">
        {props.labels.lastRunSummary}: {health.lastRunSummary ?? props.labels.empty}
      </p>
    </section>
  )
}

function HealthItem(props: { label: string; value: string; status?: string }): React.ReactElement {
  return (
    <div className="intelligence-health-item">
      <span className="intelligence-health-label">{props.label}</span>
      <strong className="intelligence-health-value" data-status={props.status}>
        {props.value}
      </strong>
    </div>
  )
}
