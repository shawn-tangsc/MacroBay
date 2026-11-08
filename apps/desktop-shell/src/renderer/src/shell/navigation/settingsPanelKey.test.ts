import { describe, expect, it } from 'vitest'

import { resolveAvailableSettingsPanelKey, resolveSettingsPanelKeyFromHash } from './settingsPanelKey'

const entries = [
  { id: 'sample-product.exchange-connections' },
  { id: 'sample-product.market-data-sources' },
  { id: 'sample-product.panel-c' }
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
    expect(resolveSettingsPanelKeyFromHash('panel-c', entries)).toBe('sample-product.panel-c')
  })

  it('leaves an ambiguous slug unresolved instead of guessing a product', () => {
    const ambiguous = [
      { id: 'sample-product.sources' },
      { id: 'other-product.sources' }
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
