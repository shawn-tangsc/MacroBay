import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { createMacroCalendarRepository } from './macroCalendarRepository'
import { prepareRevision } from './macroCalendarRevisionRows'
import {
  calendarImportanceRows, gradeCalendarEvent, jurisdictionOf,
  type CalendarImportanceRow
} from './calendarEventImportance'
import { ensureCalendarStandardTables } from './marketCalendarStandardSchema'
import { upsertCalendarStandardRow } from './marketCalendarStandardTable'
import type { MacroCalendarRevision } from './macroCalendarContracts'

/**
 * R44 S1（方案 `02-tech-design.md` §1/§2/§8）：**判定一份、落在两个唯一写入口**。
 *
 * 判据按方案 §8 的 1 / 2 / 3 / 6 / 7；§4/§5 的读侧三处与发布聚合属 S2，这里不用夹具假装验过。
 */

const withoutRow = (predicate: (row: CalendarImportanceRow) => boolean): readonly CalendarImportanceRow[] =>
  calendarImportanceRows.filter((row) => !predicate(row))

describe('§8.1 美国 CPI → 高；删掉这一行就变未分级', () => {
  it('US.CPI.NSA.YOY → high，族取自码的第二段', () => {
    const verdict = gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.CPI.NSA.YOY' })
    expect(verdict?.tier).toBe('high')
    expect(verdict?.family).toBe('CPI')
    expect(verdict?.basis).toContain('利率路径')
  })

  it('红证：删掉 (US, CPI) 这一行 → 同一条事件变未分级（不是低）', () => {
    const rows = withoutRow((row) => row.country === 'US' && row.family === 'CPI')
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.CPI.NSA.YOY' }, rows)).toBeUndefined()
  })

  it('核心里两个例外：核心 CPI 是另一族、核心 PCE 同理（同档、各自有行）', () => {
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.CORE_CPI.NSA.YOY' })?.family).toBe('CORE_CPI')
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.CORE_PCE.SA.YOY' })?.family).toBe('CORE_PCE')
  })
})

describe('§8.2 纽约联储制造业 → 中；改成高就变高', () => {
  it('EMPIRE_STATE_MANUFACTURING → medium', () => {
    const verdict = gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL' })
    expect(verdict?.tier).toBe('medium')
    expect(verdict?.family).toBe('EMPIRE_STATE_MANUFACTURING')
  })

  it('红证：把这一族改成高（只改数据）→ 同一条事件变高', () => {
    const rows = calendarImportanceRows.map((row) => row.family === 'EMPIRE_STATE_MANUFACTURING'
      ? { ...row, tier: 'high' as const } : row)
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL' }, rows)?.tier)
      .toBe('high')
  })

  it('同族的分项也同档（族由码第二段定，不由测度定）', () => {
    expect(gradeCalendarEvent({ countryCode: 'US',
      metricKey: 'US.PHILLY_FED_MANUFACTURING.EMPLOYMENT.SA.LEVEL' })?.tier).toBe('medium')
    expect(gradeCalendarEvent({ countryCode: 'US',
      metricKey: 'US.DALLAS_FED_MANUFACTURING.PRODUCTION.SA.LEVEL' })?.tier).toBe('medium')
  })
})

describe('§8.3 未登记身份 → 未分级（不是低）', () => {
  it('表里没有的组合、认不出的身份都返回 undefined', () => {
    expect(gradeCalendarEvent({ countryCode: 'BR', metricKey: 'BR.INDUSTRIAL_PRODUCTION.NONE.MOM' })).toBeUndefined()
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.ADP.SA.CHANGE' })).toBeUndefined()
    expect(gradeCalendarEvent({ countryCode: 'US' })).toBeUndefined()
  })

  it('身份认得、辖区没定档 → 未分级（德国不在进表辖区里，PRD §9.1 v2）', () => {
    expect(gradeCalendarEvent({ countryCode: 'DE', metricKey: 'DE.CPI.NSA.YOY' })).toBeUndefined()
  })

  it('红证：任何输入都不会返回 low 来冒充未分级', () => {
    for (const input of [
      { countryCode: 'US' },
      { countryCode: 'BR', metricKey: 'BR.CPI.NONE.YOY' },
      { countryCode: 'US', metricKey: 'US.NOT_A_CODE.NONE.LEVEL' }
    ]) {
      expect(gradeCalendarEvent(input)?.tier).not.toBe('low')
    }
  })
})

