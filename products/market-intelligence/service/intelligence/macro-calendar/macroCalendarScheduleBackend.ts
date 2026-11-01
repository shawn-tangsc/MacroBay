import { join } from 'node:path'

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
}) {
  const profiles = input.profiles ?? createMacroCalendarProviderProfileStore(createMacroCalendarProviderProfileJsonStorage(join(input.dataDir, 'macro-calendar-provider-profiles.json')))
  const healthStore = createMacroCalendarProviderHealthStore(createMacroCalendarProviderHealthJsonStorage(join(input.dataDir, 'macro-calendar-provider-health.json')))
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
    const health = createMacroCalendarScheduleHealthService({ workflow, health: healthStore })
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
    return { profiles, healthStore, repository, storage, rawRecords: input.rawRecords, health, manualBlsIcs, fedFomcRefresh, beaOfficialReleaseRefresh, blsEmploymentSchedule, releaseTimeOverrideStore, releaseTimeOverrides, testProviderConnection, dispose: () => { if (disposed) return; disposed = true; storage.close() } }
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
