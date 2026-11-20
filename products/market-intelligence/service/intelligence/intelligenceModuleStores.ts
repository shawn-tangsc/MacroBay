import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { EventBusRuntime } from '@platform/message-bus'
import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import { createIntelligenceFetchText, executeIntelligenceFetchTarget } from './adapters/intelligenceHttpFetch'
import { createIntelligencePipeline } from './application/intelligencePipeline'
import { createSourceIssueWiring } from './application/sourceIssueWiring'
import { createIntelligenceEventPublisher } from './application/intelligenceEventPublisher'
import { createRawRecordStore } from './application/rawRecordStore'
import { createProfileJsonStorage, createSourceProfileStore } from './application/sourceProfileStore'
import { DEFAULT_SOURCE_FRESHNESS_MS } from './application/macroSourceHealth'
import {
  createIntelligenceCredentialJsonStorage,
  createIntelligenceCredentialStore
} from './store/intelligenceCredentialStore'
import {
  createIntelligencePipelineJsonStorage,
  readIntelligencePipelineSnapshotSync
} from './store/intelligencePipelineStateStorage'
import {
  createIntelligenceRuntimeStateJsonStorage,
  readIntelligenceRuntimeStateSync
} from './store/intelligenceRuntimeStateStorage'
import {
  createIntelligenceRuntimeStateHistoryJsonStorage,
  readIntelligenceRuntimeStateHistorySync
} from './store/intelligenceRuntimeStateHistoryStorage'
import { createIntelligenceTranslationJsonStorage } from './store/intelligenceTranslationStorage'
import { createMacroCalendarEvidenceArchive } from './macro-calendar/macroCalendarEvidenceArchive'
import { createRawRecordJsonStorage, readRawRecordSnapshotSync } from './store/rawRecordStorage'
import { resolvePayloadDirectory, writeVerifiedPayload } from './storage/contentAddressedPayloads'

/**
 * `intelligenceModule` 的本地存储与采集底座（拆分 M2，2026-11-15，**只搬不改**）。
 *
 * 这一段是「所有下游之前」：一份 profile / 原始记录 / 证据归档 / 运行态 / 翻译 / 凭据，
 * 加上取文通道与采集 pipeline。工厂只收显式入参、只返回下游真正要用的那些值——
 * 三个存储句柄（pipeline / 运行态 / 运行态历史）留在函数内，因为只有 pipeline 用它们。
 *
 * 与搬出来之前相比，**唯一差异是入参解构**：原先读闭包里的 `hooks?.x` 与模块级 `shellTimeZone`，
 * 现在由调用方传进来（`eventBusRuntime` / `submitNotification` / `log` / `timeZone`）。
 */
