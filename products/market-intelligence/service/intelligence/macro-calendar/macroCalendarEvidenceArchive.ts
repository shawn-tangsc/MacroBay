import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

import type { RawRecordStore } from '../application/rawRecordStore'
import type { AppendRawRecordInput, RawIntelligenceRecord } from '../schema/intelligenceRecord'

export const macroCalendarEvidenceArchivePolicy = Object.freeze({
  maximumArchiveBytes: 900 * 1024 * 1024,
  maximumMetadataBytes: 16 * 1024 * 1024,
  maximumRecordMetadataBytes: 32 * 1024,
  metadataEnvelopeOverheadBytes: 64,
  processingOwner: 'macro-calendar',
  payloadRefType: 'file',
  payloadCodec: 'plain',
  archiveStatus: 'archived',
  storageTier: 'warm',
  archiveFilePattern: /^[a-f0-9]{64}\.bin$/
} as const)

export type MacroCalendarEvidenceReservation = Readonly<Record<never, never>>

export type MacroCalendarEvidenceArchiveAppendInput = Omit<
  AppendRawRecordInput,
  'payloadRefType' | 'payloadFileRef' | 'payloadCodec' | 'processingOwner' | 'archiveStatus' | 'storageTier'
> & {
  payloadBody: string
  payloadSizeBytes: number
}

export type MacroCalendarEvidenceArchive = Readonly<{
  reserve: (maximumBytes: number) => MacroCalendarEvidenceReservation | undefined
  release: (reservation: MacroCalendarEvidenceReservation) => boolean
  append: (
    reservation: MacroCalendarEvidenceReservation,
    input: MacroCalendarEvidenceArchiveAppendInput
  ) => Readonly<{ record: RawIntelligenceRecord; inserted: boolean; deduped: boolean }> | undefined
  readBody: (record: RawIntelligenceRecord) => string | undefined
  getRecord: (rawRecordId: string) => RawIntelligenceRecord | undefined
  listRecords: (limit?: number) => RawIntelligenceRecord[]
  migrateInlineBodies: () => Readonly<{
    state: 'migrated' | 'unchanged' | 'unavailable'
    migratedCount: number
    dedupedCount: number
  }>
  inspect: () => Readonly<{ committedBytes: number; reservedBytes: number; activeReservations: number }>
}>

type ReservationState = { maximumBytes: number; maximumMetadataBytes: number }

