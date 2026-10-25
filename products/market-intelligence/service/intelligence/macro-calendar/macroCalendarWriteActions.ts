import type {
  DashboardSourceConnectionResult,
  MacroCalendarProviderActionResult,
  MacroEconomicCalendarReleaseTimeResult,
  ManualBlsIcsImportResult,
  ManualBlsIcsPreview,
  RefreshBlsEmploymentReleaseResult,
  RefreshFedFomcDecisionResult,
  SyncBlsScheduleAndValuesResult
} from '../../../contracts/macro/economicCalendarQueryContracts'
import type { BlsEmploymentMvpRefreshService } from './bls-employment-refresh/blsEmploymentMvpRefreshService'
import type { BlsScheduleAndValuesSyncWorkflow } from './bls-schedule-catch-up/blsScheduleAndLatestValuesSyncWorkflow'
import type { ManualBlsIcsImportService } from './bls-ics-manual/blsManualIcsImportService'
import type { FedFomcManualRefreshService } from './fed-statements/fedFomcManualRefreshService'
import type { MacroCalendarProviderSettingsService } from './macroCalendarProviderSettingsService'
import type {
  MacroCalendarReleaseTimeOverrideCache,
  MacroCalendarReleaseTimeOverrideStore
} from './macroCalendarReleaseTimeOverrideStore'
import {
  dashboardConnectionUnavailable,
  isClearReleaseTimeInput,
  isProviderInput,
  isReleaseTimeInput,
  isSaveProviderInput,
  providerUnavailableAction,
  safeBlsEmploymentRefresh,
  safeBlsEmploymentSchedule,
  safeDashboardConnection,
  safeFedFomcRefresh,
  safeManualImport,
  safeManualPreview,
  safeProviderAction
} from './macroCalendarResultGuards'

export type MacroCalendarWriteConnection = {
  testProviderConnection?: (providerId: unknown) => unknown
  /** The reader's own release times: the durable store, and the synchronous view queries read. */
  releaseTimeOverrides?: MacroCalendarReleaseTimeOverrideCache
  releaseTimeOverrideStore?: MacroCalendarReleaseTimeOverrideStore
}

export type MacroCalendarWriteDependencies = {
  manualBlsIcs: ManualBlsIcsImportService
  providerSettings?: MacroCalendarProviderSettingsService
  connection?: MacroCalendarWriteConnection
  blsEmploymentRefresh?: BlsEmploymentMvpRefreshService
  blsEmploymentSchedule?: BlsScheduleAndValuesSyncWorkflow
  fedFomcRefresh?: FedFomcManualRefreshService
}

/**
 * The one implementation of every calendar write.
 *
 * `registerMacroEconomicCalendarIpc` and the agent facade both call this factory,
 * so the two surfaces cannot drift on validation, cache application, or on what a
 * domain rejection looks like. A rejected release-time pair and a failed provider
 * action keep their result shapes; neither is converted into an exception.
 */
export type MacroCalendarWriteActions = {
  saveProviderProfile(payload: unknown): Promise<MacroCalendarProviderActionResult>
  runProviderNow(payload: unknown): Promise<MacroCalendarProviderActionResult>
  testProviderConnection(payload: unknown): Promise<DashboardSourceConnectionResult>
  setReleaseTime(payload: unknown): Promise<MacroEconomicCalendarReleaseTimeResult>
  clearReleaseTime(payload: unknown): Promise<MacroEconomicCalendarReleaseTimeResult>
  refreshBlsEmployment(payload: unknown): Promise<RefreshBlsEmploymentReleaseResult>
  refreshFedFomc(payload: unknown): Promise<RefreshFedFomcDecisionResult>
  syncBlsSchedule(payload: unknown): Promise<SyncBlsScheduleAndValuesResult>
  previewManualIcs(payload: unknown): Promise<ManualBlsIcsPreview>
  importManualIcs(payload: unknown): Promise<ManualBlsIcsImportResult>
}

export function createMacroCalendarWriteActions(
  deps: MacroCalendarWriteDependencies
): MacroCalendarWriteActions {
  return {
    async saveProviderProfile(payload) {
      if (!deps.providerSettings || !isSaveProviderInput(payload)) return providerUnavailableAction()
      return safeProviderAction(() => deps.providerSettings!.saveProfile(payload), payload.providerId)
    },
    async runProviderNow(payload) {
      if (!deps.providerSettings || !isProviderInput(payload)) return providerUnavailableAction()
      return safeProviderAction(() => deps.providerSettings!.runProviderNow(payload.providerId), payload.providerId)
    },
    async testProviderConnection(payload) {
      if (!isProviderInput(payload) || !deps.connection?.testProviderConnection) return dashboardConnectionUnavailable()
      return safeDashboardConnection(() => deps.connection!.testProviderConnection!(payload.providerId))
    },
    async setReleaseTime(payload) {
      const store = deps.connection?.releaseTimeOverrideStore
      const cache = deps.connection?.releaseTimeOverrides
      if (!store || !isReleaseTimeInput(payload)) return { state: 'rejected' }
      try {
        const saved = await store.set({ ...payload, updatedAt: new Date().toISOString() })
        if (!saved) return { state: 'rejected' }
        // The synchronous calendar view reads the cache, not the store; an edit that skipped
        // `apply` would be durable and invisible until the next process start.
        cache?.apply(saved)
        return { state: 'saved', scheduledAt: saved.scheduledAt, scheduledDate: saved.scheduledDate }
      } catch {
        return { state: 'rejected' }
      }
    },
    async clearReleaseTime(payload) {
      const store = deps.connection?.releaseTimeOverrideStore
      if (!store || !isClearReleaseTimeInput(payload)) return { state: 'rejected' }
      try {
        const cleared = await store.clear(payload.eventKey)
        if (cleared) deps.connection?.releaseTimeOverrides?.remove(payload.eventKey)
        // Clearing an event nobody edited is not an error: the row simply keeps showing what it showed.
        return { state: 'cleared' }
      } catch {
        return { state: 'rejected' }
      }
    },
    refreshBlsEmployment: (payload) => safeBlsEmploymentRefresh(deps.blsEmploymentRefresh, payload),
    refreshFedFomc: (payload) => safeFedFomcRefresh(deps.fedFomcRefresh, payload),
    syncBlsSchedule: (payload) => safeBlsEmploymentSchedule(deps.blsEmploymentSchedule, payload),
    async previewManualIcs(payload) {
      return safeManualPreview(() => deps.manualBlsIcs.preview(payload))
    },
    async importManualIcs(payload) {
      return safeManualImport(() => deps.manualBlsIcs.import(payload))
    }
  }
}
