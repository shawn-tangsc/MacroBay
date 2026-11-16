import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { germanSourceMetricMappings } from '../marketCalendarGermanSourceMappings'
import { zeroXRouterIndicatorIdentities } from '../marketCalendarMetricIdentity'
import { ensureCalendarStandardTables, upsertCalendarStandardRow } from '../marketCalendarStandardTable'
import { zeroXRouterSourceMetricMappings } from '../marketCalendarZeroXRouterSourceMappings'
import { readCalendarMappingRules } from './marketCalendarMappingRulesRead'

/**
 * 映射规则表读口（用户 2026-11-16 要看的那张表）：两段 + 三个计数 + 官方查看地址。
 *
 * 边界：`basis`/`officialUrl` **推不出就必须 null**（不许拿聚合站或猜的页凑）；
 * `unmapped` 由服务端按行数排好；计数由服务端给（前端不自己数，否则筛选后标题会对不上）。
 */
const now = '2026-11-16T14:00:00.000Z'

function seed(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  // 一个数组身份、两期（同一指标发布了两次）：未映射段按**行数**计，仍只出一个 id。
  // 第二行带英文原文名（迁移 18 合并后存在 `source_label_en`），用来断「样本名中英都给」。
  // 中英两条已经在写入端与迁移 18 合成一行，不再拿它当「两行」的样本。
  for (const [periodKey, label] of [['2026-10-16T13:30', '10月未识别指标'], ['2026-11-16T13:30', '11月未识别指标']] as const) {
    upsertCalendarStandardRow(database, {
      countryCode: 'US', metricKey: '["999999",79090]', periodKey,
      scheduledDate: periodKey.slice(0, 10), timePrecision: 'minute' as const, status: 'backfilling' as const,
      valuesJson: '{}', identityKind: 'source' as const, sourceLabel: label,
      ...(label.startsWith('11') ? {} : {}),
      sourceProviderId: '0xrouter', sourceEventId: `x-${periodKey}`, parserVersion: 'v1', observedAt: now, firstSeenAt: now
    })
  }
  // 一条**指标码身份**的行：`rowCount` 按指标码数，CPI 年率那条必须数到它。
  upsertCalendarStandardRow(database, {
    countryCode: 'US', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-09', scheduledDate: '2026-10-15',
    timePrecision: 'date' as const, status: 'published' as const, valuesJson: '{"actual":"3.7%"}',
    sourceProviderId: 'narwhal', sourceEventId: 'cpi-2026-09', parserVersion: 'v1', observedAt: now, firstSeenAt: now
  })
  // 合并过的行带英文原文名（迁移 18 把英文那条并入 `source_label_en`）。
  database.prepare(`update mi_calendar_events set source_label_en = ?
    where source_label = '11月未识别指标'`).run('Unidentified indicator(Nov)')
  return database
}

