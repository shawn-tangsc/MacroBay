import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import {
  calendarNumericJsonFor, calendarNumericJsonFromSourceValues, calendarNumericStateOf, isCalendarNumericJson,
  numericJsonWithoutParse, parseCalendarDisplayNumber
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

/**
 * N2：官方源（BLS/BEA/Fed）的值对象**本来就有 `numericValue` + `unit`**，那是源的事实，不是我们要猜的
 * 东西——所以先取它，没有才解析展示串。这条顺序反了（先解析）会把源给的高精度数换成展示串的
 * 四舍五入值，而展示串本来就是从同一个数格式化出来的。
 */
describe('源自报的数值优先（N2）', () => {
  it('源给了 numericValue 就用它，不再解析展示串；单位按闭集映射', () => {
    const built = calendarNumericJsonFromSourceValues({
      actual: { displayValue: '3.2%', numericValue: 3.2, unit: 'percent-yoy' }
    })
    expect(built.state).toBe('available')
    expect(built.unparsedFields).toBe(0)
    expect(JSON.parse(built.json)).toMatchObject({
      v: 1, state: 'available', unit: 'percent', values: { actual: 3.2 }, decimals: { actual: 1 }
    })
    // 高精度不被展示串换掉：3.73768 就是 3.73768，不是 '3.7' 解出来的 3.7。
    const precise = calendarNumericJsonFromSourceValues({ actual: { displayValue: '3.7', numericValue: 3.73768 } })
    expect(JSON.parse(precise.json).values.actual).toBe(3.73768)
  })

  it('没给 numericValue 才解析展示串；源声明的单位优先于写法推断', () => {
    // 官方 CPI 的展示串是 '3.7'，没有 % —— 靠量纲提示才是百分比。
    const hinted = calendarNumericJsonFromSourceValues({ actual: { displayValue: '3.7' } }, { unit: 'percent' })
    expect(JSON.parse(hinted.json)).toMatchObject({ unit: 'percent', values: { actual: 3.7 } })
    // 源自己声明 thousands、展示串写 165K：声明优先，值仍是 165（不换算）。
    const declared = calendarNumericJsonFromSourceValues({ actual: { displayValue: '165K', unit: 'thousands' } })
    expect(JSON.parse(declared.json)).toMatchObject({ unit: 'thousands', values: { actual: 165 } })
    // 声明了不认识的词汇 → 退回写法推断，不从词汇里编一个单位。
    const vocabulary = calendarNumericJsonFromSourceValues({ actual: { displayValue: '165K', unit: 'people' } })
    expect(JSON.parse(vocabulary.json).unit).toBe('thousands')
    // 什么都没有 → 单位落闭集里的 unknown，不是缺字段。
    const bare = calendarNumericJsonFromSourceValues({ actual: { displayValue: '1,234' } })
    expect(JSON.parse(bare.json).unit).toBe('unknown')
  })

  it('展示串是垃圾、源也没给数 → unparsed 且按字段计数，绝不写 0', () => {
    const built = calendarNumericJsonFromSourceValues({ actual: { displayValue: '--' }, previous: { displayValue: 'n/a' } })
    expect(built.state).toBe('unparsed')
    expect(built.unparsedFields).toBe(2)
    expect(JSON.parse(built.json).values).toBeUndefined()
    // 一个字段解出来、另一个解不出：state 是 available，但**解不出的字段照样计数**，不静默。
    const partial = calendarNumericJsonFromSourceValues({ actual: { displayValue: '4.1%' }, previous: { displayValue: '--' } })
    expect(partial.state).toBe('available')
    expect(partial.unparsedFields).toBe(1)
    expect(JSON.parse(partial.json).values).toEqual({ actual: 4.1 })
    const nothing = calendarNumericJsonFromSourceValues({})
    expect(nothing.state).toBe('missing')
    expect(nothing.unparsedFields).toBe(0)
  })

  it('源只给数值、没给展示串：小数位取数值本身，不当成 0 位', () => {
    const built = calendarNumericJsonFromSourceValues({ actual: { numericValue: 4.1 } })
    expect(JSON.parse(built.json)).toMatchObject({ state: 'available', values: { actual: 4.1 }, decimals: { actual: 1 } })
    const integer = calendarNumericJsonFromSourceValues({ actual: { numericValue: 165 } })
    expect(JSON.parse(integer.json).decimals).toEqual({ actual: 0 })
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