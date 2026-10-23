import { createHash } from 'node:crypto'

import type { RawIntelligenceRecord } from '../schema/intelligenceRecord'
import type {
  MacroCalendarEvidenceArchive,
  MacroCalendarEvidenceReservation
} from './macroCalendarEvidenceArchive'
import {
  getMacroCalendarOfficialSourceDescriptor,
  isFixedMacroCalendarEvidenceDescriptor,
  type MacroCalendarEvidenceSourceDescriptor,
  type MacroCalendarOfficialSourceDescriptor
} from './macroCalendarOfficialSourceRegistry'
import { manualBlsIcsParserPolicy } from './bls-ics-manual/blsManualIcsContracts'

export type MacroCalendarEvidenceAppendInput = {
  descriptor: MacroCalendarEvidenceSourceDescriptor
  sourceUrl: string
  detectedAt: string
  body: string
  payloadFormat: 'html' | 'json' | 'text'
  runId: string
  parserVersion: string
  response: { status: number; contentType: string; locale?: 'zh' | 'en' }
}

export type MacroCalendarManualBlsIcsAppendInput = {
  body: string
  detectedAt: string
  runId: string
}

export type MacroCalendarEvidenceReference = {
  rawRecordId: string
  providerId: MacroCalendarEvidenceSourceDescriptor['providerId']
  descriptorId: MacroCalendarEvidenceSourceDescriptor['descriptorId']
  sourceUrl: string
  evidenceHash: string
  detectedAt: string
  parserVersion: string
  inserted: boolean
  deduped: boolean
}

export type MacroCalendarEvidenceStore = {
  reserve: (maximumBytes: number) => MacroCalendarEvidenceReservation | undefined
  release: (reservation: MacroCalendarEvidenceReservation) => boolean
  append: (input: MacroCalendarEvidenceAppendInput, reservation: MacroCalendarEvidenceReservation) => MacroCalendarEvidenceReference | undefined
  appendManualBlsIcs: (input: MacroCalendarManualBlsIcsAppendInput, reservation: MacroCalendarEvidenceReservation) => MacroCalendarEvidenceReference | undefined
  getCalendarRecord: (rawRecordId: string) => RawIntelligenceRecord | undefined
  listCalendarRecords: (limit?: number) => RawIntelligenceRecord[]
  readBody: (record: RawIntelligenceRecord) => string | undefined
}

type ExpectedMacroCalendarEvidence = {
  descriptor: MacroCalendarEvidenceSourceDescriptor
  body: string
  payloadFormat: 'html' | 'json' | 'text'
}

export const macroCalendarEvidencePolicy = {
  processingOwner: 'macro-calendar',
  payloadRefType: 'file',
  defaultReadLimit: 100,
  maximumReadLimit: 100,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  manualBlsIcsPayloadMetadata: {
    provenance: 'manual-ics-upload',
    calendar: 'bls-release-schedule'
  }
} as const

export function createMacroCalendarEvidenceStore(archive: MacroCalendarEvidenceArchive): MacroCalendarEvidenceStore {
  return {
    reserve(maximumBytes) {
      return archive.reserve(maximumBytes)
    },
    release(reservation) {
      return archive.release(reservation)
    },
    append(input, reservation) {
      if (!isValidInput(input)) {
        archive.release(reservation)
        return undefined
      }
      const expected = expectedEvidence(input.descriptor, input.body)
      const evidenceHash = hash(input.body)
      const payloadSizeBytes = Buffer.byteLength(input.body, 'utf8')
      const sourceDedupeKey = createSourceDedupeKey(input.descriptor.descriptorId, evidenceHash)
      const result = archive.append(reservation, {
        sourceId: input.descriptor.descriptorId,
        runId: input.runId,
        sourceUrl: input.descriptor.sourceUrl,
        detectedAt: input.detectedAt,
        payloadFormat: input.payloadFormat,
        payloadBody: input.body,
        payloadSizeBytes,
        payloadHash: evidenceHash,
        payloadMetaJson: JSON.stringify(input.response),
        sourceDedupeKey,
        parserVersion: input.parserVersion
      })
      return result && matchesExpectedEvidence(archive, result.record, expected, evidenceHash, payloadSizeBytes, sourceDedupeKey)
        ? reference(result.record, input.descriptor, input.parserVersion, result.inserted, result.deduped)
        : undefined
    },
    appendManualBlsIcs(input, reservation) {
      const descriptor = getMacroCalendarOfficialSourceDescriptor(manualBlsIcsParserPolicy.descriptorId)
      if (!descriptor || !isValidManualInput(input, descriptor)) {
        archive.release(reservation)
        return undefined
      }
      const evidenceHash = hash(input.body)
      const payloadSizeBytes = Buffer.byteLength(input.body, 'utf8')
      const sourceDedupeKey = createSourceDedupeKey(descriptor.descriptorId, evidenceHash)
      const payloadMetaJson = JSON.stringify(macroCalendarEvidencePolicy.manualBlsIcsPayloadMetadata)
      const expected = expectedEvidence(descriptor, input.body)
      const result = archive.append(reservation, {
        sourceId: descriptor.descriptorId,
        runId: input.runId,
        sourceUrl: descriptor.sourceUrl,
        detectedAt: input.detectedAt,
        payloadFormat: descriptor.payloadFormat,
        payloadBody: input.body,
        payloadSizeBytes,
        payloadHash: evidenceHash,
        payloadMetaJson,
        sourceDedupeKey,
        parserVersion: descriptor.parserId
      })
      return result && matchesExpectedEvidence(archive, result.record, expected, evidenceHash, payloadSizeBytes, sourceDedupeKey, payloadMetaJson)
        ? reference(result.record, descriptor, descriptor.parserId, result.inserted, result.deduped)
        : undefined
    },
    getCalendarRecord(rawRecordId) {
      return archive.getRecord(rawRecordId)
    },
    listCalendarRecords(limit = macroCalendarEvidencePolicy.defaultReadLimit) {
      const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : macroCalendarEvidencePolicy.defaultReadLimit
      return archive.listRecords(Math.max(0, Math.min(normalizedLimit, macroCalendarEvidencePolicy.maximumReadLimit)))
    },
    readBody(record) {
      return archive.readBody(record)
    }
  }
}

