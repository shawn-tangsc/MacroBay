import { describe, expect, it } from 'vitest'

import {
  createDefaultFocusMarketSettings,
  normalizeFocusMarketSettings
} from './intelligenceFocusSettings'
import {
  createInMemoryFocusSettingsStorage,
  createIntelligenceFocusSettingsStore
} from './intelligenceFocusSettingsStore'

describe('intelligenceFocusSettings', () => {
  it('defaults to global-macro and digital-assets', () => {
    const settings = createDefaultFocusMarketSettings()
    expect(settings.enabledFocusMarkets).toEqual(['global-macro', 'digital-assets'])
  })

  it('normalizes invalid focus market ids and keeps at least one default market', () => {
    const settings = normalizeFocusMarketSettings({
      enabledFocusMarkets: ['digital-assets', 'invalid-market' as never, 'global-macro']
    })
    expect(settings.enabledFocusMarkets).toEqual(['digital-assets', 'global-macro'])
  })

  it('persists focus settings independently', async () => {
    const store = createIntelligenceFocusSettingsStore(createInMemoryFocusSettingsStorage())
    const saved = await store.saveSettings({ enabledFocusMarkets: ['global-macro'] })
    expect(saved.enabledFocusMarkets).toEqual(['global-macro'])
    expect((await store.getSettings()).enabledFocusMarkets).toEqual(['global-macro'])
  })
})
