import { hashPayload } from '@platform/jobs'

import { buildStatuspageClusterKey } from '../application/clusterResolver'
import { normalizeEventType } from '../application/eventTypeNormalizer'
import { normalizePublishedAt } from '../application/publishedAtNormalizer'
import type { IntelligenceSourceAdapter } from './sourceAdapter'

const PARSER_VERSION = 'statuspage-v1'

export const statuspagePollerAdapter: IntelligenceSourceAdapter = {
  adapterType: 'statuspage-poller',
  parserVersion: PARSER_VERSION,
  supportedSourceIds: ['coinbase-status', 'kraken-status', 'solana-status'],
  async collect({ config, runId, fetchText }) {
    const incidentsUrl = String(config.adapterConfig.incidentsUrl ?? '')
    if (!incidentsUrl || !fetchText) return []

    const body = await fetchText(incidentsUrl)
    return [
      {
        sourceId: config.sourceId,
        runId,
        payloadFormat: 'json',
        payloadRefType: 'inline',
        payloadBody: body,
        payloadHash: hashPayload(body),
        sourceDedupeKey: `statuspage-fetch:${incidentsUrl}:${hashPayload(body).slice(0, 16)}`,
        parserVersion: PARSER_VERSION
      }
    ]
  },
  parseRawRecord({ rawRecord }) {
    const payload = JSON.parse(rawRecord.payloadBody ?? '{}') as StatuspagePayload
    const incident = payload.incidents?.[0]
    if (!incident) {
      throw new Error('No statuspage incidents found.')
    }

    const update = incident.incident_updates?.[0]
    const bodyText = `${incident.name}\n${update?.body ?? ''}`
    return {
      externalId: incident.id,
      sourceUrl: incident.shortlink,
      publishedAt: normalizePublishedAt(update?.created_at ?? incident.created_at),
      title: incident.name,
      summary: update?.body,
      bodyText,
      bodyHash: hashPayload(bodyText),
      vendorIncidentId: incident.id,
      eventType: 'incident',
      severityHint: incident.status === 'resolved' ? 'info' : 'warning',
      sourceMeta: {
        incidentStatus: incident.status,
        incidentUpdateStatus: update?.status,
        incidentUpdateAt: update?.created_at
      }
    }
  },
  normalizeParsedItem({ config, parsed, detectedAt }) {
    const incidentId = parsed.vendorIncidentId ?? parsed.externalId ?? 'unknown'
    const eventType = normalizeEventType({
      eventType: parsed.eventType,
      sourceCategory: config.category,
      clusterType: 'incident'
    })
    return {
      canonicalDedupeKey: `statuspage:${incidentId}`,
      title: parsed.title,
      summary: parsed.summary,
      url: parsed.sourceUrl,
      publishedAt: parsed.publishedAt,
      detectedAt,
      eventType,
      severityHint: parsed.severityHint,
      clusterKey: buildStatuspageClusterKey(incidentId),
      clusterType: 'incident'
    }
  }
}

type StatuspagePayload = {
  incidents?: Array<{
    id: string
    name: string
    status: string
    created_at?: string
    shortlink?: string
    incident_updates?: Array<{ body?: string; created_at?: string; status?: string }>
  }>
}

export function parseStatuspageIncidents(json: string) {
  return (JSON.parse(json) as StatuspagePayload).incidents ?? []
}
