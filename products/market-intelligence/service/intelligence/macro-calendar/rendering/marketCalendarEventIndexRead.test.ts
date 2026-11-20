import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, upsertCalendarStandardRow } from '../marketCalendarStandardTable'
import { readCalendarEventIndex } from './marketCalendarEventIndexRead'

/**
 * 事件清单读口（渲染专用）的三条判据（Chief 2026-11-16）：
 * ① 空数组只表示「没有匹配」，读不到给 `unavailable`；
 * ② `total` = 实际可翻到的行数（把页翻完，行数之和等于 total）；
 * ③ 游标排序带**唯一 tiebreaker**：同日事件很多，只按日期排会翻出重复或漏行。
 */
const today = '2026-11-16'

const row = (metricKey: string, periodKey: string, scheduledDate: string, extra: Partial<Parameters<typeof upsertCalendarStandardRow>[1]> = {}) => ({
  countryCode: 'US', metricKey, periodKey, scheduledDate, timePrecision: 'date' as const,
  status: 'published' as const, valuesJson: '{"actual":"1"}', sourceProviderId: 'narwhal',
  sourceEventId: `${metricKey}|${periodKey}`, parserVersion: 'v1',
  observedAt: `${scheduledDate}T00:00:00.000Z`, firstSeenAt: `${scheduledDate}T00:00:00.000Z`, ...extra
})

function seed(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  // 三个事件，其中两个「最近一次发布」在同一天——这正是 tiebreaker 要处理的那批。
  upsertCalendarStandardRow(database, row('US.CPI.NSA.YOY', '2026-09', '2026-10-10'))
  upsertCalendarStandardRow(database, row('US.CPI.NSA.YOY', '2026-10', '2026-11-10'))
  upsertCalendarStandardRow(database, row('US.NONFARM.SA.CHANGE', '2026-10', '2026-11-10'))
  upsertCalendarStandardRow(database, row('US.UNEMPLOYMENT.SA.RATE', '2026-10', '2026-11-10', { countryCode: 'USA' }))
  // 未来一期：作为 nextRelease
  upsertCalendarStandardRow(database, row('US.CPI.NSA.YOY', '2026-11', '2026-12-10', { status: 'scheduled', valuesJson: '{}' }))
  // 没有名表条目的身份：只有源原文名。
  upsertCalendarStandardRow(database, row('["212058",70663]', '2026-09', '2026-10-01', {
    countryCode: 'DE', identityKind: 'source', sourceLabel: 'transmutation in seasonally adjusted unemployment'
  }))
  return database
}

describe('事件清单读口（一行一个事件身份）', () => {
  it('一个身份一行；最近一次发布与下一次发布都带上（不是把发布展开）', () => {
    const read = readCalendarEventIndex(seed(), { today })
    expect(read.state).toBe('available')
    if (read.state !== 'available') return
    expect(read.total).toBe(4)   // CPI 三期合成一行：事件=身份，不按期展开
    const cpi = read.rows.find((entry) => entry.metricKey === 'US.CPI.NSA.YOY')!
    expect(cpi.lastRelease?.date).toBe('2026-11-10')
    expect(cpi.nextRelease?.date).toBe('2026-12-10')
    expect(cpi.period).toBe('2026-10')
    expect(cpi.zhShort).toBeDefined()
    expect(cpi.enShort).toBeDefined()   // 一对名字都给（中英过滤要用）
    // 没有名表条目的：退回源原文名，并标出来
    const fallback = read.rows.find((entry) => entry.titleIsSourceLabel)!
    expect(fallback.sourceLabel).toContain('transmutation')
    expect(fallback.zhShort).toBeUndefined()
  })

  it('分页：翻到底的行数之和 = total，同一天的事件不重复也不漏', () => {
    const database = seed()
    const seen: string[] = []
    let cursor: string | undefined
    let total = 0
    for (let page = 0; page < 10; page += 1) {
      const read = readCalendarEventIndex(database, { today, pageSize: 2, ...(cursor === undefined ? {} : { cursor }) })
      if (read.state !== 'available') throw new Error('unavailable')
      total = read.total
      seen.push(...read.rows.map((entry) => entry.key))
      if (read.nextCursor === undefined) break
      cursor = read.nextCursor
    }
    expect(seen).toHaveLength(total)                 // ② 行数之和 = total
    expect(new Set(seen).size).toBe(seen.length)     // ③ 没有重复（tiebreaker 生效）
  })

  it('筛选：中英名都能搜到；国家独立筛；空数组只表示「没有匹配」', () => {
    const database = seed()
    // 中文简称搜
    expect(readCalendarEventIndex(database, { today, nameQuery: '非农' })).toMatchObject({ state: 'available' })
    // 英文也搜得到（大小写不敏感）
    const english = readCalendarEventIndex(database, { today, nameQuery: 'payrolls' })
    expect(english.state === 'available' && english.rows.length).toBe(1)
    // 国家独立筛（不混进名字框）
    const de = readCalendarEventIndex(database, { today, countryCode: 'DE' })
    expect(de.state === 'available' && de.total).toBe(1)
    // 搜不到 = 空数组（available），不是 unavailable
    expect(readCalendarEventIndex(database, { today, nameQuery: 'zzz-不存在' }))
      .toMatchObject({ state: 'available', rows: [], total: 0 })
  })
})

