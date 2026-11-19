import { join } from 'node:path'

import { readJsonFileRecoveringSync } from '@platform/storage/jsonFileStorage'

import type { RawRecordStore } from '../application/rawRecordStore'
import type { DashboardSourceConnectionResult, MacroCalendarSettingsProviderId } from '../../../contracts/macro/economicCalendarQueryContracts'
import { createMacroCalendarCollectionService } from './macroCalendarCollectionService'
import { createMacroCalendarEvidenceStore } from './macroCalendarEvidenceStore'
import type { MacroCalendarHttpResult } from './macroCalendarHttpClient'
import { createMacroCalendarHttpClient } from './macroCalendarHttpClient'
import { createMacroCalendarProviderHealthJsonStorage, createMacroCalendarProviderHealthStore } from './macroCalendarProviderHealthStore'
import { createMacroCalendarProviderProfileJsonStorage, createMacroCalendarProviderProfileStore, type MacroCalendarProviderProfileStore } from './macroCalendarProviderProfileStore'
import { createMacroCalendarReleaseTimeOverrideCache, createMacroCalendarReleaseTimeOverrideJsonStorage, createMacroCalendarReleaseTimeOverrideStore } from './macroCalendarReleaseTimeOverrideStore'
import { createMacroCalendarRepository } from './macroCalendarRepository'
import { inspectCalendarValueRevisions } from './marketCalendarValueRevisionAudit'
import { auditStandardWriteRecords, calendarStandardWriterVisibility, createCalendarStandardWriteLayer,
  createJsonFileCalendarStandardWriteStorage, migrateLegacyWriteFailures, seedStandardWriteRecords }
  from './calendarStandardWriteLayer'
