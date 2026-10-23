import type { IntelligenceSourceDefinition } from '../../../service/intelligence/schema/intelligenceSource'
import type { IntelligenceSourcesText } from '../../shared/i18n/productText'
import { intelligenceReadinessLabel, intelligenceLayerLabel } from './intelligenceSourceDisplay'

export function SourceReadinessSection(props: {
  definition: IntelligenceSourceDefinition
  labels: IntelligenceSourcesText['readiness']
  layerLabels: IntelligenceSourcesText['layers']
}): React.ReactElement {
  const readiness = props.definition.readiness ?? 'live'
  const layerLabel = intelligenceLayerLabel(props.definition.intelligenceLayer, props.layerLabels)
  const readinessLabel = intelligenceReadinessLabel(readiness, props.labels)

  return (
    <section className="intelligence-readiness-section">
      <span className="intelligence-readiness-eyebrow">{props.labels.title}</span>
      <strong className="intelligence-readiness-summary">
        {layerLabel} · {readinessLabel}
      </strong>
      <p className="intelligence-source-note">
        {props.labels.layer}: {layerLabel} · {props.labels.status}: {readinessLabel}
      </p>
      {props.definition.readinessNote ? (
        <p className="intelligence-readiness-note">{props.definition.readinessNote}</p>
      ) : null}
      {readiness === 'planned' ? <p className="intelligence-readiness-note">{props.labels.plannedHint}</p> : null}
      {readiness === 'fixture-ready' ? (
        <p className="intelligence-readiness-note">{props.labels.fixtureReadyHint}</p>
      ) : null}
    </section>
  )
}
