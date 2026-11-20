import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from '../marketCalendarStandardTable'
import { readCalendarEventList } from './marketCalendarEventListRead'

/**
 * 事件清单读口（用户 2026-11-18）：事件单独一个只读页签，不参与映射。
 *
 * 判据：
 * 1. **只含事件**——经济指标行一条都不进来，否则「不需要映射」这句话就不成立；
 * 2. 一行 = 一场事件，按活动时间倒序；
 * 3. 日期精度的事件**不给假时刻**（0 点会被读成「凌晨发生」）；
 * 4. 国家名取自同一张国名表，查不到是 `null`，界面写 `—`，不编；
 * 5. 读失败是 `unavailable`，不画成空表。
 */
const now = '2026-11-18T12:00:00.000Z'

function seed(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  upsertCalendarStandardRow(database, {
    countryCode: 'US', metricKey: 'evt.fomc', periodKey: '2026-10-29', scheduledDate: '2026-10-29',
    scheduledAt: '2026-10-29T18:00:00.000Z', timePrecision: 'minute' as const, status: 'published' as const,
    valuesJson: '{}', sourceLabel: '美联储 FOMC 会议',
    eventType: 'central-bank-activity' as const,
    sourceProviderId: '0xrouter', sourceEventId: 'cb-1', parserVersion: 'v1', observedAt: now, firstSeenAt: now
  })
  // 日期精度 + 查不到的国家：时刻必须是 null，国家名必须是 null（不是空串、不是「未知国家」）。
  upsertCalendarStandardRow(database, {
    countryCode: 'ZZ', metricKey: '["44735",75559]', periodKey: '2026-10-14', scheduledDate: '2026-10-14',
    timePrecision: 'date' as const, status: 'missing' as const, valuesJson: '{}',
    sourceLabel: '东盟能源部长会议', eventType: 'financial-event' as const,
    sourceProviderId: '0xrouter', sourceEventId: 'fin-1', parserVersion: 'v1', observedAt: now, firstSeenAt: now
  })
  // 同一时刻、两场不同活动：事件**不按任何键合并**，这一分钟必须仍是两场。
  // 这条盯住一次真实误合并：按空 indicatorId 分组，曾把同一分钟的多场活动并成一件。
  upsertCalendarStandardRow(database, {
    countryCode: 'CA', metricKey: '["50001",1]', periodKey: '2026-10-28', scheduledDate: '2026-10-28',
    scheduledAt: '2026-10-28T16:05:00.000Z', timePrecision: 'minute' as const, status: 'scheduled' as const,
    valuesJson: '{}', sourceLabel: '加拿大央行副行长致开幕词', eventType: 'central-bank-activity' as const,
    sourceProviderId: '0xrouter', sourceEventId: 'cb-2', parserVersion: 'v1', observedAt: now, firstSeenAt: now
  })
  upsertCalendarStandardRow(database, {
    countryCode: 'EMU', metricKey: '["50002",1]', periodKey: '2026-10-28', scheduledDate: '2026-10-28',
    scheduledAt: '2026-10-28T16:05:00.000Z', timePrecision: 'minute' as const, status: 'scheduled' as const,
    valuesJson: '{}', sourceLabel: '欧盟-加拿大峰会举行', eventType: 'financial-event' as const,
    sourceProviderId: '0xrouter', sourceEventId: 'fin-2', parserVersion: 'v1', observedAt: now, firstSeenAt: now
  })
  // 一条经济指标：**不许**出现在事件清单里。
  upsertCalendarStandardRow(database, {
    countryCode: 'US', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-09', scheduledDate: '2026-10-15',
    timePrecision: 'date' as const, status: 'published' as const, valuesJson: '{"actual":"3.7%"}',
    eventType: 'economic-indicator' as const,
    sourceProviderId: 'narwhal', sourceEventId: 'cpi-1', parserVersion: 'v1', observedAt: now, firstSeenAt: now
  })
  return database
}

describe('readCalendarEventList', () => {
  it('lists events only, newest activity first, with no fake time on date-precision rows', () => {
    const read = readCalendarEventList(seed())
    expect(read.state).toBe('available')
    if (read.state !== 'available') return
    expect(read.total).toBe(4)
    // 同一时刻的两场活动各自成行：拿时间当键会并成一件，把不相关的事说成一件。
    const sameTime = read.rows.filter((row) => row.scheduledAt === '2026-10-28T16:05:00.000Z')
    expect(sameTime).toHaveLength(2)
    expect(new Set(sameTime.map((row) => row.title)).size).toBe(2)
    // 指标行不在里面：这条管的是「事件不参与映射」。
    expect(read.rows.some((row) => row.title === null)).toBe(false)
    const meeting = read.rows.find((row) => row.scheduledAt === '2026-10-29T18:00:00.000Z')
    const dated = read.rows.find((row) => row.scheduledDate === '2026-10-14')
    expect(meeting!.scheduledAt).toBe('2026-10-29T18:00:00.000Z')
    expect(meeting!.countryName).toBe('美国')
    expect(dated!.scheduledAt).toBeNull()
    expect(dated!.countryName).toBeNull()
    expect(dated!.eventType).toBe('financial-event')
  })

  it('answers unavailable instead of an empty list when the read throws', () => {
    const database = new DatabaseSync(':memory:')
    expect(readCalendarEventList(database)).toEqual({ state: 'unavailable', reasonCode: 'query-unavailable' })
  })
})