import { createMacroCalendarSqlite } from './macroCalendarSqlite'
import { createMacroCalendarScheduleCollectionWorkflow } from './macroCalendarScheduleCollectionWorkflow'
import { createMacroCalendarScheduleHealthService } from './macroCalendarScheduleHealthService'
import { createMacroCalendarSchedulePersistenceService } from './macroCalendarSchedulePersistenceService'
import { createManualBlsIcsImportService } from './bls-ics-manual/blsManualIcsImportService'
import { getMacroCalendarOfficialSourceDescriptor, type MacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'
import type { BlsPythonBridgeOperation, BlsPythonBridgeResult } from './bls-python/blsPythonRequestsBridge'
import { createBlsEmploymentScheduleSyncService } from './bls-python/blsEmploymentScheduleSyncService'
import { createMacroCalendarEvidenceArchive, type MacroCalendarEvidenceArchive } from './macroCalendarEvidenceArchive'
import { createFedFomcDecisionEvidence } from './fed-statements/fedFomcDecisionEvidence'
import { createFedFomcDecisionRefreshService } from './fed-statements/fedFomcDecisionRefreshService'
import { createFedFomcManualRefreshService } from './fed-statements/fedFomcManualRefreshService'
import { createBeaOfficialReleaseEvidence } from './bea-official-release/beaOfficialReleaseEvidence'
import { createBeaOfficialReleaseRefreshService } from './bea-official-release/beaOfficialReleaseRefreshService'

export function createMacroCalendarScheduleBackend(input: {
  dataDir: string
  rawRecords: RawRecordStore
  request?: (descriptor: MacroCalendarOfficialSourceDescriptor, runAt: string, signal?: AbortSignal) => Promise<MacroCalendarHttpResult>
  requestFomcStatement?: (officialStatementUrl: string, signal?: AbortSignal) => Promise<MacroCalendarHttpResult>
  testProviderConnection?: (providerId: unknown) => Promise<DashboardSourceConnectionResult>
  blsScheduleBridge?: Readonly<{ run: (operation: BlsPythonBridgeOperation) => Promise<BlsPythonBridgeResult> }>
  evidenceArchive?: MacroCalendarEvidenceArchive
  evidenceReady?: boolean
  /**
   * The switch store the collector reads. Bootstrap passes the unified store, so enabling a provider
   * in settings and collecting it read the same flag; without it the collector sees the legacy file
   * and reports `provider-disabled` while the settings panel says enabled.
   */
  profiles?: MacroCalendarProviderProfileStore
  /** 装配层注入的日志出口（进主进程 JSON 日志）。 */
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
}) {
  const profiles = input.profiles ?? createMacroCalendarProviderProfileStore(createMacroCalendarProviderProfileJsonStorage(join(input.dataDir, 'macro-calendar-provider-profiles.json')))
  const healthStore = createMacroCalendarProviderHealthStore(createMacroCalendarProviderHealthJsonStorage(join(input.dataDir, 'macro-calendar-provider-health.json')))
  /**
   * **写入层**（用户 2026-11-19 / 架构师裁决）：写库结果独立成层，与采集健康正交。
   * 成功也建记录——「行存在 ⇒ 一定有写入记录」这条自证守卫的前提。
   */
  const writeLayer = createCalendarStandardWriteLayer(
    createJsonFileCalendarStandardWriteStorage(join(input.dataDir, 'macro-calendar-standard-write.json')))
  /**
   * **第 3 步：把上一版文件里的写失败搬进写入层**（用户 2026-11-19）：旧文件把失败记在
   * 健康 revision 上，现在写入层才是唯一存处；幂等（已有失败记录就不搬），搬完不回写 revision。
   */
  // 健康记录只覆盖采集类 provider（fed/bls/bea/0xrouter）；narwhal、replay 从来不在那份文件里。
  // **直接读旧文件的原始键**：字段已从类型上删除（第 4 步），迁移要读的是上一版磁盘格式，
  // 不能依赖一个已经不存在的类型字段。
  const healthWriterIds = ['macro-calendar-fed', 'macro-calendar-bls', 'macro-calendar-bea', '0xrouter'] as const
  const legacySnapshot = readJsonFileRecoveringSync(
    join(input.dataDir, 'macro-calendar-provider-health.json')) as
    { currentByProviderId?: Record<string, { lastWriteFailure?: { at?: string; failedRows?: number
      firstErrorCode?: 'standard-write-failed' | 'value-shape-rejected' } }> } | undefined
  migrateLegacyWriteFailures({
    writeLayer,
    legacy: healthWriterIds.flatMap((writerId) => {
      const failure = legacySnapshot?.currentByProviderId?.[writerId]?.lastWriteFailure
      if (failure?.at === undefined || failure.failedRows === undefined || failure.firstErrorCode === undefined) return []
      return [{ writerId: String(writerId), at: failure.at, failedRows: failure.failedRows,
        firstErrorCode: failure.firstErrorCode }]
    })
  })
  // The reader's own release times: durable in their own file, and mirrored into the synchronous
  // view a calendar query reads (see `macroCalendarReleaseTimeOverrideStore`).
  const releaseTimeOverrideStore = createMacroCalendarReleaseTimeOverrideStore(
    createMacroCalendarReleaseTimeOverrideJsonStorage(join(input.dataDir, 'macro-calendar-release-time-overrides.json')))
  const releaseTimeOverrides = createMacroCalendarReleaseTimeOverrideCache(releaseTimeOverrideStore)
  const evidenceArchive = input.evidenceArchive ?? createMacroCalendarEvidenceArchive({
    rawRecords: input.rawRecords,
    archiveDirectory: join(input.dataDir, 'macro-calendar-evidence')
  })
  const availableEvidence = createMacroCalendarEvidenceStore(evidenceArchive)
  const evidence = input.evidenceReady === false
    ? { ...availableEvidence, reserve: () => undefined }
    : availableEvidence
  const storage = createMacroCalendarSqlite(join(input.dataDir, 'macro-calendar.sqlite'))
  try {
    const repository = createMacroCalendarRepository({ storage })
    const httpClient = createMacroCalendarHttpClient()
    const beaOfficialReleaseRefresh = input.evidenceReady === false ? undefined : createBeaOfficialReleaseRefreshService({
      repository,
      http: { requestRss: httpClient.requestBeaOfficialReleaseRss, requestPage: httpClient.requestBeaOfficialReleasePage },
      evidence: createBeaOfficialReleaseEvidence({ archive: evidenceArchive })
    })
    const fedFomcDecisionRefresh = input.evidenceReady === false
      ? undefined
      : createFedFomcDecisionRefreshService({
        http: {
          request: async (descriptorId, signal) => {
            const descriptor = getMacroCalendarOfficialSourceDescriptor(descriptorId)
            return descriptor ? (input.request ?? httpClient.request)(descriptor, new Date().toISOString(), signal) : unavailableHttp(descriptorId)
          },
          requestFomcStatement: (officialStatementUrl, signal) => (input.requestFomcStatement ?? httpClient.requestFomcStatement)(officialStatementUrl, signal)
        },
        evidence: createFedFomcDecisionEvidence({ archive: evidenceArchive }),
        repository,
        facts: repository.policyFacts
      })
    const collection = createMacroCalendarCollectionService({ profiles, http: { request: input.request ?? createMacroCalendarHttpClient().request }, evidence })
    const persistence = createMacroCalendarSchedulePersistenceService({ evidence, repository, policyFacts: repository })
    const scheduleWorkflow = createMacroCalendarScheduleCollectionWorkflow({ collection, persistence })
    const workflow = {
      async collectAndPersistSchedule(run: Parameters<typeof scheduleWorkflow.collectAndPersistSchedule>[0]) {
        const result = await scheduleWorkflow.collectAndPersistSchedule(run)
        if (result.state === 'persisted' && result.descriptorId === 'macro-calendar-fed-schedule' && fedFomcDecisionRefresh) {
          try { await fedFomcDecisionRefresh.refresh({ detectedAt: run.detectedAt, runId: run.runId }, run.signal) } catch { /* Schedule health is independent of optional FOMC value refresh. */ }
        }
        return result
      }
    }
    /**
     * **第 5 步：启动补种 + 写入记录守卫**（用户 2026-11-19）。
     * 只读事件表拿「每个写入方的行数与最近写入时刻」，**不改事件表任何一行**；
     * 缺记录才补，已有记录（bls 那条真实记录）不覆盖。
     */
    try {
      const writerRows = storage.database.prepare(`select source_provider_id as writerId,
          count(*) as rowCount, max(observed_at) as lastSuccessAt
        from mi_calendar_events group by source_provider_id`).all() as Array<
        { writerId: string; rowCount: number; lastSuccessAt: string | null }>
      const seeded = seedStandardWriteRecords({ writeLayer, rows: writerRows })
      const audit = auditStandardWriteRecords({ writeLayer, rows: writerRows })
      if (seeded > 0 || audit.unknownWriterIds.length > 0 || audit.missingRecords.length > 0) {
        input.log?.('warn', 'macro-calendar.standard-write-records', {
          seeded, unknownWriterIds: audit.unknownWriterIds, missingRecords: audit.missingRecords
        })
      }
      /**
       * **盘点第 7 项**（用户 2026-11-20）：值修订表随每次改值增长，必须可见——
       * 条数 + 最近一条 `observed_at`。否则半年后没人知道它多大、什么时候开始不写。
       */
      const revisions = inspectCalendarValueRevisions(storage.database)
      input.log?.('info', 'macro-calendar.value-revisions-inventory',
        { rows: revisions.rows, latestObservedAt: revisions.latestObservedAt })
    } catch { /* 补种不影响启动：读不到就下次再来，日志由上层采集失败体现。 */ }
    const health = createMacroCalendarScheduleHealthService({ workflow, health: healthStore,
      ...(input.log === undefined ? {} : { log: input.log }) })
    const manualBlsIcs = createManualBlsIcsImportService({ evidence, repository, now: () => new Date().toISOString() })
    const fedFomcRefresh = fedFomcDecisionRefresh
      ? createFedFomcManualRefreshService({ repository, refresh: fedFomcDecisionRefresh, now: () => new Date().toISOString() })
      : undefined
    const blsEmploymentSchedule = input.blsScheduleBridge && input.evidenceReady !== false
      ? createBlsEmploymentScheduleSyncService({ bridge: input.blsScheduleBridge, repository, now: () => new Date().toISOString() })
      : undefined
    const testProvider = input.testProviderConnection ?? createMacroCalendarHttpClient().testProviderConnection
    async function testProviderConnection(providerId: unknown): Promise<DashboardSourceConnectionResult> {
      if (!isConnectionProviderId(providerId)) return responseUnavailable()
      return safeConnection(() => testProvider(providerId))
    }
    let disposed = false
    return { profiles, healthStore, writeLayer, repository, storage, rawRecords: input.rawRecords, health, manualBlsIcs, fedFomcRefresh, beaOfficialReleaseRefresh, blsEmploymentSchedule, releaseTimeOverrideStore, releaseTimeOverrides, testProviderConnection, dispose: () => { if (disposed) return; disposed = true; storage.close() } }
  } catch (error) {
    storage.close()
    throw error
  }
}

function unavailableHttp(descriptorId: string): MacroCalendarHttpResult {
  return { ok: false, descriptorId, failureCode: 'descriptor-not-allowed' }
}

function isConnectionProviderId(value: unknown): value is MacroCalendarSettingsProviderId {
  return value === 'macro-calendar-fed' || value === 'macro-calendar-bea'
}
async function safeConnection(action: () => Promise<DashboardSourceConnectionResult>): Promise<DashboardSourceConnectionResult> {
  try {
    const value = await action()
    if (isExactConnection(value, ['state']) && value.state === 'succeeded') return { state: 'succeeded' }
    if (isExactConnection(value, ['state', 'failureCode']) && value.state === 'failed' && isConnectionFailure(value.failureCode)) return { state: 'failed', failureCode: value.failureCode }
  } catch {}
  return responseUnavailable()
}
function isExactConnection(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && fields.every((field) => Object.hasOwn(value, field)) && Object.getOwnPropertySymbols(value).length === 0 && names.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return Boolean(descriptor && 'value' in descriptor)
    })
  } catch { return false }
}
function isConnectionFailure(value: unknown): value is Extract<DashboardSourceConnectionResult, { state: 'failed' }>['failureCode'] {
  return value === 'credential-not-configured' || value === 'transport-unavailable' || value === 'request-timeout' || value === 'response-unavailable'
}
function responseUnavailable(): DashboardSourceConnectionResult { return { state: 'failed', failureCode: 'response-unavailable' } }
