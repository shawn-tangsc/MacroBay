import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, recordCalendarUnmapped, upsertCalendarStandardRow } from './marketCalendarStandardTable'
import { listUnmappedCalendarObservationsForRendering } from './marketCalendarUnmappedMonthRead'

/**
 * 「未映射观测」只读接口的两条判据（2026-11-16）：
 * ① 它属于日历渲染，**并进了标准表就必须消失**（否则读者看到同一件事两遍）；
 * ② 它是**明示的口子**：只在日历组件里显示，不进简报、不进 AI 分析（用户原话）。
 */
const seed = (database: DatabaseSync) => {
  ensureCalendarStandardTables(database)
  // 缺国家的观测：由转换写进未映射表（原因 missing-country）。
  recordCalendarUnmapped(database, {
    providerId: '0xrouter', sourceKey: 'no-country-1', detectedAt: '2026-11-16T00:00:00.000Z',
    reason: 'missing-country',
    rawJson: JSON.stringify({ name: 'ECB speech', eventKind: 'central-bank-activity',
      scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T12:00:00.000Z' })
  })
}

describe('未映射观测的月读（仅渲染层）', () => {
  it('缺国家的观测出现在它那一天：日期/时刻/标题/类型/原因都在，国家原值不映射', () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    const read = listUnmappedCalendarObservationsForRendering(database, { month: '2026-11' })
    expect(read.entries).toHaveLength(1)
    expect(read.entries[0]).toMatchObject({
      key: '0xrouter:no-country-1',
      reason: 'missing-country',
      title: 'ECB speech',
      scheduledDate: '2026-11-10',
      scheduledAt: '2026-11-10T12:00:00.000Z',
      timePrecision: 'minute',
      eventType: 'central-bank-activity'
    })
    // 只有日期的那种：不编时刻。
    const dateOnly = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(dateOnly)
    recordCalendarUnmapped(dateOnly, {
      providerId: '0xrouter', sourceKey: 'date-only', detectedAt: '2026-11-16T00:00:00.000Z',
      reason: 'missing-country',
      rawJson: JSON.stringify({ name: 'GDP final', eventKind: 'economic-indicator', scheduledDate: '2026-11-05' })
    })
    const [entry] = listUnmappedCalendarObservationsForRendering(dateOnly, { month: '2026-11' }).entries
    expect(entry!.timePrecision).toBe('date')
    expect(entry!.scheduledAt).toBeUndefined()
  })

  it('并进标准表后必须消失（同 source_event_id 已有标准行 → 不算未映射）', () => {
    const database = new DatabaseSync(':memory:')
    seed(database)
    expect(listUnmappedCalendarObservationsForRendering(database, { month: '2026-11' }).entries).toHaveLength(1)
    // 观测补上国家后重跑转换：同一发布以同一个 id 落进标准表。
    upsertCalendarStandardRow(database, {
      countryCode: 'US', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10', scheduledDate: '2026-11-10',
      timePrecision: 'minute', scheduledAt: '2026-11-10T12:00:00.000Z', status: 'published',
      valuesJson: '{"actual":"3.7"}', sourceProviderId: '0xrouter', sourceEventId: 'no-country-1',
      parserVersion: 'v1', observedAt: '2026-11-16T00:00:00.000Z', firstSeenAt: '2026-11-16T00:00:00.000Z'
    })
    const after = listUnmappedCalendarObservationsForRendering(database, { month: '2026-11' })
    expect(after.entries).toHaveLength(0)
    // 不是悄悄丢掉：单独报「已被标准表接管」的条数，守恒式能解释。
    expect(after.superseded).toBe(1)
  })

  it('缺日期的未映射行给出条数，不悄悄丢', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    recordCalendarUnmapped(database, {
      providerId: 'narwhal', sourceKey: 'no-date-1', detectedAt: '2026-11-16T00:00:00.000Z',
      reason: 'bad-identity', rawJson: JSON.stringify({ name: 'mystery release' })
    })
    const read = listUnmappedCalendarObservationsForRendering(database, { month: '2026-11' })
    expect(read.entries).toHaveLength(0)
    expect(read.undated).toBe(1)
  })
})

describe('边界：未映射观测只给日历渲染（不进简报、不进 AI 分析）', () => {
  it('简报与分析侧的依赖文件里不出现这个接口', () => {
    // 用户 2026-11-16：非标准表的数据只在日历组件里显示，不会被简报生成、也不进 AI 分析。
    // 反向红：把 import 加进其中任一文件 → 立刻红。
    const forbidden = [
      'products/market-intelligence/service/intelligence/daily-briefing/dailyBriefingSource.ts',
      'products/market-intelligence/service/intelligence/daily-briefing/dailyBriefingFactPacket.ts',
      'products/market-intelligence/service/intelligence/public-query/marketAnalysisContextProjection.ts',
      'products/market-intelligence/service/intelligence/macro-calendar/0xrouter-calendar/marketCalendarPublicQueryService.ts'
    ]
    const offenders: string[] = []
    for (const file of forbidden) {
      let source: string
      try { source = readFileSync(resolve(process.cwd(), file), 'utf8') } catch { continue }
      if (source.includes('listUnmappedCalendarObservationsForRendering') || source.includes('marketCalendarUnmappedMonthRead')) {
        offenders.push(file)
      }
    }
    expect(offenders).toHaveLength(0)
  })
})
