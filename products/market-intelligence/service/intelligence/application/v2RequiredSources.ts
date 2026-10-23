export const V2_REQUIRED_LIVE_SOURCE_IDS = [
  'alternative-fear-greed',
  'binance-spot-market',
  'binance-futures-positioning',
  'binance-announcements',
  'coindesk-rss',
  'federal-reserve-rss',
  'sec-rss',
  'cftc-rss'
] as const

export type V2RequiredLiveSourceId = (typeof V2_REQUIRED_LIVE_SOURCE_IDS)[number]
