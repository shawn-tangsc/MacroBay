import type { MacroCalendarProviderId } from './macroCalendarContracts'

export const macroCalendarProviderDefinitions = [
  { providerId: 'macro-calendar-fed', authMode: 'none' },
  { providerId: 'macro-calendar-bls', authMode: 'optional-api-key' },
  { providerId: 'macro-calendar-bea', authMode: 'none' }
] as const

export type MacroCalendarProviderProfile = {
  providerId: MacroCalendarProviderId
  enabled: boolean
  /**
   * **最后一次写 `enabled` 的是谁**（不是「谁打开的」——读者也可能是关它的一方）。
   *
   * 自动启用只在 `decidedBy !== 'reader'` 时才写；读者自己的开关因此不会被下次启动翻回去。
   */
  decidedBy?: 'auto' | 'reader'
  credentialRef?: string
  updatedAt: string
}

export function defaultMacroCalendarProviderProfile(providerId: MacroCalendarProviderId): MacroCalendarProviderProfile {
  return { providerId, enabled: false, decidedBy: 'auto', updatedAt: new Date(0).toISOString() }
}
