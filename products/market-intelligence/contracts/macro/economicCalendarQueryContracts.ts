export const MACRO_ECONOMIC_CALENDAR_IPC_METHODS = {
  queryMonth: 'intelligence.macro.economicCalendar.queryMonth',
  getEventDetail: 'intelligence.macro.economicCalendar.getEventDetail',
  previewManualBlsIcs: 'intelligence.macro.economicCalendar.previewManualBlsIcs',
  importManualBlsIcs: 'intelligence.macro.economicCalendar.importManualBlsIcs',
  getProviderPageState: 'intelligence.macro.economicCalendar.getProviderPageState',
  saveProviderProfile: 'intelligence.macro.economicCalendar.saveProviderProfile',
  testProviderConnection: 'intelligence.macro.economicCalendar.testProviderConnection',
  runProviderNow: 'intelligence.macro.economicCalendar.runProviderNow',
  getProviderHealth: 'intelligence.macro.economicCalendar.getProviderHealth',
  getProviderSchedule: 'intelligence.macro.economicCalendar.getProviderSchedule',
  refreshBlsEmploymentRelease: 'intelligence.macro.economicCalendar.refreshBlsEmploymentRelease',
  refreshFedFomcDecision: 'intelligence.macro.economicCalendar.refreshFedFomcDecision',
  syncBlsEmploymentSchedule: 'intelligence.macro.economicCalendar.syncBlsEmploymentSchedule',
  setReleaseTime: 'intelligence.macro.economicCalendar.setReleaseTime',
  clearReleaseTime: 'intelligence.macro.economicCalendar.clearReleaseTime'
} as const

export const MACRO_ECONOMIC_CALENDAR_JOB_HANDLER = 'market-intelligence.refreshMacroCalendar' as const

export type QueryMacroEconomicCalendarMonthInput = { month: `${number}-${string}`; asOf: string; maxEvents?: number }
export type GetMacroEconomicCalendarEventDetailInput = { eventKey: string; asOf: string }
/**
 * The reader's own release time. The instant is canonical UTC and the date is the day they chose:
 * the two must describe the same moment, and the store refuses the pair otherwise. The editor is
 * deliberately allowed to set either, so a release moved across a day is expressible.
 */
export type SetMacroEconomicCalendarReleaseTimeInput = { eventKey: string; scheduledAt: string; scheduledDate: string }
export type ClearMacroEconomicCalendarReleaseTimeInput = { eventKey: string }
export type MacroEconomicCalendarReleaseTimeResult =
  | { state: 'saved'; scheduledAt: string; scheduledDate: string }
  | { state: 'cleared' }
  | { state: 'rejected' }
export type ManualBlsIcsInput = { body: string; truncated: boolean }
export type RefreshBlsEmploymentReleaseInput = Readonly<{ eventKey: string; confirmed: true }>
export type RefreshBlsEmploymentReleaseResult = Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>
export type RefreshFedFomcDecisionInput = Readonly<{ eventKey: string; confirmed: true }>
export type RefreshFedFomcDecisionResult = Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>
export type SyncBlsEmploymentScheduleInput = Readonly<{ year: `${number}` }>
export type SyncBlsScheduleAndValuesResult =
  | Readonly<{
    state: 'completed'
    schedule: 'updated' | 'unchanged'
    values: Readonly<{
      cpi: 'updated' | 'current' | 'not-required' | 'unavailable'
      employment: 'updated' | 'current' | 'not-required' | 'unavailable'
    }>
  }>
  | Readonly<{ state: 'unavailable' }>

export const macroCalendarProviderSettingsPolicy = {
  providerIds: ['macro-calendar-fed', 'macro-calendar-bea'],
  scheduleHealthStates: ['never-run', 'healthy', 'degraded', 'failed'],
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
} as const

export type MacroCalendarSettingsProviderId = typeof macroCalendarProviderSettingsPolicy.providerIds[number]
export type MacroCalendarProviderPageState = {
  providerId: MacroCalendarSettingsProviderId
  enabled: boolean
  scheduleHealth: typeof macroCalendarProviderSettingsPolicy.scheduleHealthStates[number]
  lastCompletedAt?: string
  consecutiveFailures: number
}
export type MacroCalendarProviderPageResult =
  | { state: 'available'; providers: readonly MacroCalendarProviderPageState[] }
  | { state: 'unavailable'; failureCode: 'provider-settings-unavailable' }
export type SaveMacroCalendarProviderInput = { providerId: MacroCalendarSettingsProviderId; enabled: boolean }
export type MacroCalendarProviderActionResult =
  | { state: 'saved'; provider: MacroCalendarProviderPageState }
  | { state: 'queued'; providerId: MacroCalendarSettingsProviderId }
  | { state: 'completed'; providerId: MacroCalendarSettingsProviderId; outcome: 'succeeded' | 'failed' }
  | { state: 'skipped'; failureCode: 'provider-disabled' | 'provider-unavailable' }
  | { state: 'failed'; failureCode: 'provider-settings-unavailable' }

