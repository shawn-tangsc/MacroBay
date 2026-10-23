import type { IntelligenceRetentionMode } from '../schema/intelligenceSource'
import type { RawRecordStore } from './rawRecordStore'
import { isDefillamaStablecoinRetiredPath } from './sourceCatalog'
import { archivePayload } from '@platform/jobs'

export const HOT_RETENTION_DAYS: Record<IntelligenceRetentionMode, number> = {
  compact: 7,
  balanced: 30,
  extended: 90
}

export function resolveHotRetentionDays(mode: IntelligenceRetentionMode): number {
  return HOT_RETENTION_DAYS[mode]
}

export function createIntelligenceArchiveService(deps: {
  rawRecordStore: RawRecordStore
  archiveBaseDir: string
  inlineThresholdBytes?: number
  compactTranslationRecords?: (retentionMode: IntelligenceRetentionMode) => Promise<number>
}) {
  return {
    async compactSource(input: { sourceId: string; retentionMode: IntelligenceRetentionMode }) {
      const hotRetentionDays = resolveHotRetentionDays(input.retentionMode)
      if (isDefillamaStablecoinRetiredPath(input.sourceId)) {
        return { archivedCount: 0, hotRetentionDays, translationRemoved: 0 }
      }
      const cutoffMs = Date.now() - hotRetentionDays * 24 * 60 * 60 * 1000
      let archivedCount = 0

      for (const summary of deps.rawRecordStore.listSafeSummaries(500)) {
        if (summary.sourceId !== input.sourceId) continue
        const record = deps.rawRecordStore.getRawRecord(summary.rawRecordId)
        if (!record || record.archiveStatus === 'archived') continue

        const threshold = deps.inlineThresholdBytes ?? 4_096
        const payloadSize = record.payloadBody?.length ?? record.payloadSizeBytes ?? 0
        const shouldArchiveBySize = Boolean(record.payloadBody) && payloadSize > threshold
        const shouldArchiveByAge = new Date(record.detectedAt).getTime() <= cutoffMs
        if (!shouldArchiveBySize && !shouldArchiveByAge) continue
        if (!record.payloadBody || record.payloadRefType === 'file') continue

        const archiveRef = await archivePayload({
          baseDir: `${deps.archiveBaseDir}/${input.sourceId}`,
          payload: record.payloadBody,
          inlineThresholdBytes: deps.inlineThresholdBytes ?? 4_096,
          fileNamePrefix: record.rawRecordId
        })

        if (archiveRef.kind !== 'file') continue

        deps.rawRecordStore.updateArchiveRef(record.rawRecordId, {
          payloadRefType: 'file',
          payloadFileRef: archiveRef.ref,
          payloadCodec: 'plain',
          payloadBody: undefined,
          archiveStatus: 'archived',
          storageTier: 'warm'
        })
        archivedCount += 1
      }

      const translationRemoved = deps.compactTranslationRecords
        ? await deps.compactTranslationRecords(input.retentionMode)
        : 0

      return { archivedCount, hotRetentionDays, translationRemoved }
    }
  }
}

export type IntelligenceArchiveService = ReturnType<typeof createIntelligenceArchiveService>
