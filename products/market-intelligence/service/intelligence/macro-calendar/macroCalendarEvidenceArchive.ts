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

/**
 * **每个 owner 各自的元数据配额**（不是「人人 16MB」）。
 *
 * 原来的判据是「整库 serializedBytes ≤ 16MB」。实测（2026-11-16）：库里 19.51MB，其中
 * `generic-intelligence` 占 **19.13MB / 5583 条**、`macro-calendar` 只占 **0.39MB / 495 条**——
 * 共享预算被别的源吃满，把日历饿死，于是每次采集在「预留」这一步就判 `evidence-persist-failed`，
 * 而且耗时只有 88–243ms（还没发请求就失败）。
 *
 * 所以：**按 owner 计量 + 一条全局软上限**。既不连坐（日历自己的 0.39MB 离 4MB 差得远），
 * 也不让总库失控（全局超软上限就拒绝并打一行结构化日志）。
 *
 * 数字的依据：
 * - `macro-calendar` 4MB：现值 0.39MB 的约 10 倍，够未来几个月的证据行；载荷本体已经归档成文件，
 *   进这份 JSON 的只有元数据；
 * - `generic-intelligence` 12MB：**现值 19.13MB 已经越界**，所以它必须自己的保留期降下来
 *   （实测 ≤7 天可腾出 14.5MB），这条归情报采集线；
 * - 全局软上限 32MB：现值 19.51MB，留出日历余量，又能挡住「N 个 owner × 各自配额」的总量失控。
 * 调这三个数的人必须看到上面这段理由——不要只改数字。
 */
export const rawRecordMetadataQuotaPolicy = Object.freeze({
  perOwnerBytes: Object.freeze({
    'macro-calendar': 4 * 1024 * 1024,
    'generic-intelligence': 12 * 1024 * 1024
  } as Readonly<Record<string, number>>),
  /** 没登记的 owner：给一个保守的小额度，同样受全局软上限约束。 */
  defaultOwnerBytes: 2 * 1024 * 1024,
  globalBytes: 32 * 1024 * 1024
} as const)

export const macroCalendarEvidenceArchivePolicy = Object.freeze({
  maximumArchiveBytes: 900 * 1024 * 1024,
  /** 全局软上限（旧字段保留为别名：判据已改为按 owner + 全局两条，见 `rawRecordMetadataQuotaPolicy`）。 */
  maximumMetadataBytes: rawRecordMetadataQuotaPolicy.globalBytes,
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
  /** 上一次 `reserve` 被拒的原因：上层据此报 `metadata-quota-exceeded` 等独立码，不再折叠兜底。 */
  lastReserveRejection: () => EvidenceReserveRejection | undefined
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

export type EvidenceReserveRejection = 'owner-quota' | 'global-quota' | 'archive-capacity' | 'metadata-unreadable'

export function createMacroCalendarEvidenceArchive(input: Readonly<{
  rawRecords: RawRecordStore
  archiveDirectory: string
  /** 产品日志口：配额拒绝必须留痕（console 不进 `app.log`，等于没有）。 */
  log?: (level: 'warn', event: string, fields?: Record<string, unknown>) => void
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

  /**
   * 两条判据：**本 owner 的已用量 + 本条 ≤ 本 owner 配额**，且**整库 ≤ 全局软上限**。
   * 超了各打一行结构化日志（哪一条越界、owner、已用、申请），不静默拒绝。
   */
  /** 上一次 `reserve` 被拒的原因（用户 2026-11-20）：让上层能把「为什么」报出去，不再折叠成兜底码。 */
  let lastRejection: EvidenceReserveRejection | undefined

  function hasMetadataCapacity(additionalBytes: number): boolean {
    try {
      const ownerQuota = rawRecordMetadataQuotaPolicy.perOwnerBytes[macroCalendarEvidenceArchivePolicy.processingOwner]
        ?? rawRecordMetadataQuotaPolicy.defaultOwnerBytes
      const ownerUsed = input.rawRecords.listByProcessingOwner(macroCalendarEvidenceArchivePolicy.processingOwner,
        Number.MAX_SAFE_INTEGER).reduce((sum, record) => sum + Buffer.byteLength(JSON.stringify(record)), 0)
      const globalUsed = input.rawRecords.inspectSnapshot().serializedBytes
      if (ownerUsed + reservedMetadataBytes + additionalBytes > ownerQuota) {
        lastRejection = 'owner-quota'
        const fields = { owner: macroCalendarEvidenceArchivePolicy.processingOwner, used: ownerUsed,
          reserved: reservedMetadataBytes, ask: additionalBytes, quota: ownerQuota }
        input.log?.('warn', 'macro-calendar.evidence.metadata-quota-exceeded', fields)
        console.warn(`[macro-calendar] 证据元数据超出本 source 配额：${JSON.stringify(fields)}`)
        return false
      }
      if (globalUsed + reservedMetadataBytes + additionalBytes > rawRecordMetadataQuotaPolicy.globalBytes) {
        lastRejection = 'global-quota'
        const fields = { used: globalUsed, reserved: reservedMetadataBytes, ask: additionalBytes,
          cap: rawRecordMetadataQuotaPolicy.globalBytes }
        input.log?.('warn', 'macro-calendar.evidence.metadata-quota-exceeded', fields)
        console.warn(`[macro-calendar] 证据元数据超出全局软上限：${JSON.stringify(fields)}`)
        return false
      }
      return true
    } catch {
      lastRejection = 'metadata-unreadable'
      input.log?.('warn', 'macro-calendar.evidence.metadata-unreadable', {})
      return false
    }
  }

  return Object.freeze({
    reserve(maximumBytes) {
      lastRejection = undefined
      if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 ||
        !hasMetadataCapacity(macroCalendarEvidenceArchivePolicy.maximumRecordMetadataBytes) ||
        committedBytes + reservedBytes + maximumBytes > macroCalendarEvidenceArchivePolicy.maximumArchiveBytes) {
        lastRejection = 'archive-capacity'
        input.log?.('warn', 'macro-calendar.evidence.archive-capacity-exceeded',
          { committed: committedBytes, reserved: reservedBytes, ask: maximumBytes,
            cap: macroCalendarEvidenceArchivePolicy.maximumArchiveBytes })
        return undefined
      }
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
    lastReserveRejection: () => lastRejection,
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