describe('身份顺序与两张小表（方案 §1.1/§1.2）', () => {
  it('指标码优先；没有码才看事件键；再没有才看登记标题键；最后才是官方 eventFamily', () => {
    expect(gradeCalendarEvent({ countryCode: 'US', metricKey: 'US.CPI.NSA.YOY',
      eventKey: 'evt.fomc', titleKey: 'gdp', eventFamily: 'gdp' })?.family).toBe('CPI')
    expect(gradeCalendarEvent({ countryCode: 'US', eventKey: 'US.FOMC.2026-12-09' })?.family).toBe('FOMC')
    expect(gradeCalendarEvent({ countryCode: 'US', eventKey: 'evt.fomc' })?.tier).toBe('high')
    expect(gradeCalendarEvent({ countryCode: 'US', titleKey: 'nonfarm-payrolls' })?.tier).toBe('high')
    // 修订行只有 eventFamily：8 行封闭表里认得才有档。
    expect(gradeCalendarEvent({ countryCode: 'US', eventFamily: 'cpi' })?.tier).toBe('high')
    expect(gradeCalendarEvent({ countryCode: 'US', eventFamily: 'mystery-family' })).toBeUndefined()
  })

  it('辖区归一：US/USA、GB/GBR、JP/JPN、CN/CHN、EMU 各归一个值', () => {
    expect(jurisdictionOf('USA')).toBe('US')
    expect(jurisdictionOf('GBR')).toBe('GB')
    expect(jurisdictionOf('JPN')).toBe('JP')
    expect(jurisdictionOf('CHN')).toBe('CN')
    expect(jurisdictionOf('EMU')).toBe('EMU')
    expect(jurisdictionOf('DEU')).toBe('DE')
  })

  it('可复现：同一身份判两次必同档（纯函数）', () => {
    const input = { countryCode: 'US', metricKey: 'US.RETAIL_SALES.SA.MOM' } as const
    expect(gradeCalendarEvent(input)).toEqual(gradeCalendarEvent(input))
    expect(gradeCalendarEvent(input)?.tier).toBe('medium')
  })

  it('`rest` 是显式决策行：FX 储备与 M2 在任何辖区都是低', () => {
    expect(gradeCalendarEvent({ countryCode: 'CN', metricKey: 'CN.FX_RESERVES.NONE.LEVEL' })?.tier).toBe('low')
    expect(gradeCalendarEvent({ countryCode: 'BR', metricKey: 'BR.MONEY_SUPPLY.NONE.YOY' })?.tier).toBe('low')
  })
})

describe('§8.6 写入口自己算档、忽略源给的档（标准行）', () => {
  it('源写 medium、我们判 high → 落 importance_grade=high，旧 importance 仍是源值', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, {
      countryCode: 'US', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10',
      scheduledDate: '2026-11-10', timePrecision: 'date', valuesJson: JSON.stringify({ actual: '3.7%' }),
      valueState: 'present', importance: 'medium',
      sourceProviderId: 'narwhal', sourceEventId: 'n-1', parserVersion: 'v1',
      observedAt: '2026-11-10T13:31:00.000Z', firstSeenAt: '2026-11-10T13:31:00.000Z'
    })
    const stored = database.prepare('select importance, importance_grade from mi_calendar_events')
      .get() as { importance: string | null; importance_grade: string | null }
    // 我们的档＝高；源给的档原样留在旧列，不被覆盖、也不被采用。
    expect(stored).toEqual({ importance: 'medium', importance_grade: 'high' })
  })

  it('身份判不出档 → 落 NULL（未分级），不是 low、也不是源的档', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, {
      countryCode: 'US', metricKey: 'US.ADP.SA.CHANGE', periodKey: '2026-10',
      scheduledDate: '2026-11-05', timePrecision: 'date', valuesJson: JSON.stringify({ actual: '1' }),
      valueState: 'present', importance: 'high',
      sourceProviderId: 'narwhal', sourceEventId: 'n-2', parserVersion: 'v1',
      observedAt: '2026-11-05T13:31:00.000Z', firstSeenAt: '2026-11-05T13:31:00.000Z'
    })
    const stored = database.prepare('select importance, importance_grade from mi_calendar_events')
      .get() as { importance: string | null; importance_grade: string | null }
    expect(stored).toEqual({ importance: 'high', importance_grade: null })
  })
})

