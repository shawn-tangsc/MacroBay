import { createHash } from 'node:crypto'

import type { MacroCalendarEvidenceArchive } from '../macroCalendarEvidenceArchive'

export const fedFomcDecisionEvidencePolicy = Object.freeze({
  currentSourceId: 'macro-calendar-fed-fomc-current-decision-body',
  priorSourceId: 'macro-calendar-fed-fomc-prior-decision-body',
  parserVersion: 'fed-fomc-decision-value-v1',
  maximumBodyBytes: 128 * 1024,
  currentPayloadMetadata: '{"kind":"fed-fomc-current-decision"}',
  priorPayloadMetadata: '{"kind":"fed-fomc-prior-decision"}',
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
} as const)

export type FedFomcDecisionEvidence = Readonly<{
  appendVerifiedBody: (input: Readonly<{
    kind: 'current' | 'prior'
    officialStatementUrl: string
    body: string
    detectedAt: string
    runId: string
  }>) => Readonly<{ rawRecordId: string; evidenceHash: string }> | undefined
}>

export function createFedFomcDecisionEvidence(deps: Readonly<{ archive: MacroCalendarEvidenceArchive }>): FedFomcDecisionEvidence {
  return Object.freeze({
    appendVerifiedBody(input) {
      if (!isInput(input)) return undefined
      const payloadSizeBytes = Buffer.byteLength(input.body, 'utf8')
      const reservation = deps.archive.reserve(payloadSizeBytes)
      if (!reservation) return undefined
      const sourceId = input.kind === 'current'
        ? fedFomcDecisionEvidencePolicy.currentSourceId
        : fedFomcDecisionEvidencePolicy.priorSourceId
      const evidenceHash = hash(input.body)
      const result = deps.archive.append(reservation, {
        sourceId,
        runId: input.runId,
        sourceUrl: input.officialStatementUrl,
        detectedAt: input.detectedAt,
        payloadFormat: 'html',
        payloadBody: input.body,
        payloadSizeBytes,
        payloadHash: evidenceHash,
        payloadMetaJson: input.kind === 'current'
          ? fedFomcDecisionEvidencePolicy.currentPayloadMetadata
          : fedFomcDecisionEvidencePolicy.priorPayloadMetadata,
        sourceDedupeKey: hash(`${sourceId}\n${input.officialStatementUrl}\n${evidenceHash}`),
        parserVersion: fedFomcDecisionEvidencePolicy.parserVersion
      })
      return result?.record.sourceId === sourceId && result.record.sourceUrl === input.officialStatementUrl &&
        result.record.payloadHash === evidenceHash
        ? Object.freeze({ rawRecordId: result.record.rawRecordId, evidenceHash })
        : undefined
    }
  })
}

function isInput(value: unknown): value is {
  kind: 'current' | 'prior'
  officialStatementUrl: string
  body: string
  detectedAt: string
  runId: string
} {
  return isExactRecord(value, ['kind', 'officialStatementUrl', 'body', 'detectedAt', 'runId']) &&
    (value.kind === 'current' || value.kind === 'prior') && isOfficialStatementUrl(value.officialStatementUrl) &&
    typeof value.body === 'string' && value.body.length > 0 && !value.body.includes('\0') &&
    Buffer.byteLength(value.body, 'utf8') <= fedFomcDecisionEvidencePolicy.maximumBodyBytes &&
    isCanonicalUtcMillis(value.detectedAt) && typeof value.runId === 'string' && value.runId.trim().length > 0
}

function isOfficialStatementUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'www.federalreserve.gov' && !url.username && !url.password &&
      !url.port && !url.search && !url.hash && /^\/newsevents\/pressreleases\/monetary\d{8}[a-z]\.htm$/.test(url.pathname)
  } catch {
    return false
  }
}

function isCanonicalUtcMillis(value: unknown): value is string {
  return typeof value === 'string' && fedFomcDecisionEvidencePolicy.canonicalUtcMillisPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, any> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && fields.every((field) => Object.hasOwn(value, field)) &&
      Object.getOwnPropertySymbols(value).length === 0 && names.every((field) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, field)
        return Boolean(descriptor && 'value' in descriptor)
      })
  } catch {
    return false
  }
}

function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
