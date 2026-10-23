import { createHash } from 'node:crypto'

import type {
  MacroCalendarEvidenceArchive,
  MacroCalendarEvidenceReservation
} from '../macroCalendarEvidenceArchive'

export const blsEmploymentMvpEvidencePolicy = Object.freeze({
  sourceId: 'macro-calendar-bls-calendar-family-refresh-api-evidence-v2',
  sourceUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/',
  parserVersion: 'bls-calendar-family-refresh-v2',
  maximumBodyBytes: 1_500_000,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
} as const)

export type BlsEmploymentMvpEvidence = Readonly<{
  reserve: (maximumBytes: number) => MacroCalendarEvidenceReservation | undefined
  release: (reservation: MacroCalendarEvidenceReservation) => boolean
  appendApiBody: (body: string, detectedAt: string, reservation: MacroCalendarEvidenceReservation) => Readonly<{ rawRecordId: string; evidenceHash: string }> | undefined
}>

export function createBlsEmploymentMvpEvidence(deps: Readonly<{ archive: MacroCalendarEvidenceArchive }>): BlsEmploymentMvpEvidence {
  return Object.freeze({
    reserve(maximumBytes) {
      return deps.archive.reserve(maximumBytes)
    },
    release(reservation) {
      return deps.archive.release(reservation)
    },
    appendApiBody(body, detectedAt, reservation) {
      if (!isAcceptedBody(body) || !isCanonicalUtcMillis(detectedAt)) {
        deps.archive.release(reservation)
        return undefined
      }
      const evidenceHash = hash(body)
      const sourceDedupeKey = hash(`${blsEmploymentMvpEvidencePolicy.sourceId}\n${evidenceHash}`)
      const result = deps.archive.append(reservation, {
        sourceId: blsEmploymentMvpEvidencePolicy.sourceId, runId: `bls-calendar-family-refresh:${detectedAt}`,
        sourceUrl: blsEmploymentMvpEvidencePolicy.sourceUrl, detectedAt, payloadFormat: 'json', payloadBody: body,
        payloadSizeBytes: Buffer.byteLength(body, 'utf8'), payloadHash: evidenceHash, payloadMetaJson: '{"kind":"bls-calendar-family-refresh"}',
        sourceDedupeKey, parserVersion: blsEmploymentMvpEvidencePolicy.parserVersion
      })
      return result && result.record.sourceId === blsEmploymentMvpEvidencePolicy.sourceId && result.record.payloadHash === evidenceHash
        ? Object.freeze({ rawRecordId: result.record.rawRecordId, evidenceHash }) : undefined
    }
  })
}

function isAcceptedBody(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && !value.includes('\0') && Buffer.byteLength(value, 'utf8') <= blsEmploymentMvpEvidencePolicy.maximumBodyBytes }
function isCanonicalUtcMillis(value: unknown): boolean { return typeof value === 'string' && blsEmploymentMvpEvidencePolicy.canonicalUtcMillisPattern.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value }
function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
