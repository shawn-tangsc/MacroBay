import type {
  AppendRawRecordInput,
  IgnoredRawRecordAudit,
  RawIntelligenceRecord,
  RawProcessingOwner,
  RawProcessingState,
  SafeRawRecordSummary
} from '../schema/intelligenceRecord'
import type { RawRecordSnapshot, RawRecordStorage } from '../store/rawRecordStorage'
import { createEmptyRawRecordSnapshot } from '../store/rawRecordStorage'

export type RawRecordStore = {
  appendRawRecord: (input: AppendRawRecordInput) => RawIntelligenceRecord | undefined
  getRawRecord: (rawRecordId: string) => RawIntelligenceRecord | undefined
  findBySourceDedupeKey: (sourceId: string, sourceDedupeKey: string) => RawIntelligenceRecord | undefined
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
}): RawRecordStore {
  const snapshot = deps?.snapshot ?? createEmptyRawRecordSnapshot()
  const records = new Map<string, RawIntelligenceRecord>()
  const dedupeIndex = new Map<string, string>()
  let sequence = snapshot.sequence

  for (const rawRecord of snapshot.records) {
    const record = { ...rawRecord, processingOwner: rawRecord.processingOwner ?? 'generic-intelligence' }
    records.set(record.rawRecordId, record)
    dedupeIndex.set(`${record.sourceId}:${record.sourceDedupeKey}`, record.rawRecordId)
  }

  function persist(): void {
    if (!deps?.storage) return
    const snapshot = {
      records: [...records.values()],
      sequence
    }
    if (deps.storage.writeAllSync) {
      deps.storage.writeAllSync(snapshot)
      return
    }
    void deps.storage.writeAll(snapshot)
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
    listUnprocessed(limit = 100) {
      return [...records.values()]
        .filter((record) => record.processingOwner === 'generic-intelligence')
        .filter((record) => record.processingState === 'received' || record.processingState === 'parsed')
        .slice(0, limit)
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