export function createMacroCalendarEvidenceArchive(input: Readonly<{
  rawRecords: RawRecordStore
  archiveDirectory: string
}>): MacroCalendarEvidenceArchive {
  mkdirSync(input.archiveDirectory, { recursive: true })
  const reservations = new WeakMap<object, ReservationState>()
  const activeReservations = new Set<object>()
  let reservedBytes = 0
  let reservedMetadataBytes = 0
  let committedBytes = initialCommittedBytes(input.rawRecords, input.archiveDirectory)
  let temporarySequence = 0

  function consume(reservation: MacroCalendarEvidenceReservation): ReservationState | undefined {
    if (!reservation || typeof reservation !== 'object') return undefined
    const state = reservations.get(reservation)
    if (!state || !activeReservations.delete(reservation)) return undefined
    reservations.delete(reservation)
    reservedBytes -= state.maximumBytes
    reservedMetadataBytes -= state.maximumMetadataBytes
    return state
  }

  function readBody(record: RawIntelligenceRecord): string | undefined {
    try {
      if (record.processingOwner !== macroCalendarEvidenceArchivePolicy.processingOwner) return undefined
      if (record.payloadRefType === 'inline' && typeof record.payloadBody === 'string') {
        return matchesBody(record, record.payloadBody) ? record.payloadBody : undefined
      }
      if (record.payloadRefType !== macroCalendarEvidenceArchivePolicy.payloadRefType ||
        typeof record.payloadFileRef !== 'string' ||
        !macroCalendarEvidenceArchivePolicy.archiveFilePattern.test(record.payloadFileRef)) return undefined
      const body = readFileSync(join(input.archiveDirectory, record.payloadFileRef), 'utf8')
      return matchesBody(record, body) ? body : undefined
    } catch {
      return undefined
    }
  }

  function hasMetadataCapacity(additionalBytes: number): boolean {
    try {
      return input.rawRecords.inspectSnapshot().serializedBytes + reservedMetadataBytes + additionalBytes <=
        macroCalendarEvidenceArchivePolicy.maximumMetadataBytes
    } catch {
      return false
    }
  }

  return Object.freeze({
    reserve(maximumBytes) {
      if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 ||
        !hasMetadataCapacity(macroCalendarEvidenceArchivePolicy.maximumRecordMetadataBytes) ||
        committedBytes + reservedBytes + maximumBytes > macroCalendarEvidenceArchivePolicy.maximumArchiveBytes) return undefined
      const reservation = Object.freeze({})
      reservations.set(reservation, {
        maximumBytes,
        maximumMetadataBytes: macroCalendarEvidenceArchivePolicy.maximumRecordMetadataBytes
      })
      activeReservations.add(reservation)
      reservedBytes += maximumBytes
      reservedMetadataBytes += macroCalendarEvidenceArchivePolicy.maximumRecordMetadataBytes
      return reservation
    },
    release(reservation) {
      return Boolean(consume(reservation))
    },
    append(reservation, appendInput) {
      const reservationState = consume(reservation)
      if (!reservationState || !isAppendInput(appendInput, reservationState.maximumBytes)) return undefined
      const existing = input.rawRecords.findBySourceDedupeKey(appendInput.sourceId, appendInput.sourceDedupeKey)
      if (existing) {
        return existing.payloadHash === appendInput.payloadHash && readBody(existing) === appendInput.payloadBody
          ? Object.freeze({ record: existing, inserted: false, deduped: true })
          : undefined
      }
      if (!hasMetadataCapacity(reservationState.maximumMetadataBytes)) return undefined

      const archiveFileRef = `${appendInput.payloadHash}.bin`
      const archivePath = join(input.archiveDirectory, archiveFileRef)
      const existed = existsSync(archivePath)
      const recordInput: AppendRawRecordInput = {
        ...appendInput,
        payloadRefType: macroCalendarEvidenceArchivePolicy.payloadRefType,
        payloadFileRef: archiveFileRef,
        payloadCodec: macroCalendarEvidenceArchivePolicy.payloadCodec,
        payloadBody: undefined,
        processingOwner: macroCalendarEvidenceArchivePolicy.processingOwner,
        archiveStatus: macroCalendarEvidenceArchivePolicy.archiveStatus,
        storageTier: macroCalendarEvidenceArchivePolicy.storageTier
      }
      if (!metadataFitsReservation(recordInput, reservationState.maximumMetadataBytes)) return undefined
      if (!writeVerifiedBody(archivePath, appendInput.payloadBody, appendInput.payloadHash, ++temporarySequence)) return undefined
      if (!existed) committedBytes += appendInput.payloadSizeBytes
      const record = input.rawRecords.appendRawRecord(recordInput)
      if (!record) {
        const deduped = input.rawRecords.findBySourceDedupeKey(appendInput.sourceId, appendInput.sourceDedupeKey)
        return deduped && deduped.payloadHash === appendInput.payloadHash && readBody(deduped) === appendInput.payloadBody
          ? Object.freeze({ record: deduped, inserted: false, deduped: true })
          : undefined
      }
      return Object.freeze({ record, inserted: true, deduped: false })
    },
    readBody,
    getRecord(rawRecordId) {
      const record = input.rawRecords.getRawRecord(rawRecordId)
      return record?.processingOwner === macroCalendarEvidenceArchivePolicy.processingOwner ? record : undefined
    },
    listRecords(limit = 100) {
      const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 100
      return input.rawRecords.listByProcessingOwner('macro-calendar', normalizedLimit)
    },
    migrateInlineBodies() {
      let migratedCount = 0
      let dedupedCount = 0
      const records = input.rawRecords.listByProcessingOwner('macro-calendar', Number.MAX_SAFE_INTEGER)
      const committedBytesBeforeMigration = committedBytes
      const createdArchivePaths: string[] = []
      const pending: Array<Readonly<{
        record: RawIntelligenceRecord
        body: string
        bodyBytes: number
        archiveFileRef: string
        existed: boolean
      }>> = []

      function failMigration(): Readonly<{
        state: 'unavailable'
        migratedCount: 0
        dedupedCount: 0
      }> {
        createdArchivePaths.forEach((path) => {
          try { rmSync(path, { force: true }) } catch { /* Keep the failure result. */ }
        })
        committedBytes = committedBytesBeforeMigration
        return Object.freeze({ state: 'unavailable', migratedCount: 0, dedupedCount: 0 })
      }

      for (const record of records) {
        if (record.payloadRefType !== 'inline' || typeof record.payloadBody !== 'string') continue
        const body = record.payloadBody
        if (!matchesBody(record, body)) {
          return failMigration()
        }
        const archiveFileRef = `${record.payloadHash}.bin`
        const archivePath = join(input.archiveDirectory, archiveFileRef)
        const existed = existsSync(archivePath)
        const bodyBytes = Buffer.byteLength(body, 'utf8')
        // Migration temporarily retains the inline copy until its batch metadata update commits.
        if (!existed && committedBytes + reservedBytes + bodyBytes > macroCalendarEvidenceArchivePolicy.maximumArchiveBytes) {
          return failMigration()
        }
        if (!existed) createdArchivePaths.push(archivePath)
        if (!writeVerifiedBody(archivePath, body, record.payloadHash, ++temporarySequence)) {
          return failMigration()
        }
        if (!existed) committedBytes += bodyBytes
        pending.push({ record, body, bodyBytes, archiveFileRef, existed })
      }
      if (pending.length > 0) {
        try {
          const updated = input.rawRecords.updateArchiveRefs(pending.map((item) => ({
            rawRecordId: item.record.rawRecordId,
            patch: {
              payloadRefType: macroCalendarEvidenceArchivePolicy.payloadRefType,
              payloadFileRef: item.archiveFileRef,
              payloadCodec: macroCalendarEvidenceArchivePolicy.payloadCodec,
              payloadBody: undefined,
              archiveStatus: macroCalendarEvidenceArchivePolicy.archiveStatus,
              storageTier: macroCalendarEvidenceArchivePolicy.storageTier
            }
          })))
          if (!updated || updated.length !== pending.length) {
            return failMigration()
          } else {
            pending.forEach((item, index) => {
              committedBytes -= item.bodyBytes
              if (item.existed) dedupedCount += 1
              else migratedCount += 1
            })
          }
        } catch {
          return failMigration()
        }
      }
      return Object.freeze({
        state: migratedCount > 0 || dedupedCount > 0 ? 'migrated' : 'unchanged',
        migratedCount,
        dedupedCount
      })
    },
    inspect() {
      return Object.freeze({ committedBytes, reservedBytes, activeReservations: activeReservations.size })
    }
  })

  function writeVerifiedBody(path: string, body: string, expectedHash: string, sequence: number): boolean {
    const temporaryPath = `${path}.${process.pid}.${sequence}.tmp`
    try {
      if (!existsSync(path)) {
        writeFileSync(temporaryPath, body, { encoding: 'utf8', flag: 'wx' })
        renameSync(temporaryPath, path)
      }
      const stored = readFileSync(path, 'utf8')
      return hash(stored) === expectedHash && Buffer.byteLength(stored, 'utf8') === Buffer.byteLength(body, 'utf8')
    } catch {
      return false
    } finally {
      try { rmSync(temporaryPath, { force: true }) } catch { /* Keep the original result. */ }
    }
  }
}

