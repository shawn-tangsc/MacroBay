import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import {
  calendarNumericJsonFor, calendarNumericStateOf, isCalendarNumericJson, numericJsonWithoutParse,
  parseCalendarDisplayNumber
} from './marketCalendarNumericParse'
import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'

/**
 * 数值化 N1（架构师方案 2026-11-21）：**一列 `numeric_json` + 解析只在源适配器 + 写入口不解析**。
 *
 * 四条判据：
 * ① 认识四种写法（`4.1%` / `4.1` / `165K` / `1,234`），其余 `unparsed`，**绝不写 0**；
 * ② 写入口不解析：展示串可解析、没有 numeric_json → 落 `unparsed`，不会被算成数值；
 * ③ 旧行 NULL＝「数值未记录」，四态分开，不合并成一句「无数据」；
 * ④ 列是幂等补列（旧库没有就加，已有不动）。
 */
const now = '2026-11-21T05:00:00.000Z'

const row = (valuesJson: string, extra: Readonly<{ numericJson?: string }> = {}) => ({
  countryCode: 'US', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10',
  scheduledDate: '2026-11-10', timePrecision: 'date' as const, status: 'published' as const,
  valuesJson, sourceProviderId: 'narwhal', sourceEventId: 'n-1', parserVersion: 'v1',
  observedAt: now, firstSeenAt: now, ...extra
})

describe('解析展示串（只认识方案里那四种写法）', () => {
  it('4.1% / 4.1 / 165K / 1,234 各解出数值、小数位与单位；不换算', () => {
    expect(parseCalendarDisplayNumber('4.1%')).toEqual({ value: 4.1, decimals: 1, unit: 'percent' })
    expect(parseCalendarDisplayNumber('4.1')).toEqual({ value: 4.1, decimals: 1, unit: 'unknown' })
    expect(parseCalendarDisplayNumber('165K')).toEqual({ value: 165, decimals: 0, unit: 'thousands' })
    expect(parseCalendarDisplayNumber('1,234')).toEqual({ value: 1234, decimals: 0, unit: 'unknown' })
    // 不换算：165K 存 165 + thousands，不折成 165000。
    expect(parseCalendarDisplayNumber('165K')).not.toEqual(expect.objectContaining({ value: 165000 }))
    // 负数与零都是真值。
    expect(parseCalendarDisplayNumber('-0.5%')).toEqual({ value: -0.5, decimals: 1, unit: 'percent' })
    expect(parseCalendarDisplayNumber('0')).toEqual({ value: 0, decimals: 0, unit: 'unknown' })
  })

  it('占位符与认不出的写法落 reason，不许当成 0', () => {
    expect(parseCalendarDisplayNumber('--')).toEqual({ reason: 'placeholder' })
    expect(parseCalendarDisplayNumber('N/A')).toEqual({ reason: 'placeholder' })
    expect(parseCalendarDisplayNumber('')).toEqual({ reason: 'empty' })
    expect(parseCalendarDisplayNumber('1.2M-1.4M')).toEqual({ reason: 'unrecognized' })
    expect(parseCalendarDisplayNumber('Q1')).toEqual({ reason: 'unrecognized' })
  })

  it('三个值字段：至少一个解出来才 available；有展示串但全解不出＝unparsed', () => {
    const available = calendarNumericJsonFor({ actual: '4.1%', previous: '3.9%' })
    expect(available.state).toBe('available')
    expect(JSON.parse(available.json)).toMatchObject({
      v: 1, state: 'available', unit: 'percent', values: { actual: 4.1, previous: 3.9 }, decimals: { actual: 1, previous: 1 }
    })
    const unparsed = calendarNumericJsonFor({ actual: '--' })
    expect(unparsed.state).toBe('unparsed')
    expect(JSON.parse(unparsed.json).values).toBeUndefined()
    const missing = calendarNumericJsonFor({})
    expect(missing.state).toBe('missing')
  })
})

