import { readJsonFileRecovering, readJsonFileRecoveringSync, writeJsonFileAtomicallySync } from '@platform/storage/jsonFileStorage'

import type { RawIntelligenceRecord } from '../schema/intelligenceRecord'

export type RawRecordSnapshot = {
  records: RawIntelligenceRecord[]
  sequence: number
}

export type RawRecordStorage = {
  readAll: () => Promise<RawRecordSnapshot>
  writeAll: (snapshot: RawRecordSnapshot) => Promise<void>
  writeAllSync?: (snapshot: RawRecordSnapshot) => void
}

export function createEmptyRawRecordSnapshot(): RawRecordSnapshot {
  return { records: [], sequence: 0 }
}

export function createInMemoryRawRecordStorage(initial: RawRecordSnapshot = createEmptyRawRecordSnapshot()): RawRecordStorage {
  let snapshot = initial
  return {
    async readAll() {
      return {
        records: [...snapshot.records],
        sequence: snapshot.sequence
      }
    },
    async writeAll(next) {
      snapshot = {
        records: [...next.records],
        sequence: next.sequence
      }
    }
  }
}

export function createRawRecordJsonStorage(filePath: string): RawRecordStorage {
  return {
    async readAll() {
      const parsed = await readJsonFileRecovering(filePath)
      return parsed === undefined ? createEmptyRawRecordSnapshot() : normalizeRawRecordSnapshot(parsed)
    },
    writeAllSync(snapshot) {
      writeJsonFileAtomicallySync(filePath, snapshot)
    },
    async writeAll(snapshot) {
      this.writeAllSync?.(snapshot)
    }
  }
}

export function readRawRecordSnapshotSync(filePath: string): RawRecordSnapshot {
  const parsed = readJsonFileRecoveringSync(filePath)
  return parsed === undefined ? createEmptyRawRecordSnapshot() : normalizeRawRecordSnapshot(parsed)
}

export function normalizeRawRecordSnapshot(value: unknown): RawRecordSnapshot {
  if (!value || typeof value !== 'object') return createEmptyRawRecordSnapshot()
  const candidate = value as Partial<RawRecordSnapshot>
  const records = Array.isArray(candidate.records)
    ? candidate.records
      .filter((record): record is RawIntelligenceRecord => Boolean(record?.rawRecordId && record?.sourceId))
      .map((record) => ({ ...record, processingOwner: record.processingOwner ?? 'generic-intelligence' }))
    : []
  const sequence =
    typeof candidate.sequence === 'number' && Number.isFinite(candidate.sequence)
      ? Math.max(candidate.sequence, ...records.map((record) => Number.parseInt(record.rawRecordId.replace(/^raw-/, ''), 10) || 0))
      : records.length
  return { records, sequence }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
