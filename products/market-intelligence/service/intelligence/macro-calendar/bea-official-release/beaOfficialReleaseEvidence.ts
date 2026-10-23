import { createHash } from 'node:crypto'

import type { MacroCalendarEvidenceArchive } from '../macroCalendarEvidenceArchive'

export const beaOfficialReleaseEvidencePolicy = Object.freeze({
  rssSourceId: 'macro-calendar-bea-release-rss',
  pageSourceId: 'macro-calendar-bea-release-page',
  rssUrl: 'https://apps.bea.gov/rss/rss.xml',
  parserVersion: 'bea-official-release-value-v1',
  payloadMetadata: '{"kind":"bea-official-release"}'
})

export type BeaOfficialReleaseEvidence = Readonly<{
  append: (input: Readonly<{ rssBody: string; pageBody: string; pageUrl: string; detectedAt: string; runId: string }>) => Readonly<{ rss: { rawRecordId: string; evidenceHash: string }; page: { rawRecordId: string; evidenceHash: string } }> | undefined
}>

export function createBeaOfficialReleaseEvidence(deps: Readonly<{ archive: MacroCalendarEvidenceArchive }>): BeaOfficialReleaseEvidence {
  return Object.freeze({
    append(input) {
      if (!valid(input)) return undefined
      const rss = append(deps.archive, beaOfficialReleaseEvidencePolicy.rssSourceId, beaOfficialReleaseEvidencePolicy.rssUrl, input.rssBody, input.detectedAt, input.runId)
      const page = rss ? append(deps.archive, beaOfficialReleaseEvidencePolicy.pageSourceId, input.pageUrl, input.pageBody, input.detectedAt, input.runId) : undefined
      return rss && page ? { rss, page } : undefined
    }
  })
}
function append(archive: MacroCalendarEvidenceArchive, sourceId: string, sourceUrl: string, body: string, detectedAt: string, runId: string): { rawRecordId: string; evidenceHash: string } | undefined {
  const payloadSizeBytes = Buffer.byteLength(body, 'utf8'); const reservation = archive.reserve(payloadSizeBytes)
  if (!reservation) return undefined
  const evidenceHash = hash(body)
  const result = archive.append(reservation, { sourceId, sourceUrl, runId, detectedAt, payloadFormat: 'text', payloadBody: body, payloadSizeBytes, payloadHash: evidenceHash, payloadMetaJson: beaOfficialReleaseEvidencePolicy.payloadMetadata, sourceDedupeKey: hash(`${sourceId}\n${sourceUrl}\n${evidenceHash}`), parserVersion: beaOfficialReleaseEvidencePolicy.parserVersion })
  return result?.record.sourceId === sourceId && result.record.payloadHash === evidenceHash ? { rawRecordId: result.record.rawRecordId, evidenceHash } : undefined
}
function valid(value: { rssBody: string; pageBody: string; pageUrl: string; detectedAt: string; runId: string }): boolean { return Boolean(value.rssBody && value.pageBody && /^https:\/\/www\.bea\.gov\/news\/\d{4}\/[a-z0-9-]+$/.test(value.pageUrl) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.detectedAt) && value.runId) }
function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
