import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { readCalendarCodeTable } from './marketCalendarCodeTableRead'
import { codeTableReasonSets } from '../marketCalendarCodeTable'

/**
 * 码表页签的读口（用户 2026-11-17：弹框只留「码表 / 未映射」两个页签）。
 *
 * 三条判据：
 * - 一次下发整表，计数由服务端给；
 * - **官网页绝不下发空链接**：待补就带闭集理由，否则读者会把「还没核」读成「没有官网页」；
 * - 每个码带 `sourceIdCount`，但**不下发 id 列表**——页签只需要看出「有没有源认它」。
 */
const database = new DatabaseSync(':memory:')

describe('码表读口', () => {
  it('整表下发：指标 224 / 事件 1；待补的行必须带闭集理由，有页的行必须有 URL', () => {
    const read = readCalendarCodeTable(database)
    if (read.state !== 'available') throw new Error('unavailable')
    // 码表 = 244 条既有码 + 按国家新建的码；不写死行数，断「指标占绝大多数」。
    // **事件只剩 1 条**（`evt.fomc`，有主办机构）；其余 `evt.*` 是事件**类型**、没有单一主办国，
    // 2026-11-18 起移出码表、名字与身份由事件码表提供，所以这里不再断言「事件 20 条」。
    expect(read.counts.event).toBe(1)
    expect(read.counts.metric).toBeGreaterThan(700)
    expect(read.counts.total).toBe(read.counts.metric + read.counts.event)
    // 已经按机构补了一批（Destatis 等），所以两个数都不写死，只断关系：
    expect(read.counts.withOfficialSource).toBeGreaterThan(0)
    expect(read.counts.withOfficialSource + read.counts.pendingOfficialSource).toBe(read.counts.total)
    for (const row of read.rows) {
      const source = row.officialSource
      // 待补必须带**闭集里的**理由（成员资格，不是写死某一个值）：todo＝我们还没核到，
      // not-public＝机构不公开此页。两个值都合法，但不许出现闭集外的自由文本。
      if ('pending' in source) {
        expect(codeTableReasonSets.pending as readonly string[]).toContain(source.reason)
      }
      // 机构页有 http 的（密歇根大学的老站就是 http），不能一律要求 https——那是格式洁癖，
      // 真正要断的是「有页就必须有 URL」，不是协议。
      else expect(/^https?:\/\//.test(source.url)).toBe(true)
    }
    // 「机构不公开」这一类必须真的有人在用，否则这条理由就是空壳（A 类 17 条）。
    expect(read.rows.filter((row) => 'pending' in row.officialSource
      && row.officialSource.reason === 'official-source-not-public').length).toBeGreaterThan(0)
  })

  it('事件行没有测度与季调档（给 null，不编一个 LEVEL）', () => {
    const read = readCalendarCodeTable(database)
    if (read.state !== 'available') throw new Error('unavailable')
    const fomc = read.rows.find((row) => row.code === 'evt.fomc')!
    expect(fomc).toMatchObject({ kind: 'event', tier: null, measure: null, seasonality: null, status: 'active' })
    const cpi = read.rows.find((row) => row.code === 'US.CPI.NSA.YOY')!
    expect(cpi.measure).toBe('YOY')
    expect(cpi.seasonality).toBe('NSA')
  })

  it('每个码带 sourceIdCount（不下发 id 列表）：有源认的码数大于 0 且不超过总数', () => {
    const read = readCalendarCodeTable(database)
    if (read.state !== 'available') throw new Error('unavailable')
    const withIds = read.rows.filter((row) => row.sourceIdCount > 0)
    expect(withIds.length).toBeGreaterThan(0)
    expect(withIds.length).toBeLessThan(read.rows.length)
    // 行上只有计数，没有 id 数组——页签不展示逐个对照。
    expect(Object.keys(read.rows[0]!)).not.toContain('sourceIds')
  })
})

/**
 * 「数据量」= 这个码在**标准表**里有多少条**发布**（`row_kind = 'release'`）。
 *
 * 三个边界各钉一条：
 * - 同一码的 estimate 行（GDP nowcast 那类随时更新的估算）**不算**发布数据量，这个口子现在不留以后会咬人；
 * - 一个码有 12 条 → 数 12；另一个码一条没有 → **0**，不是缺失；
 * - 表还没建（新库、一次没采过）→ 一律 0，**不把「还没有数据」写成「读不到」**。
 */
describe('码表的「数据量」', () => {
  const withEvents = (rows: readonly { metric: string; kind: string }[]): ReturnType<typeof readCalendarCodeTable> => {
    const database = new DatabaseSync(':memory:')
    database.exec(`create table mi_calendar_events (metric_key text not null, row_kind text not null)`)
    const insert = database.prepare('insert into mi_calendar_events (metric_key, row_kind) values (?, ?)')
    for (const row of rows) insert.run(row.metric, row.kind)
    return readCalendarCodeTable(database)
  }

  it('counts release rows per code and treats estimate rows as not-published', () => {
    const read = withEvents([
      { metric: 'US.CPI.NSA.YOY', kind: 'release' },
      { metric: 'US.CPI.NSA.YOY', kind: 'release' },
      // 同码的估算行：不进数据量。
      { metric: 'US.CPI.NSA.YOY', kind: 'estimate' }
    ])
    if (read.state !== 'available') throw new Error('unavailable')
    const cpi = read.rows.find((row) => row.code === 'US.CPI.NSA.YOY')
    expect(cpi?.releaseRowCount).toBe(2)
  })

  it('reports 0 for a code the library has no rows for', () => {
    const read = withEvents([{ metric: 'US.CPI.NSA.YOY', kind: 'release' }])
    if (read.state !== 'available') throw new Error('unavailable')
    const withoutRows = read.rows.filter((row) => row.releaseRowCount === 0)
    expect(withoutRows.length).toBe(read.rows.length - 1)
    // 0 是一个数字，不是缺失：类型上必须有这个字段。
    for (const row of read.rows) expect(typeof row.releaseRowCount).toBe('number')
  })

  it('treats a missing table as "no data yet", not as unreadable', () => {
    const read = readCalendarCodeTable(new DatabaseSync(':memory:'))
    if (read.state !== 'available') throw new Error('新库不该被判成读不到')
    expect(read.rows.every((row) => row.releaseRowCount === 0)).toBe(true)
  })
})

describe('国家列按界面语言取值（用户 2026-11-21）', () => {
  it('英文下国家是两个字母代码、不含 CJK；中文下逐字不变', () => {
    const zh = readCalendarCodeTable(database, 'zh')
    const en = readCalendarCodeTable(database, 'en')
    if (zh.state !== 'available' || en.state !== 'available') throw new Error('expected available')
    const withCountry = en.rows.filter((row) => row.countryName !== null)
    expect(withCountry.length).toBeGreaterThan(0)
    // 英文：两位代码，且一个 CJK 都不许出现（含国名「美国」这种）。
    expect(withCountry.every((row) => /^[A-Z]{2}$/.test(row.countryName!))).toBe(true)
    expect(withCountry.filter((row) => /[\u4e00-\u9fff]/.test(row.countryName!))).toEqual([])
    // 全名不丢：仍然在 `countryNameFull` 里，供 title / aria-label。
    expect(withCountry[0]!.countryNameFull).toMatch(/^[A-Z]/)
    // 中文侧与改动前一致（中文名，不是代码）。
    const zhWithCountry = zh.rows.filter((row) => row.countryName !== null)
    expect(zhWithCountry[0]!.countryName).toMatch(/[\u4e00-\u9fff]/)
  })
})