describe('源内身份的中英两条合成一条（读取层去重，不动库）', () => {
  it('同一数组指标 id + 同期的中英两行 → 一条；中文名优先，英文原文仍可搜到', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 真实形状：源对同一件事发了中文名与英文名两条，metric_key 的第一段都是 214790。
    upsertCalendarStandardRow(database, { ...row('["214790",79090]', '2026-11-16T13:30', '2026-11-16', {
      countryCode: 'US', identityKind: 'source', sourceLabel: '11月纽约联储制造业指数'
    }), sourceEventId: 'zh-214790' })
    upsertCalendarStandardRow(database, { ...row('["214790",79095]', '2026-11-16T13:30', '2026-11-16', {
      countryCode: 'US', identityKind: 'source', sourceLabel: 'New York Fed manufacturing Index(Nov)'
    }), sourceEventId: 'en-214790' })
    const read = readCalendarEventIndex(database, { today })
    if (read.state !== 'available') throw new Error('unavailable')
    expect(read.total).toBe(1)                       // 两条 → 一条
    expect(read.rows[0]!.zhShort ?? read.rows[0]!.sourceLabel).toContain('纽约联储')   // 中文优先
    // 英文名单独给一个字段（界面用小字灰字跟在中文后面）；中文名那条做显示，英文名来自合并时留下的原文。
    expect(read.rows[0]!.titleEn ?? '').toContain('New York Fed manufacturing Index')
    // 英文原文保留下来可搜（否则读者按英文名找不到这条）
    const english = readCalendarEventIndex(database, { today, nameQuery: 'New York Fed' })
    expect(english.state === 'available' && english.rows.length).toBe(1)
    // 中文也搜得到
    const chinese = readCalendarEventIndex(database, { today, nameQuery: '纽约联储' })
    expect(chinese.state === 'available' && chinese.rows.length).toBe(1)
  })
})

describe('德国数组身份：只补显示名，不动身份', () => {
  it('源内名表命中 → 显示我们的中英名；`metric_key` 一个字都不变', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const german = row('["9553",79010]', '2026-10-14T07:00', '2026-10-14', {
      countryCode: 'DE', identityKind: 'source', sourceLabel: 'transmutation in seasonally adjusted unemployment'
    })
    upsertCalendarStandardRow(database, german)
    const read = readCalendarEventIndex(database, { today })
    if (read.state !== 'available') throw new Error('unavailable')
    const [entry] = read.rows
    // 名字来自源内身份名表（不是机翻残句），英文也能搜
    expect(entry!.zhShort).toBe('批发物价指数(年率)')
    expect(entry!.enFull).toBe('Wholesale Price Index (YoY)')
    // 身份名表只给中英各一条，读侧要的是**四列都有**（全称/简称各自成列，搜索命中列按列判）：
    // 这一条钉住「两条名字 → 四列」这处转换，别让它以后只填中文或只填全称。
    expect([entry!.zhFull, entry!.enShort]).toEqual(['批发物价指数(年率)', 'Wholesale Price Index (YoY)'])
    // **身份没动**：`metric_key` 仍是源给的那个数组
    expect(entry!.metricKey).toBe('["9553",79010]')
    expect(readCalendarEventIndex(database, { today, nameQuery: 'wholesale price' }).state).toBe('available')
  })
})

describe('详情那一行的「指标层级」', () => {
  it('子项给所属指标的中文名；母项给出分项并按词表序；普通指标整段不给', async () => {
    const { hierarchyForMetricKey } = await import('../marketCalendarZeroXRouterSourceMappings')
    expect(hierarchyForMetricKey('US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL'))
      .toEqual({ kind: 'child', parentName: '费城联储制造业' })
    const parent = hierarchyForMetricKey('US.PHILLY_FED_MANUFACTURING.SA.LEVEL')
    expect(parent?.kind).toBe('parent')
    // 词表序：装船 → 新订单 → 物价支付 → 物价获得（不是按字母、也不是按行数）
    expect(parent?.childNames).toEqual(['费城联储制造业装船', '费城联储制造业新订单', '费城联储制造业物价支付', '费城联储制造业物价获得'])
    // 普通指标没有层级：界面整行不显示，不画空标签。
    expect(hierarchyForMetricKey('US.CPI.NSA.YOY')).toBeUndefined()
  })
})
