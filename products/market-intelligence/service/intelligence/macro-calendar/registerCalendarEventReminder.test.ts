import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_CALENDAR_REMINDER_SETTINGS } from '../../../contracts/calendarEventReminder'
import type { MarketCalendarEvent, MarketCalendarPage } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { CalendarEventReminderDeps } from './calendarEventReminderJob'
import { landedFilterReader, registerCalendarEventReminder } from './registerCalendarEventReminder'

/** 捕获作业拿到的依赖，用来证明「测试样例与真实提醒读的是同一个函数」。 */
const captured = vi.hoisted(() => ({ deps: undefined as CalendarEventReminderDeps | undefined }))

vi.mock('./calendarEventReminderJob', () => ({
  registerCalendarEventReminderJob: (_runtime: unknown, deps: CalendarEventReminderDeps) => {
    captured.deps = deps
    return { runOnce: async () => ({ submitted: [], skipped: {} }), applySchedule: () => undefined }
  }
}))

const NOW = '2026-11-08T00:00:00.000Z'

function marketEvent(patch: Partial<MarketCalendarEvent> = {}): MarketCalendarEvent {
  return {
    eventKey: 'hmac-of-the-batch',
    observationKey: 'stable-observation',
    title: '非农就业人数',
    countryCode: 'US',
    eventType: 'economic-indicator',
    importance: 'high',
    scheduledAt: '2026-11-06T13:30:00.000Z',
    consensus: null,
    providerPrevious: null,
    providerActual: null,
    source: '0xRouter',
    sourceObservedAt: '2026-11-06T13:31:00.000Z',
    coverage: 'observed-unverified',
    ...patch
  }
}

function page(month: string, events: readonly MarketCalendarEvent[]): MarketCalendarPage {
  return { state: 'available', month, locale: 'zh', asOf: NOW, events, sources: [] }
}

function wiringWith(queryMonth: (query: { month: string }) => MarketCalendarPage) {
  return registerCalendarEventReminder({
    jobRuntime: {
      registerHandler: () => ({ dispose: () => undefined }) as never,
      setSchedule: () => undefined,
      removeSchedule: () => undefined
    },
    settings: {
      read: () => DEFAULT_CALENDAR_REMINDER_SETTINGS,
      write: () => DEFAULT_CALENDAR_REMINDER_SETTINGS,
      readWithStatus: () => ({ state: 'readable' as const, settings: DEFAULT_CALENDAR_REMINDER_SETTINGS }),
      writeWithStatus: () => ({ state: 'saved' as const, settings: DEFAULT_CALENDAR_REMINDER_SETTINGS })
    },
    queryMonth: queryMonth as never,
    submit: async () => undefined,
    timeZone: () => 'Asia/Shanghai',
    now: () => NOW
  })
}

describe('the landed filter the refresh path reads', () => {
  /**
   * 「哪些国家的数据」读不到时按默认「只美国」处理：与「缺键 = 可读 + 默认」同一条规矩，
   * 也不放大推送量。读到了就原样交给 `selectLandedReleases`，这里不重判一次。
   */
  it('falls back to US-only when the settings file cannot be read', () => {
    const read = landedFilterReader({
      read: () => DEFAULT_CALENDAR_REMINDER_SETTINGS,
      write: () => DEFAULT_CALENDAR_REMINDER_SETTINGS,
      readWithStatus: () => ({ state: 'unreadable' as const }),
      writeWithStatus: () => ({ state: 'not-saved' as const, settings: DEFAULT_CALENDAR_REMINDER_SETTINGS })
    })
    expect(read()).toEqual({ includeMatched: false, importance: ['high'], landedCountries: { scope: 'us', codes: [] } })
  })

  it('passes the stored selection through unchanged', () => {
    const stored = { ...DEFAULT_CALENDAR_REMINDER_SETTINGS, landedFilter: 'also-matched' as const,
      landedCountries: { scope: 'all' as const, codes: [] as const } }
    const read = landedFilterReader({
      read: () => stored,
      write: () => stored,
      readWithStatus: () => ({ state: 'readable' as const, settings: stored }),
      writeWithStatus: () => ({ state: 'saved' as const, settings: stored })
    })
    expect(read()).toEqual({ includeMatched: true, importance: ['high'], landedCountries: { scope: 'all', codes: [] } })
  })
})

describe('registerCalendarEventReminder wiring', () => {
  /**
   * 这条是「不许另造一份读取实现」的判据：把示例挑选用的事件读取换成一份新的实现，
   * 测试按钮演示的就不再是真实提醒那条链。`toBe` 比 `toEqual` 严格——包一层也会红。
   */
  it('exposes the very same readEvents function the reminder job uses', () => {
    const wiring = wiringWith(() => page('2026-11', []))
    expect(captured.deps).toBeDefined()
    expect(wiring.readEvents).toBe(captured.deps!.readEvents)
  })

  it('reads the current and the next month and keeps the stable observation identity', () => {
    const asked: string[] = []
    const wiring = wiringWith((query) => {
      asked.push(query.month)
      return query.month === '2026-11'
        ? page('2026-11', [marketEvent()])
        : page('2026-12', [marketEvent({ eventKey: 'other-hmac', observationKey: undefined, title: 'CPI', scheduledAt: '2026-12-10T13:30:00.000Z' })])
    })

    expect(wiring.readEvents()).toEqual([
      { eventKey: 'stable-observation', title: '非农就业人数', scheduledAt: '2026-11-06T13:30:00.000Z', importance: 'high' },
      // 没有稳定身份时退回 `eventKey`，与作业里的取法一致。
      { eventKey: 'other-hmac', title: 'CPI', scheduledAt: '2026-12-10T13:30:00.000Z', importance: 'high' }
    ])
    expect(asked).toEqual(['2026-11', '2026-12'])
  })

  it('treats an unavailable month as no events instead of failing the whole read', () => {
    const wiring = wiringWith((query) =>
      query.month === '2026-11'
        ? page('2026-11', [marketEvent()])
        : { state: 'unavailable', failureCode: 'query-unavailable' }
    )
    expect(wiring.readEvents()).toHaveLength(1)
  })
})
