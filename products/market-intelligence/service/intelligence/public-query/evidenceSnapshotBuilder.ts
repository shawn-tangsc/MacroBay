import { canonicalJsonHash } from '@platform/ai/agent-platform/productTools/productAgentToolHash'

import type { IntelligenceImpact } from '../schema/intelligenceImpact'
import type { IntelligenceItem, SafeRawRecordSummary } from '../schema/intelligenceRecord'
import {
  MARKET_INTELLIGENCE_QUERY_CAVEATS,
  MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION,
  type AgentSafeEvidenceRef,
  type EvidenceExcerptResult,
  type MarketIntelligenceQueryCaveat
} from './queryContracts'
import { isVisibleAsOf, VISIBLE_AT } from './asOfVisibility'

const DEFAULT_MAX_EXCERPT_CHARS = 500

export type EvidenceRefInput = {
  item?: IntelligenceItem
  impact?: IntelligenceImpact
  rawRecord?: SafeRawRecordSummary
  asOf: string
}

export type EvidenceExcerptInput = {
  item?: IntelligenceItem
  rawRecord?: SafeRawRecordSummary
  asOf: string
  maxExcerptChars?: number
}

export function buildEvidenceRef(input: EvidenceRefInput): AgentSafeEvidenceRef | null {
  const item = input.item
  const rawRecord = input.rawRecord
  const sourceId = item?.sourceId ?? rawRecord?.sourceId
  if (!sourceId) return null

  const detectedAt = item?.detectedAt ?? rawRecord?.detectedAt
  if (!detectedAt) return null

  const visibleAt = item ? VISIBLE_AT.item(item) : VISIBLE_AT.rawRecord(rawRecord!)
  const caveats: MarketIntelligenceQueryCaveat[] = []
  if (!isVisibleAsOf(visibleAt, input.asOf)) {
    caveats.push(MARKET_INTELLIGENCE_QUERY_CAVEATS.evidenceNotVisibleAsOf)
    return null
  }

  const summary = sanitizeRendererSafeText(item?.summary ?? item?.title ?? rawRecord?.sourceUrl ?? 'Evidence record')
  const evidenceRefId = item?.itemId ?? rawRecord?.rawRecordId ?? 'unknown-evidence'

  return {
    evidenceRefId,
    sourceId,
    itemId: item?.itemId,
    impactId: input.impact?.impactId,
    clusterId: item?.clusterId ?? input.impact?.clusterId,
    schemaVersion: MARKET_INTELLIGENCE_QUERY_SCHEMA_VERSION,
    occurredAt: item?.publishedAt,
    publishedAt: item?.publishedAt ?? rawRecord?.publishedAt,
    detectedAt,
    computedAt: input.impact?.createdAt,
    visibleAt,
    rendererSafeSummary: summary,
    excerptHash: canonicalJsonHash({ summary, detectedAt, sourceId }).sha256,
    caveats
  }
}

export function buildEvidenceExcerpt(input: EvidenceExcerptInput): EvidenceExcerptResult | null {
  const item = input.item
  if (!item) return null

  const evidenceRef = buildEvidenceRef({ item, rawRecord: input.rawRecord, asOf: input.asOf })
  if (!evidenceRef) return null

  const maxChars = normalizeExcerptLimit(input.maxExcerptChars)
  const excerptSource = sanitizeRendererSafeText(item.summary ?? item.title)
  const excerpt = excerptSource.length > maxChars ? `${excerptSource.slice(0, maxChars - 1)}…` : excerptSource

  return {
    evidenceRef,
    title: sanitizeRendererSafeText(item.title),
    excerpt: excerpt || undefined,
    sourceUrl: item.url,
    language: item.language,
    translated: false
  }
}

function normalizeExcerptLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_EXCERPT_CHARS
  return Math.max(64, Math.min(2_000, Math.floor(value)))
}

function sanitizeRendererSafeText(value: string | undefined): string {
  if (!value?.trim()) return ''
  return value.replace(/api[_-]?key|authorization|secret|token/gi, '[REDACTED]').trim()
}
