import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from '../marketCalendarStandardTable'
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
  for (const [periodKey, label] of [['2026-10-16T13:30', '10月纽约联储制造业指数'], ['2026-11-16T13:30', '11月纽约联储制造业指数']] as const) {
    upsertCalendarStandardRow(database, {
      countryCode: 'US', metricKey: '["214790",79090]', periodKey,
      scheduledDate: periodKey.slice(0, 10), timePrecision: 'minute' as const, status: 'backfilling' as const,
      valuesJson: '{}', identityKind: 'source' as const, sourceLabel: label,
      ...(label.startsWith('11') ? {} : {}),
      sourceProviderId: '0xrouter', sourceEventId: `x-${periodKey}`, parserVersion: 'v1', observedAt: now, firstSeenAt: now
    })
  }
  // 合并过的行带英文原文名（迁移 18 把英文那条并入 `source_label_en`）。
  database.prepare(`update mi_calendar_events set source_label_en = ?
    where source_label = '11月纽约联储制造业指数'`).run('New York Fed manufacturing index(Nov)')
  return database
}

describe('映射规则表读口', () => {
  it('已映射 85 条：字段齐、计数由服务端给、依据推不出就 null', () => {
    const read = readCalendarMappingRules(seed())
    if (read.state !== 'available') throw new Error('unavailable')
    expect(read.mapped).toHaveLength(85)
    expect(read.counts.mapped).toBe(85)
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
    expect(read.mapped.some((rule) => rule.rowCount === 0)).toBe(true)
    expect(read.mapped.every((rule) => typeof rule.rowCount === 'number' && rule.rowCount >= 0)).toBe(true)
    expect(read.mapped.every((rule) => rule.names === null
      || (rule.names.zh.trim() !== '' && rule.names.en.trim() !== ''))).toBe(true)
  })

  it('未映射段按行数从大到小排，一个 id 的多行合计成行数', () => {
    const read = readCalendarMappingRules(seed())
    if (read.state !== 'available') throw new Error('unavailable')
    expect(read.unmapped).toHaveLength(1)
    // 样本名只是「这一行长什么样」，取该 id 的第一行；**判据是行数**，不锁日期顺序。
    expect(read.unmapped[0]!.sourceId).toBe('214790')
    expect(read.unmapped[0]!.rowCount).toBe(2)
    expect(read.unmapped[0]!.sampleLabel).toContain('纽约联储制造业指数')
    // 有英文原文名就给出来（同一条 id 下有一行带就够了）：界面把它放同一格 `中文 · English`。
    expect(read.unmapped[0]!.sampleLabelEn).toBe('New York Fed manufacturing index(Nov)')
    expect(read.counts.unmapped).toBe(1)
    expect(read.counts.unmappedRows).toBe(2)
  })
})