describe('映射规则表读口', () => {
  it('已映射 = 三张表之和（旧表 85 + 0xrouter 32 + 德国 71）：字段齐、计数由服务端给、依据推不出就 null', () => {
    const read = readCalendarMappingRules(seed())
    if (read.state !== 'available') throw new Error('unavailable')
    // **按来源各一张表**：读口只做并集，条数就是三张表之和（不写死数字，表一长就该跟着长）。
    expect(read.counts.mapped).toBe(Object.keys(zeroXRouterIndicatorIdentities).length
      + Object.keys(zeroXRouterSourceMetricMappings).length
      + Object.keys(germanSourceMetricMappings).length)
    expect(read.mapped).toHaveLength(read.counts.mapped)
    // BLS 的 CPI 有官方页（机构 + 页面类型能推），ISM 那类推不出必须 null
    const cpi = read.mapped.find((rule) => rule.metricKey === 'US.CPI.NSA.YOY')!
    expect(cpi.officialUrl).toBe('https://www.bls.gov/news.release/')
    expect(cpi.basis).toContain('BLS')
    const ism = read.mapped.find((rule) => rule.metricKey === 'US.ISM_MANUFACTURING.SA.LEVEL')!
    expect(ism.officialUrl).toBeNull()
    expect(ism.basis).toBeNull()
    // 中英名：`zh` 取简称、`en` 取全名；名表没有的码必须是 null，不许拿码拼。
    expect(cpi.names).toEqual({ zh: 'CPI 年率', en: 'Consumer Price Index (CPI), YoY' })
    expect(ism.names).toEqual({ zh: 'ISM 制造业 PMI', en: 'ISM Manufacturing PMI' })
    // 分级与覆盖行数：分级读现有表（CPI 是一级），行数真读库——85 条里必然有 0。
    expect(cpi.tier).toBe(1)
    // 行数按**指标码**数：CPI 年率那条在库里有多行（不是按源内 id 数出来的 0）。
    expect(cpi.rowCount).toBeGreaterThan(0)
    // 同时也真有 0 的（那个指标的库行还没出现）——这一列是真读出来的，不是常量。
    expect(read.mapped.some((rule) => rule.rowCount === 0)).toBe(true)
    expect(read.mapped.every((rule) => typeof rule.rowCount === 'number' && rule.rowCount >= 0)).toBe(true)
    // 子项码有上级、母码没有：费城联储装船 → 费城联储制造业。
    const shipments = read.mapped.find((rule) => rule.metricKey === 'US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL')
    expect(shipments?.parentMetricKey).toBe('US.PHILLY_FED_MANUFACTURING.SA.LEVEL')
    expect(shipments?.kind).toBe('child')
    // 子项内部按词表顺序排：装船(0) 在新订单(1) 之前，界面不用自己写一份中文词表。
    expect(shipments?.childOrder).toBe(0)
    expect(read.mapped.find((rule) => rule.metricKey === 'US.PHILLY_FED_MANUFACTURING.NEW_ORDERS.SA.LEVEL')?.childOrder).toBe(1)
    expect(read.mapped.find((rule) => rule.metricKey === 'US.CPI.NSA.YOY')?.parentMetricKey).toBeNull()
    expect(read.mapped.every((rule) => rule.names === null
      || (rule.names.zh.trim() !== '' && rule.names.en.trim() !== ''))).toBe(true)
  })

  it('无需映射那一段：直接带指标码进来的指标，带分级与行数，事件码不算', () => {
    const read = readCalendarMappingRules(seed())
    if (read.state !== 'available') throw new Error('unavailable')
    // 夹具里的 CPI 码行就是「不需要规则也能进来」的那类。
    const direct = read.direct ?? []
    expect(direct.map((entry) => entry.metricKey)).toContain('US.CPI.NSA.YOY')
    const cpi = direct.find((entry) => entry.metricKey === 'US.CPI.NSA.YOY')!
    expect(cpi).toMatchObject({ rowCount: 1, tier: 1 })
    expect(cpi.names?.zh).toBe('CPI 年率')
    expect(read.counts.direct).toBe(direct.length)
    // 数组身份（源内 id）和事件码都不该出现在这一段。
    expect(direct.some((entry) => entry.metricKey.startsWith('[') || entry.metricKey.startsWith('evt.'))).toBe(false)
  })

  it('未映射段按行数从大到小排，一个 id 的多行合计成行数', () => {
    const read = readCalendarMappingRules(seed())
    if (read.state !== 'available') throw new Error('unavailable')
    expect(read.unmapped).toHaveLength(1)
    // 样本名只是「这一行长什么样」，取该 id 的第一行；**判据是行数**，不锁日期顺序。
    expect(read.unmapped[0]!.sourceId).toBe('999999')
    expect(read.unmapped[0]!.rowCount).toBe(2)
    expect(read.unmapped[0]!.sampleLabel).toContain('未识别指标')
    // 有英文原文名就给出来（同一条 id 下有一行带就够了）：界面把它放同一格 `中文 · English`。
    expect(read.unmapped[0]!.sampleLabelEn).toBe('Unidentified indicator(Nov)')
    // **已经认得出来的 id 不许再报「未映射」**：三张表里任何一张认得都算。报错了读者会去补已经做完的事。
    for (const mappedId of ['214790', '213844', '8637']) {
      expect(read.unmapped.some((row) => row.sourceId === mappedId), mappedId).toBe(false)
    }
    expect(read.counts.unmapped).toBe(1)
    expect(read.counts.unmappedRows).toBe(2)
  })
})
