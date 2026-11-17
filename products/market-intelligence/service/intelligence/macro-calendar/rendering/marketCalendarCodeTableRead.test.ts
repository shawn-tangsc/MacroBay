import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { readCalendarCodeTable } from './marketCalendarCodeTableRead'

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
  it('整表下发：指标 224 / 事件 20；待补的行必须带闭集理由，有页的行必须有 URL', () => {
    const read = readCalendarCodeTable(database)
    if (read.state !== 'available') throw new Error('unavailable')
    expect(read.counts).toMatchObject({ total: 244, metric: 224, event: 20 })
    // 已经按机构补了一批（Destatis 等），所以两个数都不写死，只断关系：
    expect(read.counts.withOfficialSource).toBeGreaterThan(0)
    expect(read.counts.withOfficialSource + read.counts.pendingOfficialSource).toBe(244)
    for (const row of read.rows) {
      const source = row.officialSource
      if ('pending' in source) expect(source.reason).toBe('official-source-todo')
      // 机构页有 http 的（密歇根大学的老站就是 http），不能一律要求 https——那是格式洁癖，
      // 真正要断的是「有页就必须有 URL」，不是协议。
      else expect(/^https?:\/\//.test(source.url)).toBe(true)
    }
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
