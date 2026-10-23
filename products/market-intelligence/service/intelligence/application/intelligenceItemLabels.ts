import { normalizePublishedAt, stripCdata, stripHtmlFragments } from './publishedAtNormalizer'

export type IntelligenceAssessmentStatus =
  | 'pending'
  | 'queued'
  | 'evaluating'
  | 'evaluated'
  | 'failed'
  | 'model-not-ready'

export type IntelligenceProcessingLabels = {
  isBackfill?: boolean
  assessmentStatus?: IntelligenceAssessmentStatus
  assessmentErrorCode?: string
  intelligenceLayer?: import('../schema/intelligenceLayer').IntelligenceLayer
  dataDomain?: import('../schema/intelligenceLayer').IntelligenceDataDomain
  eventFamily?: import('../schema/intelligenceLayer').IntelligenceEventFamily
  eventSubtype?: string
  metricEventId?: string
  relevanceOutcome?: import('./sourceClassifiers/sourceClassifierTypes').SourceRelevanceOutcome
  sentimentEligible?: boolean
  classifierCaveats?: import('./sourceClassifiers/sourceClassifierTypes').SourceClassifierCaveat[]
  impactHintJson?: string
}

export const BACKFILL_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function parseProcessingLabels(value?: string): IntelligenceProcessingLabels {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value) as IntelligenceProcessingLabels
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function serializeProcessingLabels(labels: IntelligenceProcessingLabels): string | undefined {
  const entries = Object.entries(labels).filter(([, entry]) => entry !== undefined)
  if (entries.length === 0) return undefined
  return JSON.stringify(Object.fromEntries(entries))
}

export function mergeProcessingLabels(
  current: IntelligenceProcessingLabels | undefined,
  patch: IntelligenceProcessingLabels
): IntelligenceProcessingLabels {
  return { ...current, ...patch }
}

export function isBackfillItem(publishedAt: string | undefined, detectedAt: string): boolean {
  if (!publishedAt) return false
  const publishedMs = Date.parse(publishedAt)
  const detectedMs = Date.parse(detectedAt)
  if (!Number.isFinite(publishedMs) || !Number.isFinite(detectedMs)) return false
  return detectedMs - publishedMs > BACKFILL_AGE_MS
}

export function resolveIsBackfillLabel(input: {
  publishedAt?: string
  detectedAt: string
  intelligenceLayer?: IntelligenceProcessingLabels['intelligenceLayer']
  eventFamily?: IntelligenceProcessingLabels['eventFamily']
}): boolean {
  if (input.eventFamily === 'metric-event' && input.intelligenceLayer === 'macro') {
    return false
  }
  return isBackfillItem(input.publishedAt, input.detectedAt)
}

export function extractPublishedDateFromTitle(title?: string): string | undefined {
  if (!title?.trim()) return undefined

  const isoMatch = title.match(/\((\d{4}-\d{2}-\d{2})\)/)
  if (isoMatch?.[1]) {
    return normalizePublishedAt(isoMatch[1])
  }

  const cdataMatch = title.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i)
  if (cdataMatch?.[1]) {
    return normalizePublishedAt(cdataMatch[1])
  }

  return undefined
}

export function resolveEffectivePublishedAt(input: {
  publishedAt?: string
  detectedAt?: string
  title?: string
}): string | undefined {
  const published = normalizePublishedAt(input.publishedAt)
  if (published) return published

  const fromTitle = extractPublishedDateFromTitle(input.title)
  if (fromTitle) return fromTitle

  const detected = normalizePublishedAt(input.detectedAt)
  if (detected) return detected

  return input.detectedAt?.trim() || undefined
}

export function resolveTimelineTimestamp(input: {
  publishedAt?: string
  detectedAt?: string
  title?: string
}): string | undefined {
  return resolveEffectivePublishedAt(input)
}

export function compareTimelineTimestamps(left?: string, right?: string): number {
  return parseTimelineInstant(right) - parseTimelineInstant(left)
}

export function parseTimelineInstant(value?: string): number {
  if (!value?.trim()) return 0
  const normalized = normalizePublishedAt(value)
  const parsed = Date.parse(normalized ?? value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function sanitizeIntelligenceText(value?: string): string {
  if (!value?.trim()) return ''
  return stripHtmlFragments(stripCdata(value.trim()))
}
