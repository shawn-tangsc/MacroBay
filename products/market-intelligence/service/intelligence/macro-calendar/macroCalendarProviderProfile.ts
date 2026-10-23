import type { MacroCalendarProviderId } from './macroCalendarContracts'

export const macroCalendarProviderDefinitions = [
  { providerId: 'macro-calendar-fed', authMode: 'none' },
  { providerId: 'macro-calendar-bls', authMode: 'optional-api-key' },
  { providerId: 'macro-calendar-bea', authMode: 'none' }
] as const

export type MacroCalendarProviderProfile = {
  providerId: MacroCalendarProviderId
  enabled: boolean
  credentialRef?: string
  updatedAt: string
}

export function defaultMacroCalendarProviderProfile(providerId: MacroCalendarProviderId): MacroCalendarProviderProfile {
  return { providerId, enabled: false, updatedAt: new Date(0).toISOString() }
}
