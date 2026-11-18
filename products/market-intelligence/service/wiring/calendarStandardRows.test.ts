import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from '../intelligence/macro-calendar/marketCalendarStandardTable'
import { syncOfficialStandardRowsAtStartup } from './calendarStandardRows'

const sourceRow = () => ({
  countryCode: 'JP', metricKey: '["206580",1]', periodKey: '2026-10', scheduledDate: '2026-11-18',
  scheduledAt: '2026-11-18T10:30:00.000Z', timePrecision: 'minute' as const,
  valuesJson: '{}', sourceProviderId: 'narwhal', sourceEventId: '["206580",1]', parserVersion: 'v1',
  observedAt: '2026-11-18T10:31:00.000Z', firstSeenAt: '2026-11-18T10:31:00.000Z',
  identityKind: 'source' as const, sourceLabel: '不是事件类型串', seriesId: 'no-such-series',
})

const noRevisions = () => []

describe('启动链：syncOfficialStandardRowsAtStartup', () => {
  it('启动时真的跑转正：源内身份就地改码', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, sourceRow())
    syncOfficialStandardRowsAtStartup({
      database, listEffectiveMonthAsOf: noRevisions, now: () => new Date('2026-11-18T00:00:00.000Z'),
    })
    const rows = database.prepare('select identity_kind, metric_key from mi_calendar_events').all() as
      { identity_kind: string; metric_key: string }[]
    expect(rows).toEqual([{ identity_kind: 'code', metric_key: 'JP.INVENTORY.NONE.MOM' }])
  })

  it('每一步迁移都通过 `log` 口报一条，`console.warn` 不是唯一的现场', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, sourceRow())
    const events: { level: string; event: string; fields?: Record<string, unknown> }[] = []
    syncOfficialStandardRowsAtStartup({
      database, listEffectiveMonthAsOf: noRevisions, now: () => new Date('2026-11-18T00:00:00.000Z'),
      log: (level, event, fields) => { events.push({ level, event, ...(fields === undefined ? {} : { fields }) }) },
    })
    // 主进程的 stdout 不写进 app.log：没有这个口子，「没日志」会被读成「没执行」。
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((item) => item.event === 'macro-calendar.startup-migration')).toBe(true)
    expect(events.some((item) => String(item.fields?.message ?? '').includes('源内身份转正'))).toBe(true)
  })

  it('同步失败不阻断启动（吞错语义）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    expect(() => syncOfficialStandardRowsAtStartup({
      database,
      listEffectiveMonthAsOf: () => { throw new Error('源不可用') },
      now: () => new Date('2026-11-18T00:00:00.000Z'),
    })).not.toThrow()
  })

  /**
   * **启动零网络盘点**（用户 2026-11-19 定）：源不可用（等价「启动时网络不通」）时，
   * 应用照常起来、盘点照样跑、欠账数被记进日志，且不抛错。
   */
  it('启动时源不可用：盘点仍跑并记录欠账数，不阻断启动', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 种一条 ①（标着有值、其实只有前值）当欠账样本。
    upsertCalendarStandardRow(database, {
      ...sourceRow(), countryCode: 'US', metricKey: 'US.TEST.NONE.LEVEL', sourceEventId: 'x-audit',
      valuesJson: '{"previous":"1.0"}', identityKind: 'code', periodKey: '2026-10',
    })
    database.prepare("update mi_calendar_events set value_state = 'present'").run()
    const lines: string[] = []
    expect(() => syncOfficialStandardRowsAtStartup({
      database,
      listEffectiveMonthAsOf: () => { throw new Error('网络不可用') },
      now: () => new Date('2026-11-19T00:00:00.000Z'),
      log: (_level, _event, fields) => { lines.push(String(fields?.message ?? '')) },
    })).not.toThrow()
    const auditLine = lines.find((line) => line.includes('数据一致性盘点'))
    expect(auditLine).toBeDefined()
    expect(auditLine).toContain('present无值 1')
    expect(auditLine).toContain('有缺口')
  })
})
