import type { AgentModelRuntimeProbeService } from '../../desktop/main/agentModelCompatibility/AgentModelRuntimeProbeService'
import type { AgentRuntimeProbeSnapshotStore } from '../../desktop/main/agentModelCompatibility/AgentRuntimeProbeSnapshotStore'
import { CacheRegistry } from './CacheRegistry'

export type PlatformCacheProviderDeps = {
  registry: CacheRegistry
  agentModelRuntimeProbeService: AgentModelRuntimeProbeService
  agentRuntimeProbeSnapshotStore: AgentRuntimeProbeSnapshotStore
}

export function registerPlatformCacheProviders({
  registry,
  agentModelRuntimeProbeService,
  agentRuntimeProbeSnapshotStore
}: PlatformCacheProviderDeps): void {
  registry.register({
    cacheId: 'platform.agent-runtime-compatibility',
    ownerType: 'platform',
    ownerId: 'platform',
    displayName: 'Agent runtime compatibility',
    displayNameI18n: {
      'zh-CN': 'Agent 运行时兼容性',
      'en-US': 'Agent runtime compatibility'
    },
    description:
      'Cached runtime probe reports and persisted compatibility snapshots for provider/model/runtime checks.',
    descriptionI18n: {
      'zh-CN': '缓存运行时探测报告与持久化兼容性快照，用于 provider / model / runtime 检查。',
      'en-US': 'Cached runtime probe reports and persisted compatibility snapshots for provider/model/runtime checks.'
    },
    category: 'ai-runtime',
    cacheKind: 'json-file',
    durability: 'rebuildable',
    sensitivity: 'none',
    clearable: true,
    compactable: false,
    backupPolicy: 'exclude',
    warnings: [
      'Clearing forces compatibility probes to be recomputed on the next runtime check.',
      'Active runtime handles are not exposed here and are not manually clearable in V1.'
    ],
    warningsI18n: [
      {
        'zh-CN': '清理后，下次运行时检查会重新计算兼容性探测结果。',
        'en-US': 'Clearing forces compatibility probes to be recomputed on the next runtime check.'
      },
      {
        'zh-CN': '活跃运行时句柄不会暴露在这里，V1 也不支持手动清理。',
        'en-US': 'Active runtime handles are not exposed here and are not manually clearable in V1.'
      }
    ],
    provider: {
      inspect: async () => {
        const reports = await agentRuntimeProbeSnapshotStore.listReports()
        const latestUpdatedAt = reports
          .map((report) => Date.parse(report.updatedAt))
          .filter((value) => Number.isFinite(value))
          .sort((left, right) => right - left)[0]

        return {
          cacheId: 'platform.agent-runtime-compatibility',
          status: reports.length > 0 ? 'ready' : 'empty',
          recordCount: reports.length,
          sizeBytes: Buffer.byteLength(JSON.stringify(reports), 'utf8'),
          lastUpdatedAt: Number.isFinite(latestUpdatedAt) ? new Date(latestUpdatedAt).toISOString() : undefined,
          rebuildable: true,
          message:
            reports.length > 0
              ? 'Compatibility reports are cached and can be rebuilt on demand.'
              : 'No persisted compatibility reports are stored.'
        }
      },
      clear: async ({ dryRun }) => {
        const reports = await agentRuntimeProbeSnapshotStore.listReports()
        const removedBytes = Buffer.byteLength(JSON.stringify(reports), 'utf8')
        if (dryRun === true) {
          return {
            cacheId: 'platform.agent-runtime-compatibility',
            operation: 'clear',
            dryRun: true,
            status: reports.length > 0 ? 'skipped' : 'succeeded',
            removedBytes,
            removedRecords: reports.length,
            message:
              reports.length > 0
                ? 'Dry run only. Compatibility cache would be cleared.'
                : 'Compatibility cache is already empty.'
          }
        }

        agentModelRuntimeProbeService.invalidateAll()
        await agentRuntimeProbeSnapshotStore.clear()
        return {
          cacheId: 'platform.agent-runtime-compatibility',
          operation: 'clear',
          dryRun: false,
          status: 'succeeded',
          removedBytes,
          removedRecords: reports.length,
          message:
            reports.length > 0
              ? 'Compatibility cache cleared.'
              : 'Compatibility cache was already empty.'
        }
      }
    }
  })
}
