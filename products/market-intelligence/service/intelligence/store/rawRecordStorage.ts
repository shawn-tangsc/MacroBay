import { readJsonFileRecovering, readJsonFileRecoveringSync, writeJsonFileAtomicallySync } from '@platform/storage/jsonFileStorage'

import type { RawIntelligenceRecord } from '../schema/intelligenceRecord'

export type RawRecordSnapshot = {
  records: RawIntelligenceRecord[]
  sequence: number
}

/**
 * 一次写盘把记录数写少了：**除显式删除外一律拒绝**。
 *
 * 这不是理论风险：2026-11-19 的复位就是把「读到的记录数」变成 0 之后被下一次写落盘
 * （`records: []`、`sequence: 8361` 原样留下，所以新记录从 raw-8362 接着编号）。整份快照
 * 一次写盘意味着**任何一次读少了的加载都会被下一次写固化成事实**，所以判据放在写口：
 * 写出的条数不得少于读入的条数，除非调用方明确说这是删除。
 */
export class RawRecordSnapshotShrinkError extends Error {
  readonly code = 'raw-record-snapshot-shrink'
  readonly loadedRecordCount: number
  readonly nextRecordCount: number

  constructor(loadedRecordCount: number, nextRecordCount: number) {
    super(`raw record snapshot would shrink from ${loadedRecordCount} to ${nextRecordCount}`)
    this.name = 'RawRecordSnapshotShrinkError'
    this.loadedRecordCount = loadedRecordCount
    this.nextRecordCount = nextRecordCount
  }
}

export type RawRecordWriteOptions = Readonly<{
  /**
   * 唯一允许「写少」的理由。默认不传 = 不许变少；删除功能必须显式传它，否则写被拒。
   * 用字面量而不是布尔：调用点读起来就是「这是删除」，不会被顺手传成 `true`。
   */
  allowRecordDecrease?: 'explicit-delete'
}>

/** 唯一判据（纯函数）：写盘后的条数不得少于读入条数，除显式删除。 */
export function assertRawRecordSnapshotDoesNotShrink(input: Readonly<{
  loadedRecordCount: number
  nextRecordCount: number
  allowRecordDecrease?: 'explicit-delete'
}>): void {
  if (input.allowRecordDecrease === 'explicit-delete') return
  if (input.nextRecordCount < input.loadedRecordCount) {
    throw new RawRecordSnapshotShrinkError(input.loadedRecordCount, input.nextRecordCount)
  }
}

export type RawRecordStorage = {
  readAll: () => Promise<RawRecordSnapshot>
  writeAll: (snapshot: RawRecordSnapshot, options?: RawRecordWriteOptions) => Promise<void>
  writeAllSync?: (snapshot: RawRecordSnapshot, options?: RawRecordWriteOptions) => void
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
  if (!Array.isArray(candidate.records)) {
    /* **不再静默**：形状不对时整份记录归零、`sequence` 却被留下，于是下一次写把「0 条 + 旧序号」
       固化成事实（2026-11-19 的复位就是这个终态）。这里留一行，至少能在 app.log 里被追到。 */
    console.warn(JSON.stringify({
      marker: 'RAW_RECORD_SNAPSHOT_RECORDS_NOT_ARRAY',
      sequence: typeof candidate.sequence === 'number' ? candidate.sequence : null
    }))
  }
  const rawRecords = Array.isArray(candidate.records) ? candidate.records : []
  const records = rawRecords
    .filter((record): record is RawIntelligenceRecord => Boolean(record?.rawRecordId && record?.sourceId))
    .map((record) => ({ ...record, processingOwner: record.processingOwner ?? 'generic-intelligence' }))
  if (rawRecords.length !== records.length) {
    console.warn(JSON.stringify({
      marker: 'RAW_RECORD_SNAPSHOT_ENTRIES_DROPPED',
      read: rawRecords.length,
      kept: records.length
    }))
  }
  const sequence =
    typeof candidate.sequence === 'number' && Number.isFinite(candidate.sequence)
      ? Math.max(candidate.sequence, ...records.map((record) => Number.parseInt(record.rawRecordId.replace(/^raw-/, ''), 10) || 0))
      : records.length
  return { records, sequence }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
