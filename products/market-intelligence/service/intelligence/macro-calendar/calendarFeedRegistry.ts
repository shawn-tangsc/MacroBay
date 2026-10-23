export type CalendarFeedOwner = 'official' | 'market' | 'pending'
export type CalendarFeedCollection = 'provider' | 'job' | 'none'

export type CalendarFeedDefinition = {
  feedId: string
  providerId: string
  providerDisplayName: string
  displayName: string
  description: string
  owner: CalendarFeedOwner
  collection: CalendarFeedCollection
  dashboardSection: 'macro-calendar'
  supportsCredentialTest: boolean
  supportsBlsScheduleSync?: boolean
  schedule?: Readonly<{ kind: 'provider' | 'job'; intervalSeconds: number }>
}

export type CalendarFeedCapabilities = {
  canToggle: boolean
  runNow: 'provider' | 'job' | 'none'
  canTestConnection: boolean
  canSyncBlsSchedule: boolean
}

const calendarFeedOrder = [
  'macro-calendar-fed',
  'macro-calendar-bea',
  'macro-calendar-bls',
  'macro-calendar-0xrouter-economic-data',
  'macro-calendar-0xrouter-financial-events',
  'macro-calendar-0xrouter-central-bank-activities',
  'macro-calendar-coinmarketcal'
] as const

export type CalendarFeedId = (typeof calendarFeedOrder)[number]

export const calendarFeedRegistry: Readonly<Record<CalendarFeedId, CalendarFeedDefinition>> = {
  'macro-calendar-fed': {
    feedId: 'macro-calendar-fed',
    providerId: 'fed',
    providerDisplayName: 'Federal Reserve Board (Fed)',
    displayName: 'Federal Reserve Board (Fed)',
    description: 'Official Federal Reserve Board schedule.',
    owner: 'official',
    collection: 'provider',
    dashboardSection: 'macro-calendar',
    supportsCredentialTest: false,
    schedule: { kind: 'provider', intervalSeconds: 6 * 60 * 60 }
  },
  'macro-calendar-bea': {
    feedId: 'macro-calendar-bea',
    providerId: 'bea',
    providerDisplayName: 'Bureau of Economic Analysis (BEA)',
    displayName: 'BEA Official Releases',
    description: 'Official BEA release schedule.',
    owner: 'official',
    collection: 'provider',
    dashboardSection: 'macro-calendar',
    supportsCredentialTest: false,
    schedule: { kind: 'provider', intervalSeconds: 6 * 60 * 60 }
  },
  'macro-calendar-bls': {
    feedId: 'macro-calendar-bls',
    providerId: 'bls',
    providerDisplayName: 'Bureau of Labor Statistics (BLS)',
    displayName: 'BLS Official Schedule',
    description: 'Official BLS release schedule.',
    owner: 'official',
    collection: 'provider',
    dashboardSection: 'macro-calendar',
    supportsCredentialTest: false,
    supportsBlsScheduleSync: true,
    schedule: { kind: 'provider', intervalSeconds: 6 * 60 * 60 }
  },
  'macro-calendar-0xrouter-economic-data': {
    feedId: 'macro-calendar-0xrouter-economic-data',
    providerId: '0xrouter',
    providerDisplayName: '0xRouter',
    displayName: '0xRouter Economic Data',
    description: 'Market-sourced economic calendar; events stay unverified until an official link exists.',
    owner: 'market',
    collection: 'job',
    dashboardSection: 'macro-calendar',
    supportsCredentialTest: true,
    schedule: { kind: 'job', intervalSeconds: 10 * 60 }
  },
  'macro-calendar-0xrouter-financial-events': {
    feedId: 'macro-calendar-0xrouter-financial-events',
    providerId: '0xrouter',
    providerDisplayName: '0xRouter',
    displayName: '0xRouter Financial Events',
    description: 'Market-sourced financial events; events stay unverified until an official link exists.',
    owner: 'market',
    collection: 'job',
    dashboardSection: 'macro-calendar',
    supportsCredentialTest: true,
    schedule: { kind: 'job', intervalSeconds: 10 * 60 }
  },
  'macro-calendar-0xrouter-central-bank-activities': {
    feedId: 'macro-calendar-0xrouter-central-bank-activities',
    providerId: '0xrouter',
    providerDisplayName: '0xRouter',
    displayName: '0xRouter Central Bank Activities',
    description: 'Market-sourced central bank activities; events stay unverified until an official link exists.',
    owner: 'market',
    collection: 'job',
    dashboardSection: 'macro-calendar',
    supportsCredentialTest: true,
    schedule: { kind: 'job', intervalSeconds: 10 * 60 }
  },
  'macro-calendar-coinmarketcal': {
    feedId: 'macro-calendar-coinmarketcal',
    providerId: 'coinmarketcal',
    providerDisplayName: 'CoinMarketCal',
    displayName: 'CoinMarketCal Events',
    description: 'Planned event calendar; not connected yet.',
    owner: 'pending',
    collection: 'none',
    dashboardSection: 'macro-calendar',
    supportsCredentialTest: false
  }
}

export function listCalendarFeeds(): readonly CalendarFeedDefinition[] {
  return calendarFeedOrder.map((feedId) => calendarFeedRegistry[feedId])
}

export function calendarFeedCapabilities(feedId: string): CalendarFeedCapabilities | undefined {
  if (!(feedId in calendarFeedRegistry)) return undefined
  const feed = calendarFeedRegistry[feedId as CalendarFeedId]
  return {
    canToggle: feed.owner !== 'pending',
    runNow: feed.collection === 'provider' ? 'provider' : feed.collection === 'job' ? 'job' : 'none',
    canTestConnection: feed.owner !== 'pending',
    canSyncBlsSchedule: feed.supportsBlsScheduleSync === true
  }
}
