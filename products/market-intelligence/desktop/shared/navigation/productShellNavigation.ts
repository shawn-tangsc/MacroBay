/** Built-in shell settings sections this product navigates to; the proxy section lives in `preferences`. */
export const PLATFORM_SETTINGS_PANELS = {
  preferences: 'preferences',
  models: 'models',
  webSearch: 'web-search'
} as const

export type AppShellNavigateDetail = {
  navKey?: string
  settingsPanelKey?: string
  /** 「请产品的设置抽屉打开某一屏」：产品页按自己的 `productId` 过滤消费（架构师 2026-11-11 签）。 */
  settingsDrawer?: { productId: string; menuId: string }
}

export function navigateAppShell(detail: AppShellNavigateDetail): void {
  window.dispatchEvent(new CustomEvent('app-shell:navigate', { detail }))
}

/**
 * 产品的配置入口：**开自己的配置抽屉**（用户 2026-11-11：平台设置里不再显示产品配置）。
 * 平台设置里那一页已经撤掉，这里若还指过去，壳层会回落别的面板——点了落到不相关的地方。
 */
export function openIntelligenceSourcesSettings(): void {
  navigateAppShell({
    settingsDrawer: { productId: 'market-intelligence', menuId: 'sources' }
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
