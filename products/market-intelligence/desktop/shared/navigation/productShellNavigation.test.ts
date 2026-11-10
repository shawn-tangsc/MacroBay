// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { openIntelligenceSourcesSettings, openProxySettings } from './productShellNavigation'

describe('product shell navigation', () => {
  it('opens the product drawer instead of a platform settings panel', () => {
    const listener = vi.fn()
    window.addEventListener('app-shell:navigate', listener)

    openIntelligenceSourcesSettings()

    // 平台设置里那一页已撤；指过去只会被壳层回落成别的面板（假跳转）。
    expect(listener.mock.calls[0]?.[0].detail).toEqual({
      settingsDrawer: { productId: 'market-intelligence', menuId: 'sources' }
    })
    window.removeEventListener('app-shell:navigate', listener)
  })

  it('opens the built-in Basic Settings page that owns the proxy section', () => {
    const listener = vi.fn()
    window.addEventListener('app-shell:navigate', listener)

    openProxySettings()

    expect(listener.mock.calls[0]?.[0].detail).toEqual({
      navKey: 'settings',
      settingsPanelKey: 'preferences'
    })
    window.removeEventListener('app-shell:navigate', listener)
  })
})
