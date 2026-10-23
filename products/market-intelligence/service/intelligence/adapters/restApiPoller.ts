import { hashPayload } from '@platform/jobs'

import { normalizeEventType } from '../application/eventTypeNormalizer'
import { normalizePublishedAt } from '../application/publishedAtNormalizer'
import {
  GITHUB_RELEASES_PARSER_VERSION,
  buildGithubReleasesQueryUrl,
  githubReleasesToRawRecords,
  isGithubReleasePayload,
  normalizeGithubReleaseItem,
  parseGithubReleasePayload,
  parseGithubReleasesResponse
} from './githubReleasesParser'
import type { IntelligenceSourceAdapter } from './sourceAdapter'

const PARSER_VERSION = 'kraken-system-status-v1'

export const restApiPollerAdapter: IntelligenceSourceAdapter = {
  adapterType: 'rest-api-poller',
  parserVersion: PARSER_VERSION,
  supportedSourceIds: [
    'kraken-system-status',
    'github-releases',
    'cryptopanic',
    'coinmarketcal'
  ],
  async collect({ config, runId, fetchText }) {
    const endpointUrl = String(config.adapterConfig.endpointUrl ?? '')
    if (!endpointUrl || !fetchText) return []

    // A releases list is a list of items, not one item: each release becomes its own raw record keyed
    // by owner/repo@tag, exactly as the announcement adapters key theirs.
    if (config.sourceId === 'github-releases') {
      const body = await fetchText(buildGithubReleasesQueryUrl(config))
      return githubReleasesToRawRecords({ config, runId, releases: parseGithubReleasesResponse(body) })
    }

    const body = await fetchText(endpointUrl)
    return [
      {
        sourceId: config.sourceId,
        runId,
        payloadFormat: 'json',
        payloadRefType: 'inline',
        payloadBody: body,
        payloadHash: hashPayload(body),
        sourceDedupeKey: `rest-fetch:${endpointUrl}:${hashPayload(body).slice(0, 16)}`,
        parserVersion: parserVersionForSource(config.sourceId)
      }
    ]
  },
  parseRawRecord({ config, rawRecord }) {
    const body = rawRecord.payloadBody ?? '{}'
    const payload = JSON.parse(body)
    if (config.sourceId === 'kraken-system-status') {
      return parseKrakenSystemStatus(payload as KrakenSystemStatusPayload)
    }
    if (config.sourceId === 'github-releases' && isGithubReleasePayload(body)) {
      return parseGithubReleasePayload(payload)
    }
    throw new Error(`REST parser not implemented for ${config.sourceId}.`)
  },
  normalizeParsedItem({ config, parsed, detectedAt }) {
    if (config.sourceId === 'github-releases') {
      return normalizeGithubReleaseItem({ config, parsed, detectedAt })
    }

    const vendorId = parsed.externalId ?? hashPayload(parsed.bodyText).slice(0, 16)
    const eventType = normalizeEventType({
      eventType: parsed.eventType,
      sourceCategory: config.category,
      clusterType: config.category === 'exchange-status' ? 'incident' : 'news-event'
    })
    return {
      canonicalDedupeKey: `rest:${config.sourceId}:${vendorId}`,
      title: parsed.title,
      summary: parsed.summary,
      url: parsed.sourceUrl,
      publishedAt: normalizePublishedAt(parsed.publishedAt) ?? parsed.publishedAt,
      detectedAt,
      eventType,
      severityHint: parsed.severityHint,
      clusterKey: `rest:${config.sourceId}:${vendorId}`,
      clusterType: config.category === 'exchange-status' ? 'incident' : 'news-event'
    }
  }
}

type KrakenSystemStatusPayload = {
  components?: Array<{
    id: string
    name: string
    status: string
    updated_at?: string
  }>
}

export function parseKrakenSystemStatus(payload: KrakenSystemStatusPayload) {
  const degraded = payload.components?.find((component) => component.status !== 'operational') ?? payload.components?.[0]
  if (!degraded) {
    throw new Error('No Kraken SystemStatus components found.')
  }

  const bodyText = `${degraded.name}:${degraded.status}`
  return {
    externalId: degraded.id,
    publishedAt: normalizePublishedAt(degraded.updated_at) ?? degraded.updated_at,
    title: `${degraded.name} ${degraded.status}`,
    summary: bodyText,
    bodyText,
    bodyHash: hashPayload(bodyText),
    eventType: 'system-status',
    severityHint: degraded.status === 'operational' ? ('info' as const) : ('warning' as const)
  }
}

function parserVersionForSource(sourceId: string): string {
  if (sourceId === 'kraken-system-status') return PARSER_VERSION
  if (sourceId === 'github-releases') return GITHUB_RELEASES_PARSER_VERSION
  return `${sourceId}-v1`
}
