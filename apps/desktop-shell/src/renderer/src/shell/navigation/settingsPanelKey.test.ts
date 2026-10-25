import { describe, expect, it } from 'vitest'

import { resolveAvailableSettingsPanelKey, resolveSettingsPanelKeyFromHash } from './settingsPanelKey'

const entries = [
  { id: 'sample-product.exchange-connections' },
  { id: 'sample-product.market-data-sources' },
  { id: 'market-intelligence.intelligence-sources' }
]

describe('resolveSettingsPanelKeyFromHash', () => {
  it('keeps built-in settings panel ids unchanged', () => {
    expect(resolveSettingsPanelKeyFromHash('models', entries)).toBe('models')
  })

  it('keeps a product-qualified id unchanged', () => {
    expect(resolveSettingsPanelKeyFromHash('sample-product.exchange-connections', entries)).toBe(
      'sample-product.exchange-connections'
    )
  })

  it('resolves a unique product-local slug to the registered id', () => {
    expect(resolveSettingsPanelKeyFromHash('exchange-connections', entries)).toBe(
      'sample-product.exchange-connections'
    )
    expect(resolveSettingsPanelKeyFromHash('intelligence-sources', entries)).toBe(
      'market-intelligence.intelligence-sources'
    )
  })

  it('leaves an ambiguous slug unresolved instead of guessing a product', () => {
    const ambiguous = [
      { id: 'sample-product.sources' },
      { id: 'market-intelligence.sources' }
    ]
    expect(resolveSettingsPanelKeyFromHash('sources', ambiguous)).toBe('sources')
  })

  it('returns unknown and empty slugs unchanged', () => {
    expect(resolveSettingsPanelKeyFromHash('unknown-panel', entries)).toBe('unknown-panel')
    expect(resolveSettingsPanelKeyFromHash('  ', entries)).toBe('')
  })
})

describe('resolveAvailableSettingsPanelKey', () => {
  it('keeps a registered built-in or product panel', () => {
    expect(resolveAvailableSettingsPanelKey('models', entries)).toBe('models')
    expect(resolveAvailableSettingsPanelKey('sample-product.exchange-connections', entries)).toBe(
      'sample-product.exchange-connections'
    )
  })

  it('falls back to the default panel instead of rendering a blank pane', () => {
    expect(resolveAvailableSettingsPanelKey('unknown-panel', entries)).toBe('models')
  })
})
