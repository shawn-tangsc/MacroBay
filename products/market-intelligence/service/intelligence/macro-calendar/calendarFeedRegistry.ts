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
  supportsBlsScheduleSync?: boolean
  schedule?: Readonly<{ kind: 'provider' | 'job'; intervalSeconds: number }>
  /**
   * 这条 feed 的采集由哪一条 feed 的作业覆盖。
   *
   * Narwhal 一次接口调用返回全部 releases，三类是我们按 series 自己分的，所以只有一条作业。
   * 覆盖关系落注册表，状态渲染只读它；被覆盖的那条**不加开关**（那层 UI 今天不存在），
   * 只在状态列写「由同一次采集覆盖」。
   */
  coveredBy?: CalendarFeedId
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
  'macro-calendar-narwhal-economic-data',
  'macro-calendar-narwhal-financial-events',
  'macro-calendar-narwhal-central-bank-activities',
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
    supportsBlsScheduleSync: true,
    schedule: { kind: 'provider', intervalSeconds: 6 * 60 * 60 }
  },
  /* Narwhal 三条：**采集器已落**——作业挂在第一条（30 分钟一次），另两条由它一次写三类
     （`coveredBy` 指向第一条）。所以这三条是 `collection: 'job'`，不是「登记了但不采」；
     旧注释写的 `collection: 'none'` 已与数据相反，2026-11-13 更正。
     不写 `job` 是因为它还没有采集器与解析器：写成 `job` 会让「立即采集」成为一个点了没反应、
     或者按旧源实现去采的入口。等采集器落地的那一笔，把 `collection`/`schedule` 与
     `AUTOMATIC_CALENDAR_FEED_IDS`、`zeroXRouterFeedKeys`、日历卡那三行一起改，才是真换源。 */
  'macro-calendar-narwhal-economic-data': {
    feedId: 'macro-calendar-narwhal-economic-data',
    providerId: 'narwhal',
    providerDisplayName: 'Narwhal',
    displayName: 'Narwhal economic data',
    description: 'Market-sourced economic calendar; events stay unverified until an official link exists.',
    owner: 'market',
    collection: 'job',
    dashboardSection: 'macro-calendar',
    /** 一次采集写三类，作业挂在这一条上。 */
    schedule: { kind: 'job', intervalSeconds: 30 * 60 }
  },
  'macro-calendar-narwhal-financial-events': {
    feedId: 'macro-calendar-narwhal-financial-events',
    providerId: 'narwhal',
    providerDisplayName: 'Narwhal',
    displayName: 'Narwhal Financial Events',
    description: 'Market-sourced financial events; events stay unverified until an official link exists.',
    owner: 'market',
    collection: 'job',
    coveredBy: 'macro-calendar-narwhal-economic-data',
    dashboardSection: 'macro-calendar'
  },
  'macro-calendar-narwhal-central-bank-activities': {
    feedId: 'macro-calendar-narwhal-central-bank-activities',
    providerId: 'narwhal',
    providerDisplayName: 'Narwhal',
    displayName: 'Narwhal Central Bank Activities',
    description: 'Market-sourced central bank activities; events stay unverified until an official link exists.',
    owner: 'market',
    collection: 'job',
    coveredBy: 'macro-calendar-narwhal-economic-data',
    dashboardSection: 'macro-calendar'
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
  }
}

/**
 * **真正在采的那些 feed id**（`collection !== 'none'`）：`refreshNow` 的返回里列的就是它们。
 * 一个出处——白名单曾经另写一份（旧源那三条），结果日报传新源 id 被直接判 `input-invalid`。
 */
export function collectingCalendarFeedIds(): readonly string[] {
  return Object.values(calendarFeedRegistry).filter((feed) => feed.collection !== 'none').map((feed) => feed.feedId)
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
