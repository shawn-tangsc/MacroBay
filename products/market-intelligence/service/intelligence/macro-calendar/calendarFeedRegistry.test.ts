import { describe, expect, it } from 'vitest'

import { calendarFeedCapabilities, calendarFeedRegistry, listCalendarFeeds } from './calendarFeedRegistry'

describe('calendar feed registry', () => {
  it('lists official, market, and pending calendar feeds in order', () => {
    expect(listCalendarFeeds().map((feed) => feed.feedId)).toEqual([
      'macro-calendar-fed',
      'macro-calendar-bea',
      'macro-calendar-bls',
      'macro-calendar-narwhal-economic-data',
      'macro-calendar-narwhal-financial-events',
      'macro-calendar-narwhal-central-bank-activities',
      /* 0xRouter 三路在 2026-11-15 起重新可配置（读者启用才注册定时任务），排在聚合源之后、待接入之前。 */
      'macro-calendar-0xrouter-economic-data',
      'macro-calendar-0xrouter-financial-events',
      'macro-calendar-0xrouter-central-bank-activities',
      'macro-calendar-coinmarketcal'
    ])
  })

  it('marks the official providers as provider-collected', () => {
    expect(calendarFeedRegistry['macro-calendar-fed']).toMatchObject({
      providerId: 'fed',
      owner: 'official',
      collection: 'provider'
    })
  })

  it('marks the Narwhal feeds as product-scheduled market calendar', () => {
    expect(calendarFeedRegistry['macro-calendar-narwhal-economic-data']).toMatchObject({
      providerId: 'narwhal',
      owner: 'market',
      collection: 'job'
    })
  })


  it('marks CoinMarketCal as pending and not collectable', () => {
    expect(calendarFeedRegistry['macro-calendar-coinmarketcal']).toMatchObject({
      owner: 'pending',
      collection: 'none'
    })
  })

  it('derives capabilities per owner', () => {
    expect(calendarFeedCapabilities('macro-calendar-bls')).toMatchObject({
      canToggle: true,
      runNow: 'provider',
      canTestConnection: true,
      canSyncBlsSchedule: true
    })
    expect(calendarFeedCapabilities('macro-calendar-narwhal-financial-events')).toMatchObject({
      canToggle: true,
      runNow: 'job',
      canTestConnection: true,
      canSyncBlsSchedule: false
    })
    expect(calendarFeedCapabilities('macro-calendar-coinmarketcal')).toMatchObject({
      canToggle: false,
      runNow: 'none',
      canTestConnection: false
    })
  })

  it('returns undefined for an unknown feed', () => {
    expect(calendarFeedCapabilities('unknown')).toBeUndefined()
  })
})
