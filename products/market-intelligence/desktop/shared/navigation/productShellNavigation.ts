export const MARKET_INTELLIGENCE_SETTINGS_PANELS = {
  intelligenceSources: 'market-intelligence.intelligence-sources',
  macroCalendar: 'market-intelligence.intelligence-sources'
} as const

/** Built-in shell settings sections this product navigates to; the proxy section lives in `preferences`. */
export const PLATFORM_SETTINGS_PANELS = {
  preferences: 'preferences',
  models: 'models',
  webSearch: 'web-search'
} as const

export type AppShellNavigateDetail = {
  navKey?: string
  settingsPanelKey?: string
}

export function navigateAppShell(detail: AppShellNavigateDetail): void {
  window.dispatchEvent(new CustomEvent('app-shell:navigate', { detail }))
}

export function openIntelligenceSourcesSettings(): void {
  navigateAppShell({
    navKey: 'settings',
    settingsPanelKey: MARKET_INTELLIGENCE_SETTINGS_PANELS.intelligenceSources
  })
}

export function openMacroCalendarSettings(): void {
  navigateAppShell({
    navKey: 'settings',
    settingsPanelKey: MARKET_INTELLIGENCE_SETTINGS_PANELS.macroCalendar
  })
}

/** Opens the built-in model service page (providers and default models). */
export function openWebSearchSettings(): void {
  navigateAppShell({ navKey: 'settings', settingsPanelKey: PLATFORM_SETTINGS_PANELS.webSearch })
}

export function openModelSettings(): void {
  navigateAppShell({ navKey: 'settings', settingsPanelKey: PLATFORM_SETTINGS_PANELS.models })
}

/** Opens the built-in Basic Settings page that owns proxy mode, proxy address and proxy self-test. */
export function openProxySettings(): void {
  navigateAppShell({
    navKey: 'settings',
    settingsPanelKey: PLATFORM_SETTINGS_PANELS.preferences
  })
}
