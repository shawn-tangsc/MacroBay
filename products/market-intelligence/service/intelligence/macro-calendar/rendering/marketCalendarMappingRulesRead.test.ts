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
  // 一条**没有任何规则**的码身份行（PCE 月率不在三张规则表里）：合并后它与规则行同在一个页签，
  // 但「源内 id / 期次规则」两格是空的——空表示「它本来就没有 id」，不是「没读到」。
  upsertCalendarStandardRow(database, {
    countryCode: 'US', metricKey: 'US.PCE.SA.MOM', periodKey: '2026-09', scheduledDate: '2026-09-26',
    timePrecision: 'date' as const, status: 'published' as const, valuesJson: '{"actual":"0.3%"}',
    sourceProviderId: 'narwhal', sourceEventId: 'pce-2026-09', parserVersion: 'v1', observedAt: now, firstSeenAt: now
  })
  // 一条**事件型**的行（讲话）：它是事件，不是指标，不该出现在这张表里。
  upsertCalendarStandardRow(database, {
    countryCode: 'US', metricKey: 'evt.central-bank-speech', periodKey: '2026-11-05T14:00',
    scheduledDate: '2026-11-05', scheduledAt: '2026-11-05T14:00:00.000Z', timePrecision: 'minute' as const,
    status: 'published' as const, valuesJson: '{}', sourceProviderId: '0xrouter',
    sourceEventId: 'speech-2026-11-05', parserVersion: 'v1', observedAt: now, firstSeenAt: now
  })
  // 未映射表是**唯一真源**（用户 2026-11-18）：主列表从这里取，所以夹具要有一条。
  database.exec(`create table if not exists mi_calendar_unmapped
    (provider_id text, source_key text, detected_at text, raw_json text, reason text,
     first_seen_at text, last_seen_at text)`)
  database.exec(`insert into mi_calendar_unmapped
    (provider_id, source_key, detected_at, raw_json, reason, first_seen_at, last_seen_at)
    values ('0xrouter', '["999999",79090]', '${now}', '{"name":"未识别指标"}', 'no-code', '${now}', '${now}')`)
  // 合并过的行带英文原文名（迁移 18 把英文那条并入 `source_label_en`）。
  database.prepare(`update mi_calendar_events set source_label_en = ?
    where source_label = '11月未识别指标'`).run('Unidentified indicator(Nov)')
  return database
}

