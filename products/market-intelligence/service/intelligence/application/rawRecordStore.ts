import type {
  AppendRawRecordInput,
  IgnoredRawRecordAudit,
  RawIntelligenceRecord,
  RawProcessingOwner,
  RawProcessingState,
  SafeRawRecordSummary
} from '../schema/intelligenceRecord'
import type { RawRecordSnapshot, RawRecordStorage } from '../store/rawRecordStorage'
import { assertRawRecordSnapshotDoesNotShrink, createEmptyRawRecordSnapshot, type RawRecordWriteOptions } from '../store/rawRecordStorage'
import { externalizeInlinePayloads } from './rawRecordPayloadExternalization'

/** 存量原文外置的一次盘点：三格分开报，`remainingInline` 是「还剩多少条还是内联」。 */
export type RawRecordPayloadMigration =
  | Readonly<{ state: 'unavailable'; reason: 'no-payload-directory' }>
  | Readonly<{
    state: 'migrated' | 'unchanged'
    /** `inline → file` 的条数。 */
    inlineToFile: number
    /** 老布局引用 → 内容寻址。本机预期 0（老实现一条都没外置过）。 */
    relocatedFromOldLayout: number
    /** hash 不符 / 读不到 / 写失败：原地不动，不产生「有记录无原文」。 */
    untouched: number
    alreadyContentAddressed: number
    /** 跑完之后还剩多少条 inline（归零即停；不为零说明有 untouched）。 */
    remainingInline: number
  }>

/** 保留期一次跑的结果：**可对账**——删了多少条、多少原文文件、释放多少字节、剩下多少。 */
export type RawRecordPruneResult = Readonly<{
  cutoff: string
  removedRecords: number
  removedPayloadFiles: number
  removedOrphanFiles: number
  reclaimedPayloadBytes: number
  remainingRecords: number
}>

/**
 * 归一化读原文的结果。`missing`（文件不在）与 `hash-mismatch`（在但内容不对）必须分开：
 * 两者都不等于「没有原文」，只是一条要重试、一条要人看。
 */
export type RawRecordPayloadRead =
  | Readonly<{ state: 'inline'; body: string }>
  | Readonly<{ state: 'file'; body: string }>
  | Readonly<{ state: 'missing' }>
  | Readonly<{ state: 'hash-mismatch' }>

export type RawRecordStore = {
  appendRawRecord: (input: AppendRawRecordInput) => RawIntelligenceRecord | undefined
  /**
   * 保留期：删掉「通用」记录里超过 `retentionDays` 的那些，并回收不再被引用的原文文件。
   *
   * 日历记录**不跟着轮转**（它们的原文在证据归档里、按自己的配额管）。删除是本模块唯一的
   * 合法「写少」路径，所以这里显式走 `allowRecordDecrease: 'explicit-delete'`；幂等：
   * 同一天跑第二遍 `removedRecords === 0` 且不再写盘。
   */
  pruneRawRecords: (input: Readonly<{ retentionDays: number; now?: string; includeOrphans?: boolean }>) => RawRecordPruneResult
  /**
   * 启动时幂等跑一次：把升级前就 inline 的正文搬进「内容寻址」目录、换成 file 引用。
   *
   * 按缺口判据，不用版本标记：非零就迁、归零即停，跑第二遍 `inlineToFile === 0`。
   * 失败的那条**原地不动**（`untouched`），绝不写一半——「有记录、原文读不到」比不迁更糟。
   */
  migrateInlinePayloads: () => RawRecordPayloadMigration
  getRawRecord: (rawRecordId: string) => RawIntelligenceRecord | undefined
  findBySourceDedupeKey: (sourceId: string, sourceDedupeKey: string) => RawIntelligenceRecord | undefined
  /**
   * 归一化前读原文：inline 直接用 `payloadBody`；file 引用从内容寻址目录读回并校验 hash。
   * 原文外置后**这是唯一的读口**——调用方不要再直接读 `record.payloadBody`。
   */
  readPayloadBody: (record: RawIntelligenceRecord) => RawRecordPayloadRead
  markParsed: (rawRecordId: string) => RawIntelligenceRecord | undefined
  markFailed: (rawRecordId: string, errorMessage: string) => RawIntelligenceRecord | undefined
  markNormalized: (rawRecordId: string) => RawIntelligenceRecord | undefined
  markIgnored: (rawRecordId: string, audit: IgnoredRawRecordAudit) => RawIntelligenceRecord | undefined
  listUnprocessed: (limit?: number) => RawIntelligenceRecord[]
  listByProcessingOwner: (owner: RawProcessingOwner, limit?: number) => RawIntelligenceRecord[]
  listSafeSummaries: (limit?: number) => SafeRawRecordSummary[]
  inspectSnapshot: () => { recordCount: number; serializedBytes: number; macroCalendarInlineBodyBytes: number }
  updateArchiveRef: (
    rawRecordId: string,
    patch: RawRecordArchiveRefPatch
  ) => RawIntelligenceRecord | undefined
  updateArchiveRefs: (updates: readonly Readonly<{
    rawRecordId: string
    patch: RawRecordArchiveRefPatch
  }>[]) => RawIntelligenceRecord[] | undefined
}