function initialCommittedBytes(rawRecords: RawRecordStore, archiveDirectory: string): number {
  let bytes = 0
  try {
    for (const name of readdirSync(archiveDirectory)) {
      if (macroCalendarEvidenceArchivePolicy.archiveFilePattern.test(name)) bytes += statSync(join(archiveDirectory, name)).size
    }
  } catch { /* The archive directory was created above. */ }
  for (const record of rawRecords.listByProcessingOwner('macro-calendar', Number.MAX_SAFE_INTEGER)) {
    if (record.payloadRefType === 'inline' && typeof record.payloadBody === 'string') bytes += Buffer.byteLength(record.payloadBody, 'utf8')
  }
  return bytes
}

function isAppendInput(value: MacroCalendarEvidenceArchiveAppendInput, maximumBytes: number): boolean {
  if (!value || typeof value !== 'object' || typeof value.payloadBody !== 'string' || value.payloadBody.length === 0 || value.payloadBody.includes('\0')) return false
  const bytes = Buffer.byteLength(value.payloadBody, 'utf8')
  return Number.isSafeInteger(value.payloadSizeBytes) && value.payloadSizeBytes === bytes && bytes <= maximumBytes &&
    typeof value.payloadHash === 'string' && value.payloadHash === hash(value.payloadBody) &&
    typeof value.sourceId === 'string' && value.sourceId.trim().length > 0 &&
    typeof value.sourceDedupeKey === 'string' && value.sourceDedupeKey.trim().length > 0
}

function matchesBody(record: RawIntelligenceRecord, body: string): boolean {
  const bytes = Buffer.byteLength(body, 'utf8')
  return record.payloadHash === hash(body) && (record.payloadSizeBytes === undefined || record.payloadSizeBytes === bytes)
}

function metadataFitsReservation(input: AppendRawRecordInput, maximumBytes: number): boolean {
  const upperBoundRecord = {
    ...input,
    rawRecordId: `raw-${Number.MAX_SAFE_INTEGER}`,
    processingState: input.processingState ?? 'received'
  }
  return Buffer.byteLength(JSON.stringify(upperBoundRecord), 'utf8') +
    macroCalendarEvidenceArchivePolicy.metadataEnvelopeOverheadBytes <= maximumBytes
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
