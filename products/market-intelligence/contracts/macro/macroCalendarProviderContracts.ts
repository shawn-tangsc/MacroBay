export type MacroCalendarProviderId = 'macro-calendar-fed' | 'macro-calendar-bls' | 'macro-calendar-bea'
export type SafeMacroCalendarProviderView = {
  providerId: MacroCalendarProviderId
  displayNameKey: string
  enabled: boolean
  authMode: 'none' | 'optional-api-key' | 'api-key'
  credentialStatus?: { hasCredential: boolean; maskedPreview?: string; lastValidatedAt?: string }
  health: { status: 'healthy' | 'degraded' | 'failed' | 'paused'; lastSuccessAt?: string; lastFailureAt?: string; consecutiveFailures: number; safeSummary?: string }
}
