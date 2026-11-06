import { describe, expect, it } from 'vitest'

import type { NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import { drawerSourceOptions, drawerTranslateMenuItem } from './newsSentimentDrawerModel'

const view = {
  state: 'available',
  asOf: '2026-10-24T13:00:00.000Z',
  generatedAt: '2026-10-24T13:00:00.000Z',
  window: '7d',
  availableSources: [
    { sourceId: 'coindesk-rss', sourceName: 'CoinDesk' },
    { sourceId: 'federal-reserve-rss', sourceName: 'Federal Reserve' }
  ],
  items: [
    { itemId: 'a', sourceId: 'coindesk-rss', sourceName: 'CoinDesk', bodyTranslationState: 'translated' },
    // A source that left the registry but still has rows in this window: its rows must stay reachable.
    { itemId: 'b', sourceId: 'retired-feed', sourceName: 'Retired feed', bodyTranslationState: 'missing' }
  ],
  caveats: []
} as unknown as NewsSentimentView

describe('drawerSourceOptions', () => {
  it('offers every configured source, then the ones only the rows know about', () => {
    expect(drawerSourceOptions(view, 'All sources')).toEqual([
      { value: 'all', label: 'All sources' },
      { value: 'coindesk-rss', label: 'CoinDesk' },
      { value: 'federal-reserve-rss', label: 'Federal Reserve' },
      { value: 'retired-feed', label: 'Retired feed' }
    ])
  })

  it('does not repeat a source that is both configured and present in the rows', () => {
    const options = drawerSourceOptions(view, 'All sources')
    expect(options.filter((option) => option.value === 'coindesk-rss')).toHaveLength(1)
  })

  it('offers only "all" when there is no view yet', () => {
    expect(drawerSourceOptions(undefined, 'All sources')).toEqual([{ value: 'all', label: 'All sources' }])
  })
})

describe('drawerTranslateMenuItem', () => {
  const rows = [
    { itemId: 'a', bodyTranslationState: 'translated' },
    { itemId: 'b', bodyTranslationState: 'missing' }
  ] as const

  it('says "translate" when no row is under the menu', () => {
    expect(drawerTranslateMenuItem({ contextMenuItemId: undefined, translationStates: {}, rows }))
      .toEqual([{ key: 'translate', labelKey: 'news.sentiment.translate' }])
  })

  it('says "retranslate" for a row that already has a translation', () => {
    expect(drawerTranslateMenuItem({ contextMenuItemId: 'a', translationStates: {}, rows }))
      .toEqual([{ key: 'translate', labelKey: 'news.sentiment.retranslate' }])
    expect(drawerTranslateMenuItem({ contextMenuItemId: 'b', translationStates: {}, rows }))
      .toEqual([{ key: 'translate', labelKey: 'news.sentiment.translate' }])
  })

  it('lets the queue state win over what the record says', () => {
    expect(drawerTranslateMenuItem({ contextMenuItemId: 'b', translationStates: { b: 'translated' }, rows }))
      .toEqual([{ key: 'translate', labelKey: 'news.sentiment.retranslate' }])
  })
})