describe('§8.7 迁移：两表各加一列、幂等、不回填', () => {
  const revision = (over: Partial<MacroCalendarRevision> = {}): MacroCalendarRevision => ({
    revisionId: 'rev-1', eventKey: 'US.CPI.RELEASE.2026-M10', releaseGroupKey: 'US.CPI.RELEASE.2026-M10',
    eventFamily: 'cpi', eventNameKey: 'cpi', countryCode: 'US', importance: 'high',
    periodKey: '2026-M10', lifecycleState: 'released', revisionKind: 'official-release',
    scheduledDate: '2026-11-10', detectedAt: '2026-11-10T13:30:00.000Z',
    recordedAt: '2026-11-10T13:31:00.000Z', actual: { displayValue: '3.7%' },
    providerId: 'macro-calendar-bls', descriptorId: 'd', sourceUrl: 'https://x.invalid',
    evidenceHash: 'h', evidenceRefs: [], snapshotHash: 's', parserVersion: 'v1', caveats: [], ...over
  })

  it('旧库（无列）补列、旧行保持 NULL、第二次跑不动', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 旧行：加列前写的
    database.prepare(`insert into mi_calendar_events
      (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision, status,
       identity_kind, value_state, values_json, source_provider_id, source_event_id, parser_version,
       observed_at, first_seen_at, release_count)
      values ('US','US.CPI.NSA.YOY','2026-09','2026-10-10','2026-10-10','date','published','code','present',
        '{"actual":"3.1%"}','narwhal','old-1','v1','2026-10-10T12:00:00.000Z','2026-10-10T12:00:00.000Z',1)`).run()
    // 模拟旧库：把列拆掉，再走一次 ensure。
    database.exec('alter table mi_calendar_events drop column importance_grade')
    ensureCalendarStandardTables(database)
    const columns = (database.prepare('pragma table_info(mi_calendar_events)').all() as { name: string }[])
      .map((column) => column.name)
    expect(columns).toContain('importance_grade')
    // 不回填：旧行仍是 NULL＝未分级。
    expect((database.prepare("select importance_grade from mi_calendar_events where source_event_id = 'old-1'")
      .get() as { importance_grade: string | null }).importance_grade).toBeNull()
    // 第二次 ensure 幂等：列还在、值没变。
    ensureCalendarStandardTables(database)
    expect((database.prepare('select count(*) as n from mi_calendar_events').get() as { n: number }).n).toBe(1)
  })

  it('修订行写入口：prepareRevision 自己算档，源 importance 不动', () => {
    const stored = prepareRevision(revision())
    expect(stored.importance).toBe('high')      // 源给的，原样
    expect(stored.importanceGrade).toBe('high')  // 我们判的

    // 故意造一个**表外**的官方族：`eventFamily` 是封闭联合，这里不改类型、用显式断言造越界值，
    // 验的是行为（判不出 → 不写这一列），不是类型。放宽类型会把「封闭表」变成开放表。
    const unlistedFamily = { eventFamily: 'mystery-family' } as unknown as Partial<MacroCalendarRevision>
    expect(prepareRevision(revision(unlistedFamily)).importanceGrade).toBeUndefined()
  })

  it('修订行真的落库：追加后能在表里读到 importance_grade', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const appended = repository.appendIfNew(revision())
    expect(appended.revision.importanceGrade).toBe('high')
    expect(repository.getEffectiveEventAsOf({ eventKey: 'US.CPI.RELEASE.2026-M10',
      asOf: '2026-11-11T00:00:00.000Z' })?.importanceGrade).toBe('high')
  })
})