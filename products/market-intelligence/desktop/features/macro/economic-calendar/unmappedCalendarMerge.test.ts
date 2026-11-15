import { describe, expect, it } from 'vitest'

import type {
  UnmappedCalendarMonthRead,
  UnmappedCalendarObservation
} from '../../../../service/intelligence/macro-calendar/rendering/marketCalendarUnmappedMonthRead'
import type { CalendarDayItem } from './economicCalendarDayModel'
import { mergeCalendarDaySources } from './unmappedCalendarMerge'

/**
 * 两个来源合并的判据（用户 2026-11-16 拍板：日历显示标准表 + 非标准表，界面要能区分）。
 *
 * 全是纯函数断言，不挂 DOM：这一层只负责**排序、去重、分组、计数**，怎么画是下一步。
 * 未映射条目的类型直接取服务侧读口的，不在这里另写一份——形状一漂，这里先编译不过。
 */
// 编译期断言：读口的 `entries` **直接**就是合并函数的入参，接线时不需要中间映射。
const acceptsReadResult: (read: UnmappedCalendarMonthRead) => ReadonlyArray<UnmappedCalendarObservation> =
  (read) => read.entries
void acceptsReadResult

const market = (key: string, time: string | undefined, title: string): CalendarDayItem => ({
  source: 'market',
  key: `market:${key}`,
  date: '2026-11-05',
  ...(time === undefined ? {} : { time }),
  event: {
    eventKey: key, title, countryCode: 'US', importance: 'high', eventType: 'economic-indicator',
    scheduledAt: `2026-11-05T${time ?? '00:00'}:00.000Z`, source: '0xrouter'
  }
} as unknown as CalendarDayItem)

const unmapped = (
  sourceKey: string,
  time: string | undefined,
  title: string,
  over: Partial<UnmappedCalendarObservation> = {}
): UnmappedCalendarObservation => ({
  key: `0xrouter:${sourceKey}`,
  providerId: '0xrouter',
  sourceKey,
  reason: 'bad-identity',
  scheduledDate: '2026-11-05',
  timePrecision: time === undefined ? 'date' : 'minute',
  title,
  eventType: 'economic-indicator',
  detectedAt: '2026-11-05T00:00:00.000Z',
  ...(time === undefined ? {} : { scheduledAt: `2026-11-05T${time}:00.000Z` }),
  ...over
})

const merge = (input: Omit<Parameters<typeof mergeCalendarDaySources>[0], 'timeZone'>) =>
  mergeCalendarDaySources({ timeZone: 'UTC', ...input })

describe('mergeCalendarDaySources', () => {
  it('sorts by time across both sources, standard first on a tie', () => {
    // 时区取 UTC，让「同一时刻」这件事不受换算影响。
    const result = merge({
      date: '2026-11-05',
      standard: [market('b', '10:30', 'B'), market('a', '08:00', 'A')],
      unmapped: [unmapped('x', '09:15', 'X'), unmapped('y', '10:30', 'Y')]
    })
    expect(result.rows.map((row) => row.key)).toEqual(['market:a', '0xrouter:x', 'market:b', '0xrouter:y'])
  })

  it('puts rows with only a date last instead of inventing a midnight time', () => {
    // 只有日期的观测不许被当成 00:00 排到最前面——那会让读者以为它发生在半夜。
    const result = merge({
      date: '2026-11-05',
      standard: [market('a', '08:00', 'A')],
      unmapped: [unmapped('dated', undefined, '只有日期'), unmapped('timed', '06:00', '有时刻')]
    })
    expect(result.rows.map((row) => row.key)).toEqual(['0xrouter:timed', 'market:a', '0xrouter:dated'])
    expect(result.rows.find((row) => row.key === '0xrouter:dated')?.time).toBeUndefined()
  })

  it('keeps one row per event when the observation has already reached the standard table', () => {
    // 读口正常已经剔除并只报 superseded 计数；这一层是兜底：任何一侧出错，读者都不会看两遍。
    const result = merge({
      date: '2026-11-05',
      standard: [market('cpi', '20:30', 'CPI 年率')],
      unmapped: [unmapped('cpi', '20:30', 'CPI 年率'), unmapped('other', '21:00', '别的事件')],
      alreadyInStandard: new Set(['0xrouter:cpi'])
    })
    expect(result.rows.map((row) => row.key)).toEqual(['market:cpi', '0xrouter:other'])
    expect(result.counts).toEqual({ standard: 1, unmapped: 1, total: 2 })
  })

  it('counts a repeated stable key once', () => {
    const result = merge({
      date: '2026-11-05',
      standard: [],
      unmapped: [unmapped('dup', '09:00', '同一条'), unmapped('dup', '09:00', '同一条')]
    })
    expect(result.counts.unmapped).toBe(1)
  })

  it('groups unmapped rows apart, never into an event-type group and never with an invented importance', () => {
    const result = merge({
      date: '2026-11-05',
      standard: [market('a', '08:00', 'A')],
      unmapped: [unmapped('x', '09:15', 'X'), unmapped('evt', '09:30', '讲话', { eventType: 'central-bank-activity' })]
    })
    expect(result.groups.map((group) => group.kind)).toEqual(['event-type', 'unmapped'])
    const typeGroup = result.groups[0]!
    expect(typeGroup.kind === 'event-type' && typeGroup.rows.map((row) => row.key)).toEqual(['market:a'])
    const unmappedGroup = result.groups[1]!
    // 哪怕它的 eventType 是「央行活动」，也只出现在未映射那一组：没有分级就不进类别分组。
    expect(unmappedGroup.rows.map((row) => row.key)).toEqual(['0xrouter:x', '0xrouter:evt'])
    expect(result.counts).toEqual({ standard: 1, unmapped: 2, total: 3 })
  })

  it('never mixes in another day, so an unmapped row cannot land on the wrong date', () => {
    const result = merge({
      date: '2026-11-05',
      standard: [market('a', '08:00', 'A')],
      unmapped: [unmapped('next-day', '09:00', '次日的', { scheduledDate: '2026-11-06' })]
    })
    expect(result.rows.map((row) => row.key)).toEqual(['market:a'])
    expect(result.counts.unmapped).toBe(0)
  })

  it('keeps the cell count honest: both sources are counted', () => {
    const result = merge({
      date: '2026-11-05',
      standard: [market('a', '08:00', 'A'), market('b', '10:30', 'B')],
      unmapped: [unmapped('x', '09:15', 'X')]
    })
    expect(result.counts).toEqual({ standard: 2, unmapped: 1, total: 3 })
    expect(result.counts.total).toBe(result.rows.length)
  })
})
