import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from '../marketCalendarStandardTable'
import { readCalendarEventList } from './marketCalendarEventListRead'

/**
 * 事件清单读口（用户 2026-11-18）：事件单独一个只读页签，不参与映射，**按「件」算**。
 *
 * 判据：
 * 1. **一行 = 一场活动**——源对同一场活动发中英文两条，界面只出一行（分组只走一份实现）；
 * 2. 只含事件：经济指标一条都不进来；
 * 3. 按活动时间倒序；
 * 4. 日期精度的事件**不给假时刻**（0 点会被读成「凌晨发生」）；
 * 5. 国家与状态取标准行；取不到是 `null`，界面写 `—` / 「无法确认」，不编；
 * 6. 读失败是 `unavailable`，不画成空表。
 */
const now = '2026-11-18T12:00:00.000Z'

const unmappedEvent = (database: DatabaseSync, sourceKey: string, name: string, scheduledAt: string, date: string): void => {
  database.prepare(`insert into mi_calendar_unmapped
    (provider_id, source_key, detected_at, raw_json, reason, first_seen_at, last_seen_at)
    values ('0xrouter', ?, '2026-11-18T12:00:00.000Z', ?, 'unknown-event-type',
      '2026-11-18T12:00:00.000Z', '2026-11-18T12:00:00.000Z')`)
    .run(sourceKey, JSON.stringify({ name, eventKind: 'central-bank-activity', scheduledDate: date, scheduledAt }))
}

const standardRow = (database: DatabaseSync, sourceKey: string, date: string, at: string | undefined,
  country: string, eventType: 'central-bank-activity' | 'financial-event'): void => {
  upsertCalendarStandardRow(database, {
    countryCode: country, metricKey: sourceKey, periodKey: 'unknown', scheduledDate: date,
    ...(at === undefined ? {} : { scheduledAt: at }),
    timePrecision: at === undefined ? 'date' as const : 'minute' as const,
    status: 'missing' as const, valuesJson: '{}', sourceLabel: sourceKey, eventType,
    sourceProviderId: '0xrouter', sourceEventId: sourceKey, parserVersion: 'v1', observedAt: now, firstSeenAt: now
  })
}

function seed(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  // 同一场活动、中英两条：分组后应只剩一行。
  unmappedEvent(database, '["44671",1]', '泰国央行公布货币政策会议纪要', '2026-10-20T08:00:00.000Z', '2026-10-20')
  unmappedEvent(database, '["44671",2]', 'Bank of Thailand minutes', '2026-10-20T08:00:00.000Z', '2026-10-20')
  standardRow(database, '["44671",1]', '2026-10-20', '2026-10-20T08:00:00.000Z', 'TH', 'central-bank-activity')
  // 没有标准行的那件：国家与状态都取不到 → null（界面写 `—` / 「无法确认」）。
  unmappedEvent(database, '["44735",1]', '东盟能源部长会议', '2026-10-14T16:45:00.000Z', '2026-10-14')
  // **同一时刻、两场不同活动**：按分组键（源内 id + scheduledAt）必须仍是两件。
  // 这条盯住一次真实误合并：事件没有 indicatorId，若拿它当键，同一分钟的四场活动会并成一件。
  unmappedEvent(database, '["50001",1]', '加拿大央行副行长致开幕词', '2026-10-28T16:05:00.000Z', '2026-10-28')
  unmappedEvent(database, '["50002",1]', '欧盟-加拿大峰会举行', '2026-10-28T16:05:00.000Z', '2026-10-28')
  // 一条经济指标混在未映射里：读口按原因筛，不该进来。
  database.prepare(`insert into mi_calendar_unmapped
    (provider_id, source_key, detected_at, raw_json, reason, first_seen_at, last_seen_at)
    values ('0xrouter', '["700001",1]', '2026-11-18T12:00:00.000Z', ?, 'no-code',
      '2026-11-18T12:00:00.000Z', '2026-11-18T12:00:00.000Z')`)
    .run(JSON.stringify({ name: '工业产出', eventKind: 'economic-indicator', scheduledDate: '2026-11-10' }))
  return database
}

describe('readCalendarEventList', () => {
  it('lists one row per activity, newest first, with country and status from the standard row', () => {
    const read = readCalendarEventList(seed())
    expect(read.state).toBe('available')
    if (read.state !== 'available') return
    // 五条未映射事件记录：中英一对并成一件、另一件单条、同一时刻的两场不同活动 → **四件**。
    expect(read.total).toBe(4)
    const bank = read.rows.find((row) => row.scheduledAt === '2026-10-20T08:00:00.000Z')
    const energy = read.rows.find((row) => row.scheduledDate === '2026-10-14')
    expect(bank!.title).toBe('泰国央行公布货币政策会议纪要 · Bank of Thailand minutes')
    expect(bank!.countryName).toBe('泰国')
    expect(bank!.status).toBe('missing')
    expect(bank!.scheduledAt).toBe('2026-10-20T08:00:00.000Z')
    expect(energy!.countryName).toBeNull()
    expect(energy!.status).toBeNull()
    // 同一时刻的两场活动各自成行：拿时间当键会并成一件，把不相关的事说成一件。
    const sameTime = read.rows.filter((row) => row.scheduledAt === '2026-10-28T16:05:00.000Z')
    expect(sameTime).toHaveLength(2)
    expect(new Set(sameTime.map((row) => row.title)).size).toBe(2)
  })

  it('never lists an indicator and answers unavailable instead of an empty list', () => {
    const read = readCalendarEventList(seed())
    if (read.state !== 'available') throw new Error('unavailable')
    expect(read.rows.some((row) => row.title === '工业产出')).toBe(false)

    const empty = new DatabaseSync(':memory:')
    expect(readCalendarEventList(empty)).toEqual({ state: 'unavailable', reasonCode: 'query-unavailable' })
  })
})