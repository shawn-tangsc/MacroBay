import { hashPayload } from '@platform/jobs'

import { buildExchangeAnnouncementClusterKey } from '../application/clusterResolver'
import type { AppendRawRecordInput } from '../schema/intelligenceRecord'
import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'
import type { NormalizedIntelligenceItemDraft, ParsedIntelligenceRecord } from './sourceAdapter'

export const OKX_ANNOUNCEMENTS_PARSER_VERSION = 'okx-announcements-v1'

/** OKX's own documented, credential-free announcements endpoint (help-centre `/api/v5/support/announcements`). */
const DEFAULT_LIST_QUERY_URL = 'https://www.okx.com/api/v5/support/announcements'

/**
 * `pTime` is epoch milliseconds on this endpoint. The help centre's older search payload used epoch
 * seconds, so a value below this threshold is read as seconds instead of being thrown away.
 */
const EPOCH_MILLISECONDS_THRESHOLD = 1e11

/** A release outside this window is a broken timestamp, not an announcement: drop it rather than date it. */
const EARLIEST_ADMITTED_EPOCH_MS = Date.UTC(2009, 0, 1)
const LATEST_ADMITTED_EPOCH_MS = Date.UTC(2100, 0, 1)

const OKX_ANNOUNCEMENTS_SOURCE_IDS = ['okx-latest-announcements', 'okx-api-announcements'] as const

export type OkxAnnouncement = {
  annType?: string
  title: string
  url: string
  pTime: string
  businessPTime?: string
  publishedAt: string
}

type OkxAnnouncementsResponse = {
  code?: string | number
  msg?: string
  data?: Array<{ details?: unknown }>
}

export function isOkxAnnouncementsSource(sourceId: string): boolean {
  return (OKX_ANNOUNCEMENTS_SOURCE_IDS as readonly string[]).includes(sourceId)
}

/**
 * `annType` is omitted when the source declares none, which is OKX's own "latest announcements across
 * every type" query — the same list its help-centre landing page shows.
 */
export function buildOkxAnnouncementsQueryUrl(config: IntelligenceSourceConfig): string {
  const url = new URL(String(config.adapterConfig.listQueryUrl ?? DEFAULT_LIST_QUERY_URL))
  const annType = String(config.adapterConfig.annType ?? '').trim()
  if (annType) url.searchParams.set('annType', annType)
  url.searchParams.set('page', String(config.adapterConfig.page ?? 1))
  return url.toString()
}

export function buildOkxAnnouncementsRequestHeaders(config: IntelligenceSourceConfig): Record<string, string> {
  const pageUrl = String(config.adapterConfig.pageUrl ?? 'https://www.okx.com/help/')
  const language = String(config.adapterConfig.language ?? config.language ?? 'en')
  return {
    Accept: 'application/json',
    'Accept-Language': language,
    Referer: pageUrl
  }
}

/**
 * Reads OKX's announcement envelope. An unusable envelope (rejection code, missing `details`) throws,
 * and a payload whose every row was dropped throws too: a changed response shape must reach source
 * health as a failure instead of passing for "nothing new was published".
 */
export function parseOkxAnnouncementsResponse(bodyText: string): OkxAnnouncement[] {
  const payload = JSON.parse(bodyText) as OkxAnnouncementsResponse
  const code = payload.code
  if (code !== undefined && code !== null && String(code) !== '0') {
    throw new Error(`OKX announcements API rejected the request (${String(code)}).`)
  }
  const details = payload.data?.[0]?.details
  if (!Array.isArray(details)) {
    throw new Error('OKX announcements response carried no details list.')
  }

  const announcements = new Map<string, OkxAnnouncement>()
  for (const row of details) {
    const announcement = readOkxAnnouncement(row)
    if (announcement) announcements.set(announcement.url, announcement)
  }
  if (details.length > 0 && announcements.size === 0) {
    throw new Error('OKX announcements response carried no usable rows.')
  }
  return [...announcements.values()]
}