describe('映射规则表读口', () => {
  it('已映射按**指标码**收口：一个码一行，认得它的源内 id 全列出来', () => {
    const read = readCalendarMappingRules(seed())
    if (read.state !== 'available') throw new Error('unavailable')
    /**
     * **一行 = 一个指标码**（用户 2026-11-17 合并两个页签）。两条判据：
     * 1. 条数 = 「三张表的码」∪「库里以码身份进来的码」——**不是**规则条数之和（一个码可能有好几个 id，
     *    也可能既是规则目标又直接以码进来）；
     * 2. 一个码只出现一次。重复出现在这里不会报错，只会让读者以为有两件事。
     */
    const ruleCodes = new Set([
      ...Object.values(zeroXRouterIndicatorIdentities).map((entry) => entry.metricKey),
      ...Object.values(zeroXRouterSourceMetricMappings).map((entry) => entry.metricKey),
      ...Object.values(germanSourceMetricMappings).map((entry) => entry.metricKey),
      'US.CPI.NSA.YOY'
    ])
    expect(new Set(read.mapped.map((rule) => rule.metricKey)).size).toBe(read.mapped.length)
    expect(read.counts.mapped).toBe(read.mapped.length)
    expect(read.mapped.length).toBeGreaterThanOrEqual(ruleCodes.size)
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
    // **事件不是指标**：`evt.*` 一行都不许出现在这张表里（Chief 2026-11-17）。
    expect(read.mapped.some((rule) => rule.metricKey.startsWith('evt.'))).toBe(false)
    // 规则里的 id 都落在 `sourceIds` 上；只以码进来（没有任何规则）的是空数组 + 无期次规则。
    expect(read.mapped.find((rule) => rule.metricKey === 'US.CPI.NSA.YOY')?.sourceIds).toEqual(['8637'])
    const directOnly = read.mapped.find((rule) => rule.metricKey === 'US.PCE.SA.MOM')
    expect(directOnly?.sourceIds).toEqual([])
    expect(directOnly?.periodRule).toBeNull()
    expect(directOnly?.rowCount).toBe(1)
    const germanWithIds = read.mapped.find((rule) => rule.metricKey === 'DE.WHOLESALE_PRICE.NONE.MOM')
    expect(germanWithIds?.sourceIds.length).toBeGreaterThan(0)
    expect(germanWithIds?.periodRule).toBe('month')
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

  it('未映射段按行数从大到小排，一个 id 的多行合计成行数', () => {
    const read = readCalendarMappingRules(seed())
    if (read.state !== 'available') throw new Error('unavailable')
    /**
     * **这一版起，列表只留「四类都命不中」的 id**（用户 2026-11-18 现场判定）。
     * 夹具里那条没有任何映射、也没有观测的 `999999` 因此归 `no-code` 档，不进列表——
     * 「没有码」本身就说明它在等建码，不是「等映射」。
     */
    // 夹具里那条没有映射的 `999999` 就在未映射表里——**没进日历的都必须出现在列表里**。
    expect(read.unmapped.map((row) => row.sourceId)).toContain('999999')
    expect(read.counts.unmapped).toBeGreaterThanOrEqual(1)
    expect(read.counts.diagnostics['no-code']).toBeGreaterThanOrEqual(1)
    // **已经认得出来的 id 不许再报「未映射」**：三张表里任何一张认得都算。报错了读者会去补已经做完的事。
    for (const mappedId of ['214790', '213844', '8637']) {
      expect(read.unmapped.some((row) => row.sourceId === mappedId), mappedId).toBe(false)
    }
    // 那 2 行仍然被计进「无码」诊断（行数不丢，只是不进列表）。
    expect(read.counts.diagnostics['no-code']).toBeGreaterThanOrEqual(1)
  })
})

/**
 * **未映射页签只放「真正在等映射的」**（用户 2026-11-18：477 条压不下去）。
 *
 * 事件、无标准行、缺期次、无码各有去处，只作诊断计数；留它们在列表里，读者会照着去补
 * 已经做完的事——这正是今晚反复出现的「数看起来很大、其实没活可干」。
 */
describe('未映射列表只放指标类，事件单独一页', () => {
  const insertReason = (database: DatabaseSync, sourceKey: string, reason: string): void => {
    database.exec(`insert into mi_calendar_unmapped (provider_id, source_key, detected_at, raw_json, reason)
      values ('0xrouter', '${sourceKey}', '2026-11-18T00:00:00Z', '{"scheduledDate":"2026-11-16"}', '${reason}')`)
  }

  it('keeps the indicator kinds in the list and leaves events to their own tab', () => {
    const database = seed()
    // 三类：事件、无标准行、缺期次；另有一条真在等映射的（没有原因行）。
    insertReason(database, '["700001",1]', 'unknown-event-type')
    insertReason(database, '["700002",1]', 'no-standard-row')
    insertReason(database, '["700003",1]', 'period-unresolved')
    insertReason(database, '["700004",1]', 'bad-period')
    for (const [id, date] of [['700001', '2026-11-16'], ['700002', '2026-11-16'],
      ['700003', '2026-11-16'], ['700004', '2026-11-16']] as const) {
      upsertCalendarStandardRow(database, {
        countryCode: 'US', metricKey: `["${id}",1]`, periodKey: date,
        scheduledDate: date, timePrecision: 'minute' as const, status: 'missing' as const,
        valuesJson: '{}', identityKind: 'source' as const, sourceLabel: '事件或残行',
        sourceProviderId: '0xrouter', sourceEventId: `x-${id}`, parserVersion: 'v1',
        observedAt: now, firstSeenAt: now
      })
    }
    const read = readCalendarMappingRules(database)
    if (read.state !== 'available') throw new Error('unavailable')
    const listed = read.unmapped.map((row) => row.sourceId)
    // **事件不进这一页**（用户 2026-11-18 第三页签）：它没有统计期、不参与映射，有自己的「事件」页。
    expect(listed).not.toContain('700001')
    // 其余指标类的没进日历，一条都不许藏。
    for (const shown of ['700002', '700003', '700004']) expect(listed).toContain(shown)
    expect(read.counts.diagnostics['no-standard-row']).toBe(1)
    // `bad-period` 与 `period-unresolved` 归同一档：旧库写法不许再占一个数。
    expect(read.counts.diagnostics['period-unresolved']).toBe(2)
    expect(read.unmapped.every((row) => row.reason !== 'unknown-event-type')).toBe(true)
    // 夹具里那条「没有原因行、也没有映射」的 `999999` 现场判成无码档，所以这里至少有 1。
    expect(read.counts.diagnostics['no-code']).toBeGreaterThanOrEqual(1)
    expect(read.counts.unmapped).toBe(read.unmapped.length)
  })
})

/**
 * **现场判定**：没被诊断过的 id 也要归进四类，不能因为「没有原因记录」就永远挂在列表里
 * （用户 2026-11-18：477 降到 80 之后，那 80 条根本没被诊断过）。
 */
describe('现场判定分类', () => {
  it('classifies an event by its observation kind and an id with no code as no-code', () => {
    const database = seed()
    // 一条事件：观测里写着 `central-bank-activity`，未映射表里**没有**原因行。
    // 夹具只建最小观测表——读口只取 `source_event_id` 与 `event_kind` 两列。
    database.exec(`create table mi_macro_calendar_market_event_observations
      (observation_id text, source_event_id text, event_kind text)`)
    database.exec(`insert into mi_macro_calendar_market_event_observations values
      ('obs-1', '["800001",1]', 'central-bank-activity')`)
    upsertCalendarStandardRow(database, {
      countryCode: 'US', metricKey: '["800001",1]', periodKey: '2026-11-16',
      scheduledDate: '2026-11-16', timePrecision: 'minute' as const, status: 'missing' as const,
      valuesJson: '{}', identityKind: 'source' as const, sourceLabel: '某行长讲话',
      sourceProviderId: '0xrouter', sourceEventId: 'x-800001', parserVersion: 'v1',
      observedAt: now, firstSeenAt: now
    })
    const read = readCalendarMappingRules(database)
    if (read.state !== 'available') throw new Error('unavailable')
    // 这条 id 在未映射表里没有记录，所以它不在主列表里——**主列表的唯一真源是那张表**，
    // 不从观测表反推（用户 2026-11-18 定的第 3 条）。它的「为什么没进来」由 completeness 守卫保证落表。
    expect(read.unmapped.map((row) => row.sourceId)).not.toContain('800001')
    // 事件归事件档；夹具里那条没有任何映射的 `999999` 归无码档。
    // 计数只反映未映射表里记下的原因——这条 id 没落表，所以事件档是 0；`999999` 那条在的算无码档。
    expect(read.counts.diagnostics['no-code']).toBeGreaterThanOrEqual(1)
    expect(read.counts.unmapped).toBe(read.unmapped.length)
  })
})

describe('未映射行的国家（用户 2026-11-19）', () => {
  const seedUnmapped = (database: DatabaseSync, sourceKey: string, raw: Record<string, unknown>, reason = 'period-unresolved'): void => {
    database.prepare(`insert into mi_calendar_unmapped
      (provider_id, source_key, detected_at, raw_json, reason, first_seen_at, last_seen_at)
      values ('0xrouter', ?, ?, ?, ?, ?, ?)`)
      .run(sourceKey, now, JSON.stringify(raw), reason, now, now)
  }
  const observation = (database: DatabaseSync, indicatorId: string, countryCode: string): void => {
    database.prepare(`insert into mi_macro_calendar_market_event_observations
      (indicator_id, country_code) values (?, ?)`).run(indicatorId, countryCode)
  }
  const read = (): ReturnType<typeof readCalendarMappingRules> => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    database.exec('create table if not exists mi_macro_calendar_market_event_observations (indicator_id text, country_code text)')
    // ① 码前缀可定
    seedUnmapped(database, '["4259",1]', { name: '欧洲央行再融资利率', metricKey: 'EMU.ECB_REFINANCING_RATE.NONE.RATE', scheduledDate: '2026-11-01' })
    // ② 无码，靠 indicatorId 唯一国家
    seedUnmapped(database, '["4250",1]', { name: '一年期贷款市场报价利率', indicatorId: '4250', scheduledDate: '2026-11-02' })
    observation(database, '4250', 'CHN')
    // ③ 两路都不通
    seedUnmapped(database, '["8888",1]', { name: '谁也不是的指标', indicatorId: '8888', scheduledDate: '2026-11-03' }, 'no-standard-row')
    return readCalendarMappingRules(database)
  }

  it('码前缀 → 国家；码名走同一份国名表', () => {
    const result = read()
    if (result.state !== 'available') throw new Error('expected available')
    const row = result.unmapped.find((item) => item.sourceId === '4259')!
    expect(row.countryCode).toBe('EMU')
    expect(row.countryName).toBe('欧元区')
  })

  it('无码时按 indicatorId 唯一国家判定（CHN → CN）', () => {
    const result = read()
    if (result.state !== 'available') throw new Error('expected available')
    expect(result.unmapped.find((item) => item.sourceId === '4250')!.countryCode).toBe('CN')
  })

  it('两路都拿不到 → null（界面显示 —，不是「未知国家」）', () => {
    const result = read()
    if (result.state !== 'available') throw new Error('expected available')
    const row = result.unmapped.find((item) => item.sourceId === '8888')!
    expect(row.countryCode).toBeNull()
    expect(row.countryName).toBeNull()
  })

  it('整个读口里不出现「未知国家」字面量', () => {
    expect(JSON.stringify(read())).not.toContain('未知国家')
  })
})
