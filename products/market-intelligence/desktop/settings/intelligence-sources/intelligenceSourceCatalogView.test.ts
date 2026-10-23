import { describe, expect, it } from 'vitest'

import { buildSourceEnabledById } from './intelligenceSourceCatalogView'

describe('intelligence source catalog view model', () => {
  it('defaults sources without a saved profile to disabled', () => {
    expect(buildSourceEnabledById(['binance-announcements', 'coindesk-rss'], [])).toEqual({
      'binance-announcements': false,
      'coindesk-rss': false
    })
  })

  it('uses saved profiles for visible source enabled state', () => {
    expect(
      buildSourceEnabledById(
        ['binance-announcements', 'coindesk-rss', 'sec-rss'],
        [
          { sourceId: 'coindesk-rss', enabled: true },
          { sourceId: 'hidden-source', enabled: true }
        ]
      )
    ).toEqual({
      'binance-announcements': false,
      'coindesk-rss': true,
      'sec-rss': false
    })
  })

  it('lets the current draft profile override the saved profile immediately', () => {
    expect(
      buildSourceEnabledById(
        ['binance-announcements'],
        [{ sourceId: 'binance-announcements', enabled: false }],
        { sourceId: 'binance-announcements', enabled: true }
      )
    ).toEqual({
      'binance-announcements': true
    })
  })
})
