import type {
  IntelligenceExecutionMode,
  IntelligenceSourceAdapterType,
  IntelligenceSourceDefinition
} from '../../../service/intelligence/schema/intelligenceSource'
import type { IntelligenceSourcesText } from '../../shared/i18n/productText'

type StringLabelMap = Partial<Record<string, string>>

export function intelligenceSourceDisplayName(
  definition: IntelligenceSourceDefinition,
  labels: Pick<IntelligenceSourcesText, 'sources'>
): string {
  return intelligenceSourceLabelById(definition.sourceId, labels, definition.displayName)
}

export function intelligenceSourceLabelById(
  sourceId: string,
  labels: Pick<IntelligenceSourcesText, 'sources'>,
  fallback?: string
): string {
  return readLabel(labels.sources as StringLabelMap, sourceId) ?? fallback ?? sourceId
}

export function intelligenceAdapterLabel(
  adapterType: IntelligenceSourceAdapterType,
  labels: Pick<IntelligenceSourcesText, 'adapters'>
): string {
  return readLabel(labels.adapters as StringLabelMap, adapterType) ?? adapterType
}

export function intelligenceExecutionModeLabel(
  executionMode: IntelligenceExecutionMode,
  labels: Pick<IntelligenceSourcesText, 'executionModes'>
): string {
  return readLabel(labels.executionModes as StringLabelMap, executionMode) ?? executionMode
}

export function intelligenceReadinessLabel(
  readiness: NonNullable<IntelligenceSourceDefinition['readiness']>,
  labels: IntelligenceSourcesText['readiness']
): string {
  return readLabel(labels.statuses as StringLabelMap, readiness) ?? readiness
}

export function intelligenceLayerLabel(
  layer: IntelligenceSourceDefinition['intelligenceLayer'],
  labels: IntelligenceSourcesText['layers']
): string {
  if (!layer) return '—'
  return readLabel(labels as StringLabelMap, layer) ?? layer
}

function readLabel(labels: StringLabelMap, key: string): string | undefined {
  return labels[key]
}
