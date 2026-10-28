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
import type { CrossAssetLeaseState } from '../cross-asset/crossAssetLeaseStore'

export type MacroCalendarReleaseTimeValue = Readonly<{
  scheduledAt: string
  scheduledDate: string
}>

/** Everything the calendar revision is computed from. */
export type MacroCalendarConfigurationState = {
  providers: Readonly<Record<string, boolean>>
  releaseTimes: Readonly<Record<string, MacroCalendarReleaseTimeValue>>
}

/**
 * Product-internal facades over the runtimes that only exist while the service
 * is composed (design 152 §4). The agent capability layer never imports a
 * bootstrap-local object: it receives one of these, so the same service calls the
 * IPC surface makes are the only ones a tool can make.
 *
 * The writes are the shared `macroCalendarWriteActions` functions, so the agent
 * surface keeps the IPC result semantics (including `rejected` and `failed`)
 * instead of throwing a generic handler error. The three reads below are what the
 * audit captures before and after a change, and what the calendar revision hashes.
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
  /** The provider enable map and every edited release time, for the domain revision. */
  readConfiguration(): Promise<MacroCalendarConfigurationState>
  /** One provider's enabled flag, or null when the provider stores no profile. */
  readProviderState(providerId: MacroCalendarSettingsProviderId): Promise<boolean | null>
  /** The reader's current override for one event, or null when they never edited it. */
  readReleaseTime(eventKey: string): Promise<MacroCalendarReleaseTimeValue | null>
}

/**
 * The cross-asset runtime surface `registerCrossAssetIpc` receives. Results stay
 * structural because the runtime widens its own literal states; the IPC parser,
 * not this type, is the authority on which states may leave the product.
 */
export type CrossAssetCommand = Readonly<Record<string, unknown>>

/** The interface configuration the cross-asset revision is computed from. */
export type CrossAssetConfiguration =
  | Readonly<{ state: 'configured' | 'default'; enabled: boolean }>
  | Readonly<{ state: 'unknown' }>

export type CrossAssetOps = {
  acquire: () => Promise<CrossAssetCommand>
  renew: (leaseId: string) => Promise<CrossAssetCommand>
  release: (leaseId: string) => Promise<CrossAssetCommand>
  refresh: (leaseId: string) => Promise<CrossAssetCommand>
  testInterface: () => Promise<CrossAssetCommand>
  cancelInterfaceTest: () => Promise<CrossAssetCommand>
  readConfiguration: () => Promise<CrossAssetConfiguration>
  /** The channel's lease state, without a lease id or an expiry timestamp. */
  readLeaseState: () => Promise<CrossAssetLeaseState | 'unknown'>
}