export function createIntelligenceStores(input: {
  dataDir: string
  getAppLanguage: () => Promise<'zh-CN' | 'en-US'>
  /** 读者时区：与装配根读同一个提供者（传 thunk，读的时候才取值）。 */
  timeZone: () => string
  eventBusRuntime?: EventBusRuntime
  submitNotification?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
}) {
  const { dataDir, getAppLanguage, timeZone, eventBusRuntime, submitNotification, log } = input
  const profileStore = createSourceProfileStore(
    createProfileJsonStorage(join(dataDir, 'intelligence-source-profiles.json'))
  )
  const rawRecordStorage = createRawRecordJsonStorage(join(dataDir, 'intelligence-raw-records.json'))
  /* 原文外置（用户 2026-11-20）：**生产必须接上**——「可选注入」只对测试有意义，
     不接就是静默回退到内联，JSON 照旧涨而没有任何报错。所以这里既注入，也把启用状态打一行盘点。 */
  const payloadDirectory = resolvePayloadDirectory('generic-intelligence', dataDir)
  /* 原语只写不建目录：目录不存在时写入会失败（`verify-failed`），整条记录随之不落库。
     所以在这里建一次，失败也要留痕——那是「外置没生效」的类型，不是默认。 */
  if (payloadDirectory !== undefined) {
    try { mkdirSync(payloadDirectory, { recursive: true }) } catch (error) {
      console.log(JSON.stringify({ marker: 'RAW_RECORD_PAYLOAD_DIRECTORY_FAILED',
        directory: payloadDirectory, message: error instanceof Error ? error.message : String(error) }))
    }
  }
  console.log(JSON.stringify({
    marker: 'RAW_RECORD_PAYLOAD_EXTERNALIZATION',
    enabled: payloadDirectory !== undefined,
    directory: payloadDirectory ?? null
  }))
  const rawRecordStore = createRawRecordStore({
    storage: rawRecordStorage,
    snapshot: readRawRecordSnapshotSync(join(dataDir, 'intelligence-raw-records.json')),
    ...(payloadDirectory === undefined ? {} : { payloadDirectory, writeVerifiedPayload })
  })
  const macroCalendarEvidenceArchive = createMacroCalendarEvidenceArchive({
    rawRecords: rawRecordStore,
    archiveDirectory: join(dataDir, 'macro-calendar-evidence')
  })
  const macroCalendarEvidenceMigration = macroCalendarEvidenceArchive.migrateInlineBodies()
  const pipelineStateStorage = createIntelligencePipelineJsonStorage(
    join(dataDir, 'intelligence-pipeline-state.json')
  )
  const runtimeStateStorage = createIntelligenceRuntimeStateJsonStorage(
    join(dataDir, 'intelligence-runtime-state.json')
  )
  const runtimeStateHistoryStorage = createIntelligenceRuntimeStateHistoryJsonStorage(
    join(dataDir, 'intelligence-runtime-state-history.json')
  )
  const translationStorage = createIntelligenceTranslationJsonStorage({
    settingsPath: join(dataDir, 'intelligence-translation-settings.json'),
    recordsPath: join(dataDir, 'intelligence-translation-records.json'),
    appLanguage: getAppLanguage
  })
  const credentialStore = createIntelligenceCredentialStore(
    createIntelligenceCredentialJsonStorage(join(dataDir, 'intelligence-credentials.json'))
  )
  const fetchText = createIntelligenceFetchText({ profileStore, credentialStore })
  const fetchMetricTarget = (target: Parameters<typeof executeIntelligenceFetchTarget>[0], sourceId: string) =>
    executeIntelligenceFetchTarget(target, sourceId, { profileStore, credentialStore })
  const eventPublisher = eventBusRuntime === undefined
    ? undefined
    : createIntelligenceEventPublisher(eventBusRuntime)
  const sourceIssues = createSourceIssueWiring({ defaultFreshnessMs: DEFAULT_SOURCE_FRESHNESS_MS, timeZone,
    ...(submitNotification === undefined ? {} : { submit: submitNotification }),
    ...(log === undefined ? {} : { log }) })
  const pipeline = createIntelligencePipeline({
    profileStore,
    rawRecordStore,
    fetchText,
    fetchMetricTarget,
    snapshot: readIntelligencePipelineSnapshotSync(join(dataDir, 'intelligence-pipeline-state.json')),
    stateStorage: pipelineStateStorage,
    runtimeStateSnapshot: readIntelligenceRuntimeStateSync(join(dataDir, 'intelligence-runtime-state.json')),
    runtimeStateStorage,
    runtimeStateHistorySnapshot: readIntelligenceRuntimeStateHistorySync(
      join(dataDir, 'intelligence-runtime-state-history.json')
    ),
    runtimeStateHistoryStorage,
    eventPublisher,
    ...(sourceIssues.notifier === undefined ? {} : { sourceIssueNotifier: sourceIssues.notifier })
  })
  sourceIssues.bindRuntimeStates(() => pipeline.listRuntimeStates())
  sourceIssues.bindRuntimeStates(() => pipeline.listRuntimeStates())
  return {
    profileStore,
    rawRecordStore,
    macroCalendarEvidenceArchive,
    macroCalendarEvidenceMigration,
    translationStorage,
    credentialStore,
    fetchText,
    pipeline
  }
}