export type DashboardSourceConnectionFailureCode =
  | 'credential-not-configured'
  | 'transport-unavailable'
  | 'request-timeout'
  | 'response-unavailable'

export type DashboardSourceConnectionResult =
  | Readonly<{ state: 'succeeded' }>
  | Readonly<{ state: 'failed'; failureCode: DashboardSourceConnectionFailureCode }>

export type TestMacroCalendarProviderConnectionInput = {
  providerId: MacroCalendarSettingsProviderId
}

export type SafeMacroCalendarScheduleRule = Readonly<{
  mode: 'interval'
  intervalSeconds: number
  anchor: 'last-complete'
  startupCatchUp: true
  runNowAvailable: true
}>

export type MacroCalendarProviderScheduleResult =
  | Readonly<{ state: 'available'; providerId: MacroCalendarSettingsProviderId; schedule: SafeMacroCalendarScheduleRule }>
  | Readonly<{ state: 'unavailable'; failureCode: 'provider-settings-unavailable' }>

export type ManualBlsIcsPreview =
  | {
    state: 'ready'
    totalEvents: number
    supportedReleaseGroups: number
    generatedEvents: number
    unsupportedEvents: number
    insertedCount: number
    rescheduledCount: number
    unchangedCount: number
  }
  | { state: 'failed'; failureCode: 'invalid-file' | 'unsupported-calendar' | 'no-supported-events' | 'persistence-failed' }

export type ManualBlsIcsImportResult =
  | {
    state: 'imported'
    totalEvents: number
    supportedReleaseGroups: number
    generatedEvents: number
    unsupportedEvents: number
    insertedCount: number
    rescheduledCount: number
    unchangedCount: number
  }
  | {
    state: 'unchanged'
    totalEvents: number
    supportedReleaseGroups: number
    generatedEvents: number
    unsupportedEvents: number
    unchangedCount: number
  }
  | { state: 'failed'; failureCode: 'invalid-file' | 'unsupported-calendar' | 'no-supported-events' | 'persistence-failed' }

export type MacroEconomicCalendarValueView = {
  displayValue: string
  numericValue?: number
  numericLowerBound?: number
  numericUpperBound?: number
  unit?: string
}

/** FedFomcOfficialValueProjectionPolicy: safe revision status, never evidence identity. */
export const fedFomcOfficialValueProjectionPolicy = Object.freeze({ revisedCaveat: 'official-value-revised' } as const)

export const macroEconomicCalendarPublicEventFields = [
  'eventKey', 'releaseGroupKey', 'eventFamily', 'titleKey', 'countryCode', 'importance',
  'periodKey', 'lifecycleState', 'coverage', 'scheduledDate', 'scheduledAt', 'releaseTimeSource', 'conventionScheduledAt', 'officialReleaseDate', 'publishedAt',
  'detectedAt', 'actual', 'previous', 'consensus', 'consensusState', 'surprise', 'providerIds', 'caveats'
] as const

export type MacroEconomicCalendarEventView = {
  eventKey: string
  releaseGroupKey: string
  eventFamily: string
  titleKey: string
  countryCode: 'US'
  importance: 'high'
  periodKey: string
  lifecycleState: 'scheduled' | 'released' | 'cancelled'
  coverage: 'available' | 'partial' | 'unavailable'
  scheduledDate: string
  scheduledAt?: string
  /**
   * Which of the three sources supplied `scheduledAt`. `convention-default` is this product's own
   * expectation (the family's customary release time), never a time the source published — without
   * this field a convention would be indistinguishable from an official schedule.
   */
  releaseTimeSource: 'official' | 'convention-default' | 'user-edited' | 'date-only'
  /** Our expectation for this family's release instant, even when something else outranked it. */
  conventionScheduledAt?: string
  officialReleaseDate?: string
  publishedAt?: string
  detectedAt: string
  actual?: MacroEconomicCalendarValueView
  previous?: MacroEconomicCalendarValueView
  /**
   * Market consensus. Not hardcoded to null: the official calendar has no consensus
   * source, while the 0xRouter market calendar does provide one, and the expected
   * difference (actual against consensus) cannot be computed without it.
   */
  consensus: MacroEconomicCalendarValueView | null
  consensusState: 'available' | 'unavailable'
  /** Present only when both actual and consensus exist. */
  surprise: 'beat' | 'miss' | 'inline' | 'consensus-unavailable'
  providerIds: readonly string[]
  caveats: readonly string[]
}

export type MacroEconomicCalendarQueryResult<T> = {
  schemaVersion: number
  queryId: string
  asOf: string
  servedAt: string
  resultHash: string
  coverage: ReadonlyArray<{
    providerId: string
    schedule: 'available' | 'partial' | 'unavailable'
    actual: 'available' | 'partial' | 'unavailable'
    lastSuccessAt?: string
    caveats: readonly string[]
  }>
  caveats: readonly string[]
  data: T
}