function readOkxAnnouncement(value: unknown): OkxAnnouncement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const url = typeof row.url === 'string' ? row.url.trim() : ''
  const publishedAt = normalizeOkxPublishedAt(row.pTime)
  if (!title || !url || !publishedAt) return undefined
  return {
    ...(typeof row.annType === 'string' && row.annType.trim() ? { annType: row.annType.trim() } : {}),
    title,
    url,
    pTime: String(row.pTime),
    ...(typeof row.businessPTime === 'string' ? { businessPTime: row.businessPTime } : {}),
    publishedAt
  }
}

/** Millisecond epoch in, ISO string out; seconds are upscaled, anything outside the window is dropped. */
export function normalizeOkxPublishedAt(value: unknown): string | undefined {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  const epochMs = numeric < EPOCH_MILLISECONDS_THRESHOLD ? Math.round(numeric * 1000) : Math.round(numeric)
  if (epochMs < EARLIEST_ADMITTED_EPOCH_MS || epochMs > LATEST_ADMITTED_EPOCH_MS) return undefined
  const publishedAt = new Date(epochMs)
  return Number.isNaN(publishedAt.getTime()) ? undefined : publishedAt.toISOString()
}

/** The article slug is OKX's stable identity; the numeric time is not, so the URL is what dedupes. */
export function buildOkxAnnouncementExternalId(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  const slug = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return slug || trimmed
}

export function buildOkxAnnouncementDedupeKey(url: string): string {
  return `okx:${buildOkxAnnouncementExternalId(url)}`
}

export function okxAnnouncementsToRawRecords(input: {
  config: IntelligenceSourceConfig
  runId: string
  announcements: OkxAnnouncement[]
}): AppendRawRecordInput[] {
  return input.announcements.map((announcement) => {
    const payloadBody = JSON.stringify(announcement)
    return {
      sourceId: input.config.sourceId,
      runId: input.runId,
      externalId: buildOkxAnnouncementExternalId(announcement.url),
      sourceUrl: announcement.url,
      publishedAt: announcement.publishedAt,
      publishedAtRaw: announcement.pTime,
      payloadFormat: 'json',
      payloadRefType: 'inline',
      payloadBody,
      payloadHash: hashPayload(payloadBody),
      sourceDedupeKey: buildOkxAnnouncementDedupeKey(announcement.url),
      parserVersion: OKX_ANNOUNCEMENTS_PARSER_VERSION
    }
  })
}

export function isOkxAnnouncementPayload(bodyText: string): boolean {
  if (!bodyText.trimStart().startsWith('{')) return false
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>
    return typeof parsed.title === 'string' && typeof parsed.url === 'string'
  } catch {
    return false
  }
}

export function parseOkxAnnouncementPayload(payload: OkxAnnouncement | Record<string, unknown>): ParsedIntelligenceRecord {
  const announcement = readOkxAnnouncement(payload)
  if (!announcement) {
    throw new Error('OKX announcement payload is missing a title, url or a valid publish time.')
  }
  const bodyText = `${announcement.title}\n${announcement.url}`
  return {
    externalId: buildOkxAnnouncementExternalId(announcement.url),
    sourceUrl: announcement.url,
    publishedAtRaw: announcement.pTime,
    publishedAt: announcement.publishedAt,
    title: announcement.title,
    summary: announcement.annType,
    bodyText,
    bodyHash: hashPayload(bodyText),
    eventType: 'exchange-announcement',
    severityHint: 'info'
  }
}

export function normalizeOkxAnnouncementItem(input: {
  config: IntelligenceSourceConfig
  parsed: ParsedIntelligenceRecord
  detectedAt: string
}): NormalizedIntelligenceItemDraft {
  const externalId = input.parsed.externalId ?? hashPayload(input.parsed.bodyText).slice(0, 16)
  return {
    canonicalDedupeKey: `okx:${externalId}`,
    title: input.parsed.title,
    summary: input.parsed.summary,
    url: input.parsed.sourceUrl,
    publishedAt: input.parsed.publishedAt,
    detectedAt: input.detectedAt,
    eventType: input.parsed.eventType,
    severityHint: input.parsed.severityHint,
    clusterKey: buildExchangeAnnouncementClusterKey(input.config.sourceId, externalId),
    clusterType: 'announcement'
  }
}
