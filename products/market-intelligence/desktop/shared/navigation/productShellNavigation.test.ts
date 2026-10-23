// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { openIntelligenceSourcesSettings, openMacroCalendarSettings, openProxySettings } from './productShellNavigation'

describe('product shell navigation', () => {
  it('opens Macro Calendar settings with only the fixed shell destination', () => {
    const listener = vi.fn()
    window.addEventListener('app-shell:navigate', listener)

    openMacroCalendarSettings()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0].detail).toEqual({
      navKey: 'settings',
      settingsPanelKey: 'market-intelligence.intelligence-sources'
    })
    window.removeEventListener('app-shell:navigate', listener)
  })

  it('keeps the existing Intelligence Sources settings destination', () => {
    const listener = vi.fn()
    window.addEventListener('app-shell:navigate', listener)

    openIntelligenceSourcesSettings()

    expect(listener.mock.calls[0]?.[0].detail).toEqual({
      navKey: 'settings',
      settingsPanelKey: 'market-intelligence.intelligence-sources'
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
