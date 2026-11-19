import type { IntelligenceRetentionMode } from '../schema/intelligenceSource'
import type { RawRecordStore } from './rawRecordStore'
import { isDefillamaStablecoinRetiredPath } from './sourceCatalog'

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
      /* **原文外置已退休**（用户 2026-11-20，方案 A）：raw record 的原文只由「写路径 + 内容寻址原语」
         一个地方写。这里原先按 4096 字节阈值 + `listSafeSummaries(500)` 窗口挪原文，两个限制都在
         静默失效（7654 条里 7249 条 ≤4096、每轮只看前 500 条），36MB 就是这么涨起来的；
         而且它写的是 `源目录/记录id` 命名，与内容寻址是同一标记指向两个位置。
         这个任务以后**只做译文压缩**，`archivedCount` 恒为 0（保留返回形状给既有调用方）。 */
      const archivedCount = 0
      const translationRemoved = deps.compactTranslationRecords
        ? await deps.compactTranslationRecords(input.retentionMode)
        : 0

      return { archivedCount, hotRetentionDays, translationRemoved }
    }
  }
}

export type IntelligenceArchiveService = ReturnType<typeof createIntelligenceArchiveService>
