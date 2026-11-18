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
    expect(read.total).toBe(2)
    expect(read.rows.map((row) => row.title)).toEqual(['美联储 FOMC 会议', '东盟能源部长会议'])
    // 指标行不在里面：这条管的是「事件不参与映射」。
    expect(read.rows.some((row) => row.title === null)).toBe(false)
    const [meeting, dated] = read.rows
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