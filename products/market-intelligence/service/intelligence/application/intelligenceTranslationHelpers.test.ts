import { describe, expect, it } from 'vitest'

import type { TranslateIntelligenceItemsJobInput } from '../schema/intelligenceTranslation'
import { shouldTranslateForReason, splitTranslationBatchBySource } from './intelligenceTranslationHelpers'

describe('shouldTranslateForReason', () => {
  it('runs automatic work only when auto translation is on', () => {
    for (const reason of ['new-item', 'settings-change', 'replay'] as const) {
      expect(shouldTranslateForReason({ autoTranslateEnabled: false }, reason)).toBe(false)
      expect(shouldTranslateForReason({ autoTranslateEnabled: true }, reason)).toBe(true)
    }
  })

  it('always allows a reader-initiated translation or retry', () => {
    for (const reason of ['manual-selection', 'retry-failed'] as const) {
      expect(shouldTranslateForReason({ autoTranslateEnabled: false }, reason)).toBe(true)
    }
  })
})

describe('splitTranslationBatchBySource', () => {
  const items = [
    { itemId: 'a1', sourceId: 'coindesk-rss' },
    { itemId: 'a2', sourceId: 'coindesk-rss' },
    { itemId: 'b1', sourceId: 'federal-reserve-rss' }
  ]

  it('gives each source its own batch, so the definition id can name the source', () => {
    const batches = splitTranslationBatchBySource(
      { itemIds: ['a1', 'b1', 'a2'], reason: 'new-item' },
      items
    )
    expect(batches).toEqual([
      { itemIds: ['a1', 'a2'], reason: 'new-item', sourceId: 'coindesk-rss' },
      { itemIds: ['b1'], reason: 'new-item', sourceId: 'federal-reserve-rss' }
    ])
  })

  it('keeps one batch when every item belongs to the same source', () => {
    const batches = splitTranslationBatchBySource({ itemIds: ['a1', 'a2'], reason: 'new-item' }, items)
    expect(batches).toEqual([{ itemIds: ['a1', 'a2'], reason: 'new-item', sourceId: 'coindesk-rss' }])
  })

  it('keeps an item the catalogue no longer knows in a batch without a source, never dropping it', () => {
    const batches = splitTranslationBatchBySource({ itemIds: ['gone', 'b1'], reason: 'manual-selection' }, items)
    expect(batches).toEqual([
      { itemIds: ['b1'], reason: 'manual-selection', sourceId: 'federal-reserve-rss' },
      { itemIds: ['gone'], reason: 'manual-selection' }
    ])
  })

  it('leaves a filter-only batch alone: its candidates are chosen at run time, not now', () => {
    const input: TranslateIntelligenceItemsJobInput = {
      reason: 'settings-change',
      filters: { sourceIds: ['coindesk-rss'] }
    }
    expect(splitTranslationBatchBySource(input, items)).toEqual([input])
  })
})
