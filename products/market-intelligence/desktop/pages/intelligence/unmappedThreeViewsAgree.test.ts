import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables } from '../../../service/intelligence/macro-calendar/marketCalendarStandardTable'
import { groupUnmappedByRelease } from '../../../service/intelligence/macro-calendar/marketCalendarUnmappedGrouping'
import { readCalendarMappingRules } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import { listUnmappedCalendarObservationsForRendering } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarUnmappedMonthRead'
import { unmappedExportRows } from './mappingRulesExport'

/**
 * **三处一致守卫**（Chief 2026-11-18）：抽屉列表、弹框列表（含页签计数）、导出条数必须是同一个数，
 * 且等于 `groupUnmappedByRelease` 的结果长度。
 *
 * 为什么需要它：今晚真实出现过「抽屉 168、弹框 325」——同一个库里同一批数据，两个页面两个数，
 * 读者只能以为其中一个算错了。根因是合并逻辑接了两处、漏了第三处；任何只接两处的改动，
 * 这条用例当场变红。
 *
 * 放在渲染层（不是 service）：它同时读抽屉读口、弹框读口与导出，那是「界面这一侧的三处」；
 * service 侧不依赖桌面代码。
 *
 * 夹具刻意**不创建标准行**：抽屉那条读口会把「已有标准行」的 id 当成已转正而不再列出，
 * 那是另一条规则（并进标准表就必须消失）。这里验的是三处取数口径一致，不是那条。
 */
function seed(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  const insert = (sourceKey: string, name: string, scheduledAt: string | null, reason: string): void => {
    database.prepare(`insert into mi_calendar_unmapped
      (provider_id, source_key, detected_at, raw_json, reason, first_seen_at, last_seen_at)
      values ('0xrouter', ?, '2026-11-16T00:00:00.000Z', ?, ?, '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z')`)
      .run(sourceKey, JSON.stringify({
        name, eventKind: 'economic-indicator', scheduledDate: '2026-11-10',
        ...(scheduledAt === null ? {} : { scheduledAt }), indicatorId: sourceKey.split('"')[1]
      }), reason)
  }
  // 两个 id、各中英两条（同一场发布）→ 2 件；第三个 id 只有一条 → 1 件。共 5 行、3 件。
  insert('["700001",1]', '10 月工业产出', '2026-11-10T12:00:00.000Z', 'period-unresolved')
  insert('["700001",2]', 'Industrial production', '2026-11-10T12:00:00.000Z', 'no-standard-row')
  insert('["700002",1]', '10 月零售销售', '2026-11-11T12:00:00.000Z', 'period-unresolved')
  insert('["700002",2]', 'Retail sales', '2026-11-11T12:00:00.000Z', 'period-unresolved')
  insert('["700003",1]', '9 月贸易帐', '2026-11-12T12:00:00.000Z', 'no-code')
  return database
}


describe('未映射：抽屉、弹框、导出三处同一个数', () => {
  it('agrees on the item count and on groupUnmappedByRelease', () => {
    const database = seed()
    // 期望值独立算一次：从夹具本身过一遍唯一分组入口，不从任何一个读口反推。
    const expected = groupUnmappedByRelease([
      { sourceId: '700001', scheduledAt: '2026-11-10T12:00:00.000Z', scheduledDate: '2026-11-10', title: '10 月工业产出', reason: 'period-unresolved', hasStandardRow: false },
      { sourceId: '700001', scheduledAt: '2026-11-10T12:00:00.000Z', scheduledDate: '2026-11-10', title: 'Industrial production', reason: 'no-standard-row', hasStandardRow: false },
      { sourceId: '700002', scheduledAt: '2026-11-11T12:00:00.000Z', scheduledDate: '2026-11-10', title: '10 月零售销售', reason: 'period-unresolved', hasStandardRow: false },
      { sourceId: '700002', scheduledAt: '2026-11-11T12:00:00.000Z', scheduledDate: '2026-11-10', title: 'Retail sales', reason: 'period-unresolved', hasStandardRow: false },
      { sourceId: '700003', scheduledAt: '2026-11-12T12:00:00.000Z', scheduledDate: '2026-11-10', title: '9 月贸易帐', reason: 'no-code', hasStandardRow: false }
    ]).length
    expect(expected).toBe(3)

    // ① 抽屉列表
    const drawer = listUnmappedCalendarObservationsForRendering(database, { month: '2026-11' }).entries.length
    // ② 弹框列表 + 页签计数
    const dialog = readCalendarMappingRules(database)
    if (dialog.state !== 'available') throw new Error('unavailable')
    const list = dialog.unmapped.length
    const tabCount = dialog.counts.unmapped
    // ③ 导出（表头 + 行；导出复用弹框读口的结果，不在导出里再 filter 一次）
    const exported = unmappedExportRows(dialog.unmapped, {
      columns: { sourceId: 'id', reason: '原因', firstSeen: '首次出现', providers: '来源', sample: '标题原文', rows: '行数' },
      reasons: {}, reasonUnknown: '无法确认', firstSeenUnknown: '无法确认',
      formatTime: (instant) => instant
    }).length - 1

    expect({ drawer, list, tabCount, exported })
      .toEqual({ drawer: expected, list: expected, tabCount: expected, exported: expected })
  })

  it('merges the bilingual pair into one row with both titles and one reason', () => {
    const read = readCalendarMappingRules(seed())
    if (read.state !== 'available') throw new Error('unavailable')
    const pair = read.unmapped.find((row) => row.sourceId === '700001')
    expect(pair, '中英两条应当并成一行').toBeDefined()
    // 名字中英并列，原因只写一条（没标准行 → 没进标准表），不是先到那条的原因。
    expect(pair!.sampleLabel).toBe('10 月工业产出 · Industrial production')
    expect(pair!.reason).toBe('no-standard-row')
    // 单条保持自己的真实原因：`no-code` 不许被改写成别的。
    expect(read.unmapped.find((row) => row.sourceId === '700003')?.reason).toBe('no-code')
  })
})