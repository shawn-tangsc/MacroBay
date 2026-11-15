import { join } from 'node:path'

import type { JobRuntime } from '@platform/jobs'

import { intelligenceRawRecordStartupRecoveryPolicy } from './intelligenceModuleContracts'
import { disableMaintenanceOnlyKeylessSources, migrateKeylessSourceDefaults } from './application/keylessSourceDefaultsMigration'
import { claimExistingBriefingSessions } from './daily-briefing/dailyBriefEditorSessionPort'
import type { createDailyBriefSessionLinkStore } from './daily-briefing/dailyBriefSessionLinks'
import type { createIntelligenceSourcesService } from './application/intelligenceSourcesService'
import type { MarketAnalysisRuntime } from './jobs/registerMarketAnalysisRuntime'
import type { SourceProfileStore } from './application/sourceProfileStore'
import type { IntelligenceModulePlatformHooks } from './intelligenceModuleContracts'

/**
 * `intelligenceModule` 的默认源迁移与启动链（拆分 M6，2026-11-15，**只搬不改**）。
 *
 * 这一段是**顺序契约**，不是普通装配：默认源迁移（一开）→ 维护备用关回去（顺序不能反）→
 * 历史日报会话身份归位 → 原始记录补跑 → `sourcesService.initializeRuntime()` →
 * `marketAnalysisRuntime.startRecovery()`。原文件里三段是**并联的 `.finally`**
 * （补跑、运行时恢复互不阻塞），写成 `await` 串行会让补跑超时（30s）挡采集。
 * 所以这里逐字保留 `.then().finally().finally().then()` 链和末尾那个 `void startupReady`。
 *
 * 两处吞错也逐字保留：① 默认源迁移 `.catch(() => undefined)`；② 会话归位失败只 `log.warn` 不抛。
 *
 * 与搬出来之前相比，**唯一差异是入参解构**：`dailyBriefSessionLinks` 的构造在日报那段（M7a 之后
 * 一起归位），这里收的是**惰性读**——它只在 `.then()` 回调里取值，那时链接存储已经建好。
 */
export function createIntelligenceStartup(input: {
  jobRuntime: JobRuntime
  dataDir: string
  profileStore: SourceProfileStore
  sourcesService: ReturnType<typeof createIntelligenceSourcesService>
  marketAnalysisRuntime: MarketAnalysisRuntime
  /** 惰性读：会话链接存储的构造在日报那一段，晚于本段执行。 */
  briefingSessionLinks: () => ReturnType<typeof createDailyBriefSessionLinkStore>
  hooks: IntelligenceModulePlatformHooks
}) {
  const { jobRuntime, dataDir, profileStore, sourcesService, marketAnalysisRuntime, briefingSessionLinks, hooks } = input
  // The dashboard's first screen (sentiment, fear & greed, stablecoin capital) is fed by sources
  // that need no credential; a fresh install should not require toggling them on before the cards
  // can do anything. An existing profile wins, so a reader's "off" is never overridden.
  // 一次性迁移：老安装里「免钥匙 + live」的源曾被旧默认写成关，这里打开一次（标记写在
  // `intelligence-source-migration-markers.json`，之后读者再关就是关）。口径见
  // `isDefaultEnabledDefinition`：免钥匙 + 已就绪即默认启用，维护备用（还没用上）的除外。
  const migrationMarkers = join(dataDir, 'intelligence-source-migration-markers.json')
  const ensureDefaultSources = migrateKeylessSourceDefaults({ markerPath: migrationMarkers, store: profileStore })
    // 第二条：把维护备用那批关回去（第一条先把它们一起打开了，顺序不能反）。
    .then(() => disableMaintenanceOnlyKeylessSources({ markerPath: migrationMarkers, store: profileStore }))
    .catch(() => undefined)
  // 历史日报编辑会话的身份归位：只改身份字段（消息与内容不动），幂等，失败不阻断启动但要留痕。
  const earlierBriefingSessionMigration = ensureDefaultSources
    .then(() => claimExistingBriefingSessions({
      links: briefingSessionLinks(),
      agentId: 'daily-brief-editor',
      ...(hooks.findAgentSessionByAutomationRef ? { findAgentSessionByAutomationRef: hooks.findAgentSessionByAutomationRef } : {}),
      ...(hooks.updateAgentSession ? { updateAgentSession: hooks.updateAgentSession } : {})
    }))
    .then((result) => {
      if (result.updated > 0) hooks.log?.('info', 'daily-brief-session-migration', { updated: result.updated, skipped: result.skipped })
    })
    .catch((error: unknown) => {
      hooks.log?.('warn', 'daily-brief-session-migration-failed', { message: error instanceof Error ? error.message : String(error) })
    })
  const startupReady = earlierBriefingSessionMigration
    .then(() => intelligenceRawRecordStartupRecoveryPolicy.completeBeforeSourceRuntime(jobRuntime))
    .finally(() => sourcesService.initializeRuntime().catch(() => undefined))
    .finally(() => marketAnalysisRuntime.startRecovery().catch(() => undefined))
    .then(() => undefined, () => undefined)
  void startupReady
  return { startupReady }
}