function isValidInput(input: MacroCalendarEvidenceAppendInput): boolean {
  return Boolean(input && typeof input === 'object') && isExactFixedDescriptor(input.descriptor) && input.descriptor.accessMode === 'http' &&
    typeof input.sourceUrl === 'string' && input.sourceUrl === input.descriptor.sourceUrl &&
    input.payloadFormat === input.descriptor.payloadFormat && isCanonicalUtcMillis(input.detectedAt) &&
    typeof input.body === 'string' && input.body.trim().length > 0 &&
    typeof input.runId === 'string' && input.runId.trim().length > 0 &&
    typeof input.parserVersion === 'string' && input.parserVersion.trim().length > 0 &&
    Boolean(input.response && typeof input.response === 'object') && Number.isInteger(input.response.status) &&
    input.response.status >= 200 && input.response.status <= 299 && typeof input.response.contentType === 'string' &&
    input.response.contentType.trim().length > 0
}

function isValidManualInput(
  input: MacroCalendarManualBlsIcsAppendInput,
  descriptor: MacroCalendarOfficialSourceDescriptor
): boolean {
  return descriptor.accessMode === 'manual-upload' && typeof input?.body === 'string' && input.body.trim().length > 0 &&
    !input.body.includes('\0') && !input.body.includes('\uFFFD') &&
    Buffer.byteLength(input.body, 'utf8') <= manualBlsIcsParserPolicy.maximumBodyBytes &&
    isCanonicalUtcMillis(input.detectedAt) && typeof input.runId === 'string' && input.runId.trim().length > 0
}

function expectedEvidence(
  descriptor: MacroCalendarEvidenceSourceDescriptor,
  body: string
): ExpectedMacroCalendarEvidence {
  return { descriptor, body, payloadFormat: descriptor.payloadFormat }
}

function isExactFixedDescriptor(descriptor: MacroCalendarEvidenceSourceDescriptor): boolean {
  if (!descriptor || typeof descriptor !== 'object') return false
  if (!Array.isArray(descriptor.eventFamilies)) return false
  return isFixedMacroCalendarEvidenceDescriptor(descriptor)
}

function matchesExpectedEvidence(
  archive: MacroCalendarEvidenceArchive,
  record: RawIntelligenceRecord,
  expected: ExpectedMacroCalendarEvidence,
  evidenceHash: string,
  payloadSizeBytes: number,
  sourceDedupeKey: string,
  expectedPayloadMetaJson?: string
): boolean {
  return record.processingOwner === macroCalendarEvidencePolicy.processingOwner &&
    record.sourceId === expected.descriptor.descriptorId &&
    record.sourceUrl === expected.descriptor.sourceUrl &&
    record.payloadFormat === expected.payloadFormat &&
    record.payloadRefType === macroCalendarEvidencePolicy.payloadRefType &&
    archive.readBody(record) === expected.body &&
    record.payloadHash === evidenceHash &&
    record.payloadSizeBytes === payloadSizeBytes &&
    record.sourceDedupeKey === sourceDedupeKey &&
    (expectedPayloadMetaJson === undefined || record.payloadMetaJson === expectedPayloadMetaJson)
}

function isCanonicalUtcMillis(value: string): boolean {
  if (typeof value !== 'string') return false
  if (!macroCalendarEvidencePolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function createSourceDedupeKey(descriptorId: string, evidenceHash: string): string {
  return hash(`${descriptorId}\n${evidenceHash}`)
}

function reference(
  record: RawIntelligenceRecord,
  descriptor: MacroCalendarEvidenceSourceDescriptor,
  parserVersion: string,
  inserted: boolean,
  deduped: boolean
): MacroCalendarEvidenceReference {
  return {
    rawRecordId: record.rawRecordId, providerId: descriptor.providerId, descriptorId: descriptor.descriptorId,
    sourceUrl: record.sourceUrl!, evidenceHash: record.payloadHash, detectedAt: record.detectedAt,
    parserVersion, inserted, deduped
  }
}