describe('写入口只校验、不解析', () => {
  it('展示串可解析但没有 numeric_json → 落 unparsed，不会被算成 4.1', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, row('{"actual":"4.1%"}'))
    const stored = database.prepare('select numeric_json from mi_calendar_events').get() as { numeric_json: string }
    expect(JSON.parse(stored.numeric_json)).toMatchObject({ state: 'unparsed', v: 1 })
    expect(JSON.parse(stored.numeric_json).values).toBeUndefined()
    // 展示串一个字节不动。
    expect((database.prepare('select values_json from mi_calendar_events').get() as { values_json: string }).values_json)
      .toBe('{"actual":"4.1%"}')
  })

  it('"--" 落 unparsed 且计数口径可分；真 0 落 available（0 与「没有」不是一回事）', () => {
    expect(numericJsonWithoutParse('{"actual":"--"}').state).toBe('unparsed')
    expect(numericJsonWithoutParse('{"actual":"0%"}').state).toBe('unparsed') // 写入口不解析：仍是 unparsed
    expect(calendarNumericJsonFor({ actual: '0%' }).state).toBe('available')  // 适配器解析：0 是值
    expect(calendarNumericStateOf(null).state).toBe('unrecorded')
  })

  it('写入口收到形状不合法的 numeric_json 时拒写（不猜、不修）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    expect(() => upsertCalendarStandardRow(database, row('{"actual":"4.1%"}', { numericJson: '{"v":2}' })))
      .toThrow(/numeric-json-invalid/)
    expect(() => upsertCalendarStandardRow(database, row('{"actual":"4.1%"}', { numericJson: 'not json' })))
      .toThrow(/numeric-json-invalid/)
    expect(isCalendarNumericJson({ v: 1, state: 'available', unit: 'percent', values: { actual: 4.1 },
      decimals: { actual: 1 }, parserVersion: 'calendar-numeric-v1' })).toBe(true)
    expect(isCalendarNumericJson({ v: 1, state: 'available', unit: 'shares', parserVersion: 'v1' })).toBe(false)
  })

  it('后到的只带 previous：逐字段合并，actual 不被抹掉', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const first = calendarNumericJsonFor({ actual: '165K', previous: '160K' })
    upsertCalendarStandardRow(database, row('{"actual":"165K","previous":"160K"}', { numericJson: first.json }))
    const second = calendarNumericJsonFor({ previous: '162K' })
    upsertCalendarStandardRow(database, row('{"previous":"162K"}', { numericJson: second.json }))
    const stored = JSON.parse((database.prepare('select numeric_json from mi_calendar_events').get() as
      { numeric_json: string }).numeric_json)
    expect(stored.state).toBe('available')
    expect(stored.values).toEqual({ actual: 165, previous: 162 })
    expect(stored.unit).toBe('thousands')
  })
})

describe('列与旧行', () => {
  it('新库建表就带 numeric_json；旧行 NULL＝数值未记录（四态之一，不是 0）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const columns = (database.prepare('pragma table_info(mi_calendar_events)').all() as { name: string }[])
      .map((column) => column.name)
    expect(columns).toContain('numeric_json')
    // 旧行（NULL）读成「数值未记录」，与 missing/unparsed 分开。
    database.prepare(`insert into mi_calendar_events
      (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision, status,
       identity_kind, value_state, values_json, source_provider_id, source_event_id, parser_version,
       observed_at, first_seen_at, release_count)
      values ('US','US.OLD.NONE.LEVEL','2026-09','2026-10-01','2026-10-01','date','published','code','present',
        '{"actual":"1.0%"}','narwhal','old-1','v1',?,?,1)`).run(now, now)
    const legacy = database.prepare("select numeric_json from mi_calendar_events where metric_key = 'US.OLD.NONE.LEVEL'")
      .get() as { numeric_json: string | null }
    expect(legacy.numeric_json).toBeNull()
    expect(calendarNumericStateOf(legacy.numeric_json).state).toBe('unrecorded')
  })
})