/** The product has one settings home: calendar feeds, providers and collection policy all live in
 *  Intelligence Sources, so a calendar request and a sources request are the same destination. */
export const MARKET_INTELLIGENCE_SETTINGS_PANELS = {
  intelligenceSources: 'market-intelligence.intelligence-sources'
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

/** Opens the shell's channel settings (where the reader turns a channel on). */
export function openChannelSettings(): void {
  navigateAppShell({ navKey: 'settings', settingsPanelKey: 'channels' })
}

/** Opens the built-in model service page (providers and default models). */
export function openWebSearchSettings(): void {
  navigateAppShell({ navKey: 'settings', settingsPanelKey: PLATFORM_SETTINGS_PANELS.webSearch })
}

export function openModelSettings(): void {
  navigateAppShell({ navKey: 'settings', settingsPanelKey: PLATFORM_SETTINGS_PANELS.models })
}

/**
 * 平台「基本设置」页：时区、语言、显示风格、代理模式与自检都在这页。
 * 抽屉里四行指向同一页，所以入口按页面命名，不按代理命名。
 */
export function openPreferencesSettings(): void {
  navigateAppShell({
    navKey: 'settings',
    settingsPanelKey: PLATFORM_SETTINGS_PANELS.preferences
  })
}

/** 代理那一行用的就是同一页；保留这个名字给既有调用点。 */
export function openProxySettings(): void {
  openPreferencesSettings()
}