type RawRecordArchiveRefPatch = Pick<
  RawIntelligenceRecord,
  'payloadRefType' | 'payloadFileRef' | 'payloadCodec' | 'payloadBody' | 'archiveStatus' | 'storageTier'
>

export function createRawRecordStore(deps?: {
  snapshot?: RawRecordSnapshot
  storage?: RawRecordStorage
  /**
   * 原文外置（用户 2026-11-20）：**写路径在 store 里，调用方一个不改**。
   *
   * 给了 `payloadDirectory` + `writeVerifiedPayload` 时，`appendRawRecord` 收到的 inline body
   * 一律落文件、只存引用（`payloadBody` 不落库）；**不设大小阈值**——两种模式并存就是两条路径。
   * 原语失败时**整条不落库**并返回 undefined：留一条永远读不出原文的记录，等于把「没有」画成「有」。
   */
  payloadDirectory?: string
  writeVerifiedPayload?: (input: Readonly<{ directory: string; body: string; expectedHash: string; temporarySequence: number }>) =>
    Readonly<{ state: 'written' | 'reused'; fileRef: string }> | Readonly<{ state: 'failed'; reason: string }>
  /** 保留期删除原文文件（只有内容寻址目录里、且已无记录引用它时才调用）。返回释放的字节数。 */
  deletePayload?: (fileRef: string) => number | undefined
  /** 列出现有原文文件名（内容寻址名）；孤儿清理用。读不到就返回 undefined，按「不清理孤儿」处理。 */
  listPayloadFiles?: () => readonly string[] | undefined
  /** 读回内容寻址原文并校验 hash；`missing` / `hash-mismatch` 分开报（由原语给出）。 */
  readPayload?: (input: Readonly<{ fileRef: string; expectedHash?: string }>) =>
    Readonly<{ state: 'found'; body: string }> | Readonly<{ state: 'missing' }> | Readonly<{ state: 'hash-mismatch' }>
}): RawRecordStore {
  const snapshot = deps?.snapshot ?? createEmptyRawRecordSnapshot()
  /**
   * 读入条数 = 这一次写盘的下限。整份快照写盘时它保证「写出去的不比读进来的少」——除非调用方
   * 显式说明是删除（见 `RawRecordWriteOptions`）。2026-11-19 的复位就是少了这道闸。
   */
  let loadedRecordCount = snapshot.records.length
  const records = new Map<string, RawIntelligenceRecord>()
  const dedupeIndex = new Map<string, string>()
  let sequence = snapshot.sequence

  for (const rawRecord of snapshot.records) {
    const record = { ...rawRecord, processingOwner: rawRecord.processingOwner ?? 'generic-intelligence' }
    records.set(record.rawRecordId, record)
    dedupeIndex.set(`${record.sourceId}:${record.sourceDedupeKey}`, record.rawRecordId)
  }

  function persist(options?: RawRecordWriteOptions): void {
    if (!deps?.storage) return
    const next = {
      records: [...records.values()],
      sequence
    }
    // 单一判据：写出去的条数不得少于读入的条数（除显式删除）。写少了就抛，一个字节都不写。
    assertRawRecordSnapshotDoesNotShrink({
      loadedRecordCount,
      nextRecordCount: next.records.length,
      ...(options?.allowRecordDecrease === undefined ? {} : { allowRecordDecrease: options.allowRecordDecrease })
    })
    if (deps.storage.writeAllSync) {
      deps.storage.writeAllSync(next, options)
    } else {
      void deps.storage.writeAll(next, options)
    }
    // 写成功之后下限前移到这次写的条数：正常增长不会触发，之后的删除仍要显式说明。
    loadedRecordCount = next.records.length
  }

  function updateArchiveRefs(updates: readonly Readonly<{
    rawRecordId: string
    patch: RawRecordArchiveRefPatch
  }>[]): RawIntelligenceRecord[] | undefined {
    if (updates.length === 0 || new Set(updates.map((update) => update.rawRecordId)).size !== updates.length) return undefined
    const previous = updates.map((update) => records.get(update.rawRecordId))
    if (previous.some((record) => !record)) return undefined
    const next = updates.map((update, index) => ({ ...previous[index]!, ...update.patch }))
    updates.forEach((update, index) => records.set(update.rawRecordId, next[index]!))
    try {
      persist()
      return next
    } catch (error) {
      updates.forEach((update, index) => records.set(update.rawRecordId, previous[index]!))
      throw error
    }
  }

  return {
    pruneRawRecords(input) {
      const nowMs = input.now === undefined ? Date.now() : Date.parse(input.now)
      const cutoffMs = nowMs - input.retentionDays * 24 * 3_600_000
      const cutoff = new Date(cutoffMs).toISOString()
      const removable: RawIntelligenceRecord[] = []
      for (const record of records.values()) {
        // 只轮转通用采集；日历记录有自己的证据配额，不在这里删。
        if (record.processingOwner !== 'generic-intelligence') continue
        const detectedMs = Date.parse(record.detectedAt)
        if (Number.isFinite(detectedMs) && detectedMs < cutoffMs) removable.push(record)
      }

      const removedIds = new Set(removable.map((record) => record.rawRecordId))
      for (const record of removable) {
        records.delete(record.rawRecordId)
        dedupeIndex.delete(`${record.sourceId}:${record.sourceDedupeKey}`)
      }

      // 原文按「还有没有别的记录引用」决定去留：内容寻址会去重，删之前必须重新数一遍。
      const stillReferenced = new Set(
        [...records.values()].map((record) => record.payloadFileRef).filter((ref): ref is string => ref !== undefined)
      )
      let removedPayloadFiles = 0
      let reclaimedPayloadBytes = 0
      let removedOrphanFiles = 0
      if (deps?.deletePayload !== undefined) {
        for (const record of removable) {
          const ref = record.payloadFileRef
          if (ref === undefined || stillReferenced.has(ref)) continue
          const freed = deps.deletePayload(ref)
          if (freed === undefined) continue
          removedPayloadFiles += 1
          reclaimedPayloadBytes += freed
        }
        if (input.includeOrphans === true && deps.listPayloadFiles !== undefined) {
          const files = deps.listPayloadFiles()
          if (files !== undefined) {
            const live = new Set([
              ...stillReferenced,
              ...[...records.values()].map((record) => record.payloadFileRef).filter((ref): ref is string => ref !== undefined)
            ])
            for (const fileRef of files) {
              if (live.has(fileRef)) continue
              const freed = deps.deletePayload(fileRef)
              if (freed === undefined) continue
              removedOrphanFiles += 1
              reclaimedPayloadBytes += freed
            }
          }
        }
      }

      if (removedIds.size > 0) {
        // 唯一的合法「写少」：显式删除。写盘闸据此放行。
        persist({ allowRecordDecrease: 'explicit-delete' })
      }
      return {
        cutoff,
        removedRecords: removedIds.size,
        removedPayloadFiles,
        removedOrphanFiles,
        reclaimedPayloadBytes,
        remainingRecords: records.size
      } as const
    },
    migrateInlinePayloads() {
      if (deps?.payloadDirectory === undefined || deps.writeVerifiedPayload === undefined) {
        // 「没接上」必须与「没有要搬的」分开：前者是配置错误，不许报成 0 条。
        return { state: 'unavailable', reason: 'no-payload-directory' } as const
      }
      const directory = deps.payloadDirectory
      const write = deps.writeVerifiedPayload
      // 只有 inline / file 两种引用参与迁移；别的形状原样留着，不猜。
      // 日历证据的正文**不属于这条迁移**：它有自己的归档 owner（`macro-calendar-evidence`），
      // 由 `macroCalendarEvidenceArchive.migrateInlineBodies()` 负责搬家并写回 `archiveStatus`。
      // 这里先搬走，归档那边就再也看不到 inline 正文、`readBody` 直接读不到——那不是「没搬」，
      // 是把证据搬到了一个没人认的地方。
      const externalizable = [...records.values()]
        .filter((record) => record.processingOwner !== 'macro-calendar')
        .filter((record) => record.payloadRefType === 'inline' || record.payloadRefType === 'file')
        .map((record) => ({
          rawRecordId: record.rawRecordId,
          payloadRefType: record.payloadRefType as 'inline' | 'file',
          ...(record.payloadBody === undefined ? {} : { payloadBody: record.payloadBody }),
          payloadHash: record.payloadHash,
          ...(record.payloadFileRef === undefined ? {} : { payloadFileRef: record.payloadFileRef })
        }))
      const result = externalizeInlinePayloads({
        records: externalizable,
        deps: {
          writeVerifiedPayload: ({ body, expectedHash }) => {
            const written = write({ directory, body, expectedHash, temporarySequence: sequence + 1 })
            return written.state === 'failed' ? undefined : written.fileRef
          }
        }
      })
      const changed = result.inlineToFile + result.relocatedFromOldLayout
      if (changed > 0) {
        // 迁移只换「原文放哪」，条数一条不变 ⇒ 写盘闸（不许比读入少）自然放行。
        for (const entry of result.records) {
          const current = records.get(entry.rawRecordId)
          if (current === undefined) continue
          const { payloadBody: _previousBody, ...withoutBody } = current
          records.set(entry.rawRecordId, {
            ...withoutBody,
            payloadRefType: entry.payloadRefType,
            ...(entry.payloadBody === undefined ? {} : { payloadBody: entry.payloadBody }),
            ...(entry.payloadFileRef === undefined ? {} : { payloadFileRef: entry.payloadFileRef })
          })
        }
        persist()
      }
      return {
        state: changed > 0 ? 'migrated' : 'unchanged',
        inlineToFile: result.inlineToFile,
        relocatedFromOldLayout: result.relocatedFromOldLayout,
        untouched: result.untouched,
        alreadyContentAddressed: result.alreadyContentAddressed,
        remainingInline: [...records.values()].filter((record) => record.payloadRefType === 'inline').length
      } as const
    },
    appendRawRecord(input) {
      const dedupeKey = `${input.sourceId}:${input.sourceDedupeKey}`
      if (dedupeIndex.has(dedupeKey)) {
        return undefined
      }

      /* 原文外置：inline body 一律落文件（不设阈值）。失败则整条不落库——不留「有记录、原文读不到」的行。 */
      let payloadRefType = input.payloadRefType
      let payloadBody = input.payloadBody
      let payloadFileRef = input.payloadFileRef
      if (payloadRefType === 'inline' && payloadBody !== undefined
        && deps?.payloadDirectory !== undefined && deps.writeVerifiedPayload !== undefined) {
        const written = deps.writeVerifiedPayload({
          directory: deps.payloadDirectory,
          body: payloadBody,
          expectedHash: input.payloadHash,
          temporarySequence: sequence + 1
        })
        if (written.state === 'failed') {
          console.warn(JSON.stringify({
            marker: 'RAW_RECORD_PAYLOAD_WRITE_FAILED', sourceId: input.sourceId,
            reason: written.reason, payloadHash: input.payloadHash.slice(0, 8)
          }))
          return undefined
        }
        payloadRefType = 'file'
        payloadFileRef = written.fileRef
        payloadBody = undefined
      }
      const record: RawIntelligenceRecord = {
        rawRecordId: `raw-${++sequence}`,
        sourceId: input.sourceId,
        runId: input.runId,
        externalId: input.externalId,
        sourceUrl: input.sourceUrl,
        publishedAtRaw: input.publishedAtRaw,
        publishedAt: input.publishedAt,
        detectedAt: input.detectedAt ?? new Date().toISOString(),
        payloadFormat: input.payloadFormat,
        payloadRefType,
        ...(payloadBody === undefined ? {} : { payloadBody }),
        ...(payloadFileRef === undefined ? {} : { payloadFileRef }),
        payloadCodec: input.payloadCodec,
        payloadSizeBytes: input.payloadSizeBytes,
        payloadHash: input.payloadHash,
        payloadMetaJson: input.payloadMetaJson,
        sourceDedupeKey: input.sourceDedupeKey,
        processingOwner: input.processingOwner ?? 'generic-intelligence',
        processingState: input.processingState ?? 'received',
        parserVersion: input.parserVersion,
        errorMessage: input.errorMessage,
        storageTier: input.storageTier ?? 'hot',
        archiveStatus: input.archiveStatus ?? 'none'
      }

      records.set(record.rawRecordId, record)
      dedupeIndex.set(dedupeKey, record.rawRecordId)
      persist()
      return record
    },
    getRawRecord(rawRecordId) {
      return records.get(rawRecordId)
    },
    findBySourceDedupeKey(sourceId, sourceDedupeKey) {
      const rawRecordId = dedupeIndex.get(`${sourceId}:${sourceDedupeKey}`)
      return rawRecordId ? records.get(rawRecordId) : undefined
    },

    readPayloadBody(record) {
      if (record.payloadBody !== undefined) return { state: 'inline', body: record.payloadBody }
      if (record.payloadFileRef === undefined || deps?.readPayload === undefined) return { state: 'missing' }
      const read = deps.readPayload({
        fileRef: record.payloadFileRef,
        ...(record.payloadHash === undefined ? {} : { expectedHash: record.payloadHash })
      })
      return read.state === 'found' ? { state: 'file', body: read.body } : read
    },
    markParsed(rawRecordId) {
      const next = transitionState(records, rawRecordId, 'parsed')
      if (next) persist()
      return next
    },
    markFailed(rawRecordId, errorMessage) {
      const next = updateRecord(records, rawRecordId, (record) => ({
        ...record,
        processingState: 'failed',
        errorMessage
      }))
      if (next) persist()
      return next
    },
    markNormalized(rawRecordId) {
      const next = transitionState(records, rawRecordId, 'normalized')
      if (next) persist()
      return next
    },
    markIgnored(rawRecordId, audit) {
      const next = updateRecord(records, rawRecordId, (record) => ({
        ...record,
        processingState: 'ignored',
        errorMessage: audit.ignoredReasonCode,
        payloadMetaJson: JSON.stringify(audit)
      }))
      if (next) persist()
      return next
    },
    /**
     * 待办记录，**最新的排最前**，`limit` 省略时返回全部（诊断用）。
     *
     * 2026-11-21 事故：以前是追加顺序（最旧的在最前），队头那批永远排第一，里面一条每半小时
     * 失败一次的记录就把后面 900 多条一起挡住。倒序之后最旧的一批不会再把窗口占住，
     * 「哪一批先处理」由 `normalizationBatchSelection` 按实测规则决定。
     */
    listUnprocessed(limit?: number) {
      const ordered = [...records.values()]
        .filter((record) => record.processingOwner === 'generic-intelligence')
        .filter((record) => record.processingState === 'received' || record.processingState === 'parsed')
        .sort(
          (left, right) =>
            right.detectedAt.localeCompare(left.detectedAt) || left.rawRecordId.localeCompare(right.rawRecordId)
        )
      return limit === undefined ? ordered : ordered.slice(0, limit)
    },
    listByProcessingOwner(owner, limit = 100) {
      return [...records.values()]
        .filter((record) => record.processingOwner === owner)
        .sort((left, right) => left.detectedAt.localeCompare(right.detectedAt) || left.rawRecordId.localeCompare(right.rawRecordId))
        .slice(0, limit)
    },
    listSafeSummaries(limit = 100) {
      return [...records.values()]
        .filter((record) => record.processingOwner === 'generic-intelligence')
        .slice(0, limit)
        .map(toSafeSummary)
    },
    inspectSnapshot() {
      const snapshot = { records: [...records.values()], sequence }
      return {
        recordCount: records.size,
        serializedBytes: Buffer.byteLength(JSON.stringify(snapshot), 'utf8'),
        macroCalendarInlineBodyBytes: snapshot.records
          .filter((record) => record.processingOwner === 'macro-calendar' && record.payloadRefType === 'inline')
          .reduce((total, record) => total + Buffer.byteLength(record.payloadBody ?? '', 'utf8'), 0)
      }
    },
    updateArchiveRef(rawRecordId, patch) {
      return updateArchiveRefs([{ rawRecordId, patch }])?.[0]
    },
    updateArchiveRefs
  }
}

function transitionState(
  records: Map<string, RawIntelligenceRecord>,
  rawRecordId: string,
  processingState: RawProcessingState
): RawIntelligenceRecord | undefined {
  return updateRecord(records, rawRecordId, (record) => ({
    ...record,
    processingState
  }))
}

function updateRecord(
  records: Map<string, RawIntelligenceRecord>,
  rawRecordId: string,
  updater: (record: RawIntelligenceRecord) => RawIntelligenceRecord
): RawIntelligenceRecord | undefined {
  const current = records.get(rawRecordId)
  if (!current) return undefined
  const next = updater(current)
  records.set(rawRecordId, next)
  return next
}

function toSafeSummary(record: RawIntelligenceRecord): SafeRawRecordSummary {
  const { payloadBody: _payloadBody, payloadFileRef: _payloadFileRef, ...summary } = record
  return summary
}
