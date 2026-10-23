import type {
  DashboardSourceConnectionResult,
  MacroCalendarProviderActionResult,
  MacroCalendarSettingsProviderId,
  MacroEconomicCalendarReleaseTimeResult,
  ManualBlsIcsImportResult,
  ManualBlsIcsPreview,
  RefreshBlsEmploymentReleaseResult,
  RefreshFedFomcDecisionResult,
  SyncBlsScheduleAndValuesResult
} from '../../../contracts/macro/economicCalendarQueryContracts'

/**
 * Product-internal facades over the runtimes that only exist while the service
 * is composed (design 152 §4). The agent capability layer never imports a
 * bootstrap-local object: it receives one of these, so the same service calls the
 * IPC surface makes are the only ones a tool can make.
 *
 * `confirmed` is part of the two refresh signatures on purpose: it is a typed
 * literal that only the product handler can supply. It never appears in a tool
 * schema, and the facade forwards it unchanged to the refresh service.
 */
export type MacroCalendarOps = {
  saveProviderProfile(input: {
    providerId: MacroCalendarSettingsProviderId
    enabled: boolean
  }): Promise<MacroCalendarProviderActionResult>
  runProviderNow(providerId: MacroCalendarSettingsProviderId): Promise<MacroCalendarProviderActionResult>
  testProviderConnection(
    providerId: MacroCalendarSettingsProviderId
  ): Promise<DashboardSourceConnectionResult>
  setReleaseTime(input: {
    eventKey: string
    scheduledAt: string
    scheduledDate: string
  }): Promise<MacroEconomicCalendarReleaseTimeResult>
  clearReleaseTime(eventKey: string): Promise<MacroEconomicCalendarReleaseTimeResult>
  refreshBlsEmployment(input: {
    eventKey: string
    confirmed: true
  }): Promise<RefreshBlsEmploymentReleaseResult>
  refreshFedFomc(input: {
    eventKey: string
    confirmed: true
  }): Promise<RefreshFedFomcDecisionResult>
  syncBlsSchedule(input: { year: string }): Promise<SyncBlsScheduleAndValuesResult>
  previewManualIcs(input: { body: string; truncated?: boolean }): Promise<ManualBlsIcsPreview>
  importManualIcs(input: { body: string; truncated?: boolean }): Promise<ManualBlsIcsImportResult>
}

/**
 * The cross-asset runtime surface `registerCrossAssetIpc` receives. Results stay
 * structural because the runtime widens its own literal states; the IPC parser,
 * not this type, is the authority on which states may leave the product.
 */
export type CrossAssetCommand = Readonly<Record<string, unknown>>

export type CrossAssetOps = {
  acquire: () => Promise<CrossAssetCommand>
  renew: (leaseId: string) => Promise<CrossAssetCommand>
  release: (leaseId: string) => Promise<CrossAssetCommand>
  refresh: (leaseId: string) => Promise<CrossAssetCommand>
  testInterface: () => Promise<CrossAssetCommand>
  cancelInterfaceTest: () => Promise<CrossAssetCommand>
}
