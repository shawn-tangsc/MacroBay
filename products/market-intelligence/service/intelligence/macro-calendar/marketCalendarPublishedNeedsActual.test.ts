import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { reconcileExpiredReleaseStatuses } from './marketCalendarReleaseStatusReconcile'
import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'

/**
 * **`published` 必须同时有实际值**（用户 2026-11-16 报的帝国大厦那条）。
 *
 * 实况：narwhal 提前三天写进一条只有 `consensus: 10`、没有 actual 的行，状态却是 `published`；
 * 任何「优先信已发布」的逻辑都会选中这个错的预期值。只有预期值的一律不算发布，按规则退回
 * `backfilling` / `missing`。
 */
const now = '2026-11-16T13:40:00.000Z'
const today = '2026-11-16'

const row = (valuesJson: string, status: 'published' | 'scheduled') => ({
  countryCode: 'US', metricKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL', periodKey: '2026-11',
  scheduledDate: '2026-11-16', timePrecision: 'minute' as const, scheduledAt: '2026-11-16T13:30:00.000Z',
  status, valuesJson, sourceProviderId: 'narwhal', sourceEventId: 'empire-2026-11',
  parserVersion: 'v1', observedAt: now, firstSeenAt: now
})

describe('published 必须有实际值', () => {
  it('只有预期值却挂着 published → 退回 backfilling（窗口内）/ missing（窗口外）', () => {
    // 窗口内（发布后 10 分钟）
    const inside = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(inside)
    upsertCalendarStandardRow(inside, row(JSON.stringify({ consensus: '10', previous: '25.5' }), 'published'))
    reconcileExpiredReleaseStatuses(inside, { today, nowMs: Date.parse(now) })
    expect((inside.prepare('select status from mi_calendar_events').get() as { status: string }).status).toBe('backfilling')

    // 窗口外（发布后 3 天）
    const outside = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(outside)
    upsertCalendarStandardRow(outside, row(JSON.stringify({ consensus: '10' }), 'published'))
    reconcileExpiredReleaseStatuses(outside, { today, nowMs: Date.parse('2026-11-19T13:40:00.000Z') })
    expect((outside.prepare('select status from mi_calendar_events').get() as { status: string }).status).toBe('missing')
  })

  it('有实际值的 published 不动（不是一刀切往下压）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, row(JSON.stringify({ actual: '7.8', consensus: '18' }), 'published'))
    const report = reconcileExpiredReleaseStatuses(database, { today, nowMs: Date.parse(now) })
    expect(report.updated).toBe(0)
    expect((database.prepare('select status from mi_calendar_events').get() as { status: string }).status).toBe('published')
  })
})
