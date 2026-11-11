import type { ProductCacheRegistrar } from '@platform/storage/cache-governance/productCacheRegistrar'

import { translationRecordsBytes } from '../intelligence/application/intelligenceTranslationCache'
import type { IntelligenceTranslationService } from '../intelligence/application/intelligenceTranslationService'

/**
 * 「翻译记录」这份派生缓存的注册：inspect / clear / compact 三件事都跟着缓存走，装配根只留一行调用。
 *
 * 这是组合根按域拆的第一段——**只是搬家，不改行为**：缓存 id、中英文案、警告句、`dryRun` 的语义
 * （预览不算一次删除）、compact 的 `removedBytes` 取两次测量的差（不是整份记录集的大小）全部逐字保留。
 * 判据在 `bootstrap.test.ts` 与翻译套件里。
 */
export function registerTranslationRecordsCache(input: Readonly<{
  registerProductCache: ProductCacheRegistrar
  translation: IntelligenceTranslationService
}>): void {
  const { registerProductCache, translation } = input
  registerProductCache('market-intelligence', {
    cacheId: 'market-intelligence.translation-records',
    displayName: 'Translation records',
    displayNameI18n: {
      'zh-CN': '翻译记录',
      'en-US': 'Translation records'
    },
    description: 'Derived translation records for localized intelligence display text.',
    descriptionI18n: {
      'zh-CN': '用于情报展示本地化文本的派生翻译记录。',
      'en-US': 'Derived translation records for localized intelligence display text.'
    },
    category: 'derived-data',
    cacheKind: 'json-file',
    durability: 'persisted-derived',
    sensitivity: 'contains-user-content',
    clearable: true,
    compactable: true,
    backupPolicy: 'exclude',
    warnings: ['This cache only stores derived translations. Raw source records and intelligence evidence are not cleared here.'],
    warningsI18n: [
      {
        'zh-CN': '这里只保存派生翻译结果，不会清理原始来源记录或情报证据。',
        'en-US': 'This cache only stores derived translations. Raw source records and intelligence evidence are not cleared here.'
      }
    ],
    provider: {
      inspect: async () => {
        const records = await translation.listRecords()
        const latestTranslatedAt = records
          .map((record) => (record.translatedAt ? Date.parse(record.translatedAt) : Number.NaN))
          .filter((value) => Number.isFinite(value))
          .sort((left, right) => right - left)[0]
        return {
          cacheId: 'market-intelligence.translation-records',
          status: records.length > 0 ? 'ready' : 'empty',
          recordCount: records.length,
          sizeBytes: translationRecordsBytes(records),
          lastUpdatedAt: Number.isFinite(latestTranslatedAt) ? new Date(latestTranslatedAt).toISOString() : undefined,
          rebuildable: true,
          message: 'Translation display records can be regenerated from product-owned source items.'
        }
      },
      clear: async ({ dryRun }) => {
        const records = await translation.listRecords()
        // A clear removes every record, so the volume before the call is exactly what it removed.
        const removedBytes = translationRecordsBytes(records)
        if (dryRun === true) {
          return {
            cacheId: 'market-intelligence.translation-records',
            operation: 'clear',
            dryRun: true,
            status: records.length > 0 ? 'skipped' : 'succeeded',
            removedBytes,
            removedRecords: records.length,
            message: records.length > 0 ? 'Dry run only. Translation records would be cleared.' : 'Cache is already empty.'
          }
        }
        await translation.replaceRecords([])
        return {
          cacheId: 'market-intelligence.translation-records',
          operation: 'clear',
          dryRun: false,
          status: 'succeeded',
          removedBytes,
          removedRecords: records.length,
          message: records.length > 0 ? 'Translation records cache cleared.' : 'Translation records cache was already empty.'
        }
      },
      compact: async ({ dryRun }) => {
        // A compaction keeps most of the file, so its `removedBytes` is the difference between the
        // measurements, not the size of the whole record set. The old code reported the latter: it
        // said 131 KB for a run that dropped 20 records out of hundreds.
        const records = await translation.listRecords()
        const bytesBefore = translationRecordsBytes(records)
        if (dryRun === true) {
          const plan = await translation.previewCompaction({ retentionMode: 'balanced' })
          // A dry run changes nothing; it reports what the same compaction would free, and the audit
          // record carries `dryRun`, so a preview is never counted as a removal that happened.
          const removableBytes = Math.max(0, bytesBefore - translationRecordsBytes(plan.next))
          return {
            cacheId: 'market-intelligence.translation-records',
            operation: 'compact',
            dryRun: true,
            status: plan.removedCount > 0 ? 'skipped' : 'succeeded',
            removedRecords: plan.removedCount,
            removedBytes: removableBytes,
            message:
              plan.removedCount > 0
                ? 'Dry run only. Translation records would be compacted.'
                : 'No stale translation records need compaction.'
          }
        }
        const result = await translation.compactDerivedRecords({ retentionMode: 'balanced' })
        const bytesAfter = translationRecordsBytes(await translation.listRecords())
        return {
          cacheId: 'market-intelligence.translation-records',
          operation: 'compact',
          dryRun: false,
          status: 'succeeded',
          removedRecords: result.removedCount,
          removedBytes: Math.max(0, bytesBefore - bytesAfter),
          message:
            result.removedCount > 0 ? 'Translation records compaction finished.' : 'No stale translation records needed compaction.'
        }
      }
    }
  })
}
