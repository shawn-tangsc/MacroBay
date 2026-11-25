import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from '../intelligence/macro-calendar/marketCalendarStandardTable'
import { listCrossSourceConflicts } from '../intelligence/macro-calendar/marketCalendarCrossSourceConflictAudit'
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
  /**
   * 启动链必须把「两家同一期、值不同」记成两条互指（Chief 2026-11-21，0.4.5 #18）：
   * 规范化不再把冲突并成一行，扫描再把这对冲突写进修订表。再启动一次不翻倍。
   */
  it('启动扫描记下跨源值冲突：两条互指，重跑不翻倍', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 冲突的相等性看**数值列**（N3）：只给展示串的行算「不可比」，不算冲突。
    const seed = (providerId: string, firstScheduledDate: string, value: number): void => {
      upsertCalendarStandardRow(database, {
        countryCode: 'US', metricKey: 'US.UNEMPLOYMENT.SA.RATE', periodKey: '2026-09',
        scheduledDate: '2026-10-03', firstScheduledDate, timePrecision: 'date',
        valuesJson: JSON.stringify({ actual: value.toFixed(1) }), valueState: 'present',
        numericJson: JSON.stringify({ v: 1, state: 'available', unit: 'percent',
          values: { actual: value }, decimals: { actual: 1 }, parserVersion: 'calendar-numeric-v1' }),
        sourceProviderId: providerId, sourceEventId: `${providerId}-${firstScheduledDate}`,
        parserVersion: 'v1', observedAt: '2026-10-03T12:31:00.000Z', firstSeenAt: '2026-10-03T12:31:00.000Z'
      })
    }
    seed('narwhal', '2026-10-03', 4.1)
    // 两家**期次都由源给出**（narwhal / 官方 BLS）。0xrouter 的期次是推出来的，按 ③ 的期次闸
    // 这一组属于「不可比·来源没有给统计期」，不记冲突——用它当样本，测的就不是冲突记录了。
    seed('macro-calendar-bls', '2026-10-04', 4.2)
    const run = (): void => syncOfficialStandardRowsAtStartup({
      database, listEffectiveMonthAsOf: noRevisions, now: () => new Date('2026-11-18T00:00:00.000Z')
    })
    run()
    expect(listCrossSourceConflicts(database)).toHaveLength(1)
    const rows = (): number => Number((database.prepare(
      "select count(*) n from mi_calendar_value_revisions where decision = 'conflict:cross-source'"
    ).get() as { n: number }).n)
    expect(rows()).toBe(2)
    run()
    expect(listCrossSourceConflicts(database)).toHaveLength(1)
    expect(rows()).toBe(2)
  })

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

  /**
   * **启动回填把老行的档补上**（Chief 2026-11-24）：S1 之前写下的行 `importance_grade` 是 NULL，
   * 写入口改了之后只有「被采集重写」的行才会补；不在采集窗口里的未来行靠这一步。
   * 第二遍必须报「补上 0 行」——只填空，不每轮重写。
   */
  it('启动回填补上老行的档，第二遍不再写', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, {
      ...sourceRow(), countryCode: 'US', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10',
      sourceEventId: 'US.CPI.RELEASE.2026-10', seriesId: undefined as never
    })
    database.exec('update mi_calendar_events set importance_grade = null')
    const grades: string[] = []
    const run = (): void => {
      syncOfficialStandardRowsAtStartup({
        database, listEffectiveMonthAsOf: noRevisions, now: () => new Date('2026-11-18T00:00:00.000Z'),
        log: (_level, _event, fields) => {
          const message = String(fields?.message ?? '')
          if (message.includes('重要性档回填')) grades.push(message)
        }
      })
    }
    run()
    const stored = (): string | null => (database.prepare(`select importance_grade
      from mi_calendar_events where metric_key = 'US.CPI.NSA.YOY'`).get() as
      { importance_grade: string | null }).importance_grade
    expect(stored()).toBe('high')
    expect(grades[0]).toContain('补上 1 行')
    run()
    expect(stored()).toBe('high')
    expect(grades[1]).toContain('补上 0 行')
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
  it('启动时源不可用：规范化与盘点都照跑并记录欠账数，不阻断启动', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 种一条「期次解不出」的欠账样本：规范化**不该**动它，盘点必须如实记下这条。
    upsertCalendarStandardRow(database, {
      ...sourceRow(), countryCode: 'US', metricKey: '["999999",1]', sourceEventId: '["999999",1]',
      identityKind: 'source', periodKey: 'unknown:["999999",1]', scheduledDate: '2026-11-10',
    })
    const lines: string[] = []
    expect(() => syncOfficialStandardRowsAtStartup({
      database,
      listEffectiveMonthAsOf: () => { throw new Error('网络不可用') },
      now: () => new Date('2026-11-19T00:00:00.000Z'),
      log: (_level, _event, fields) => { lines.push(String(fields?.message ?? '')) },
    })).not.toThrow()
    const auditLine = lines.find((line) => line.includes('数据一致性盘点'))
    expect(auditLine).toBeDefined()
    expect(auditLine).toContain('期次未解 1')
    expect(auditLine).toContain('有缺口')
  })
})
