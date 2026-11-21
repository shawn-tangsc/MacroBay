import { describe, expect, it } from 'vitest'

import { codeTableReasonSets, marketCalendarCodeTable, validateCodeTableRows } from './marketCalendarCodeTable'
import { zeroXRouterIndicatorIdentities } from './marketCalendarMetricIdentity'
import { zeroXRouterSourceMetricMappings } from './marketCalendarZeroXRouterSourceMappings'
import { germanSourceMetricMappings } from './marketCalendarGermanSourceMappings'
import { zeroXRouterEventIdentities } from './marketCalendarEventIdentities'
import { eventTypeNameByCode } from './marketCalendarCodeNames'

/**
 * **码表是唯一真源，映射表跟着它走**（用户 2026-11-17）。
 *
 * 三条守卫，任一不合就红：
 * 1. 映射表里的每个码都必须在码表里——反过来「码表里没有的码」不许出现在任何映射表；
 * 2. 每一行必须有 4 个名称、`measure`/`seasonality` 非空、`officialSource` 要么是机构页、
 *    要么是 `pending` + 理由（**不许静默为 null**）；
 * 3. 事件身份（`evt.*`）的 `kind` 必须是 `event`，且不参与分级（`tier` 为 null）。
 */
const rows = Object.values(marketCalendarCodeTable)

describe('标准码表', () => {
  it('映射表里的码全部在码表里（反向也不许有孤儿）', () => {
    const mappedCodes = [
      ...Object.values(zeroXRouterIndicatorIdentities).map((entry) => entry.metricKey),
      ...Object.values(zeroXRouterSourceMetricMappings).map((entry) => entry.metricKey),
      ...Object.values(germanSourceMetricMappings).map((entry) => entry.metricKey),
    ]
    const missing = [...new Set(mappedCodes)].filter((code) => marketCalendarCodeTable[code] === undefined)
    expect(missing, `映射表用了码表里没有的码：${missing.slice(0, 5).join(', ')}`).toEqual([])
    // **事件类型码不在码表里**（2026-11-18 Chief 定）：`evt.*` 是「一类」，不是「一场」，
    // 没有单一主办国；它们的名字由事件码表提供，码表只放带国家的指标行。这里核对它们都有名字。
    const eventCodes = [...new Set(Object.values(zeroXRouterEventIdentities).map((entry) => entry.metricKey))]
    const nameless = eventCodes.filter((code) => eventTypeNameByCode[code] === undefined)
    expect(nameless, `事件类型码没有名字：${nameless.slice(0, 5).join(', ')}`).toEqual([])
  })

  it('码表里的指标行必须有国家码（事件类型不要求：它们的国家由具体事件提供）', () => {
    const bare = Object.values(marketCalendarCodeTable)
      .filter((row) => row.kind === 'metric' && (row.countryCode === null || row.countryCode === ''))
      .map((row) => row.code)
    expect(bare, `指标行缺国家码：${bare.slice(0, 5).join(', ')}`).toEqual([])
    const unknownEvent = Object.values(marketCalendarCodeTable)
      .filter((row) => row.kind === 'event' && (row.countryCode === null || row.countryCode === ''))
      .map((row) => row.code)
    // 事件行如果在码表里，就必须是具体的、有主办机构的（`evt.fomc`），类型码不许留在码表里。
    expect(unknownEvent, `码表里留了没有国家的事件类型码：${unknownEvent.slice(0, 5).join(', ')}`).toEqual([])
  })

  it('每行四个名称、测度与季调档非空、官网页不许静默为 null', () => {
    const problems: string[] = []
    for (const row of rows) {
      for (const field of ['zhFull', 'zhShort', 'enFull', 'enShort'] as const) {
        if (row.names[field].trim() === '') problems.push(`${row.code} 缺 ${field}`)
      }
      if (row.measure.trim() === '') problems.push(`${row.code} 缺 measure`)
      if (row.seasonality.trim() === '') problems.push(`${row.code} 缺 seasonality`)
      const source = row.officialSource
      const ok = ('pending' in source && source.pending === true && source.reason.trim() !== '')
        || (!('pending' in source) && source.url.trim() !== '')
      if (!ok) problems.push(`${row.code} 官网页既不是机构页也不是 pending+理由`)
    }
    expect(problems.slice(0, 8)).toEqual([])
  })

  it('状态只取四个值，理由必须与状态匹配，且不许留自由文本占位', () => {
    const STATUSES = ['active', 'not-built', 'pending', 'retired'] as const
    const problems: string[] = []
    for (const row of rows) {
      if (!(STATUSES as readonly string[]).includes(row.status)) problems.push(`${row.code} 状态非法：${row.status}`)
      if (row.status === 'active' && row.reason !== undefined) problems.push(`${row.code} active 不该带理由`)
      if (row.status === 'not-built'
        && !(codeTableReasonSets['not-built'] as readonly string[]).includes(row.reason ?? '')) {
        problems.push(`${row.code} not-built 的理由不在闭集里：${row.reason ?? '(缺)'}`)
      }
      if (row.status === 'pending'
        && !(codeTableReasonSets.pending as readonly string[]).includes(row.reason ?? '')) {
        problems.push(`${row.code} pending 的理由不在闭集里：${row.reason ?? '(缺)'}`)
      }
      if (row.status === 'retired' && (row.supersededBy ?? '') === '') problems.push(`${row.code} retired 缺 supersededBy`)
      // 官网页待补理由同样取自闭集，不许是占位句子。
      const source = row.officialSource
      if ('pending' in source && !(codeTableReasonSets.pending as readonly string[]).includes(source.reason)) {
        problems.push(`${row.code} 官网页待补理由不在闭集里：${source.reason}`)
      }
    }
    expect(problems.slice(0, 8)).toEqual([])
    // 闭集本身不许被写窄或写宽。6 = todo / not-public / name-broken / awaiting-data /
    // period-unresolved / name-incomplete；「机构不公开」与「我们还没核」是两种事实，不许合并。
    expect(codeTableReasonSets['not-built']).toHaveLength(4)
    expect(codeTableReasonSets.pending).toHaveLength(6)
    expect(codeTableReasonSets.pending).toContain('official-source-not-public')
  })

  it('事件身份不参与分级：`evt.*` 的 kind 是 event、tier 为 null', () => {
    const events = rows.filter((row) => row.code.startsWith('evt.'))
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((row) => row.kind === 'event' && row.tier === null)).toBe(true)
    // 指标行反过来不许标成 event；`kind` 与码前缀必须是同一件事，不能各说各的。
    expect(rows.filter((row) => row.kind === 'metric').every((row) => !row.code.startsWith('evt.'))).toBe(true)
  })
})

/**
 * 年度化的**载入校验**（方案 §3.4，Chief 2026-11-21 明确要求做成反例用例）：
 * 只对带 `officialSeries.frequency` 的**流量**码标 `annualization:'flow'`；比率类不许标。
 *
 * 三条判据都不靠注释：
 * ① 标了 `flow` 就必须有频率——没有频率的年化系数是编出来的；
 * ② 率类（百分比量纲）不许标 `flow`——利率年度化是错口径，**载入即红**；
 * ③ 表里真正标上的必须只有那 4 个流量码，失业率一个都不许有。
 */
describe('年度化标记与载入校验', () => {
  const flowCodes = rows.filter((row) => row.annualization === 'flow').map((row) => row.code)

  it('标了 flow 的只有 4 个带频率的流量码；比率那个不在其中', () => {
    expect([...flowCodes].sort()).toEqual([
      'US.JOBLESS_CLAIMS_4W_AVERAGE.SA.AVERAGE',
      'US.JOBLESS_CLAIMS_CONTINUING.SA.COUNT',
      'US.JOBLESS_CLAIMS_INITIAL.SA.COUNT',
      'US.NONFARM.SA.CHANGE'
    ])
    // 反例：失业率有频率、有序列号，但它是比率——标了就是错口径。
    expect(marketCalendarCodeTable['US.UNEMPLOYMENT.SA.RATE']!.annualization).toBeUndefined()
    // 每个 flow 码都有频率（没有频率的流量码是不可年度化的）。
    for (const code of flowCodes) {
      expect(marketCalendarCodeTable[code]!.officialSeries?.frequency).toBeDefined()
    }
  })

  it('给率类标 flow → 载入即抛（点名是哪个码、为什么）', () => {
    const broken = {
      'US.UNEMPLOYMENT.SA.RATE': {
        ...marketCalendarCodeTable['US.UNEMPLOYMENT.SA.RATE'],
        annualization: 'flow'
      }
    }
    expect(() => validateCodeTableRows(broken))
      .toThrow(/US\.UNEMPLOYMENT\.SA\.RATE：率类（measure=RATE）是百分比量纲，不许标 annualization:'flow'/)
  })

  it('标了 flow 却没有频率 → 载入即抛', () => {
    const broken = {
      'US.CPI.NSA.YOY': {
        ...marketCalendarCodeTable['US.CPI.NSA.YOY'],
        annualization: 'flow'
      }
    }
    expect(() => validateCodeTableRows(broken)).toThrow(/US\.CPI\.NSA\.YOY/)
  })

  it('不认识的 annualization 取值 → 载入即抛（闭集只有一个值）', () => {
    const broken = {
      'US.JOBLESS_CLAIMS_INITIAL.SA.COUNT': {
        ...marketCalendarCodeTable['US.JOBLESS_CLAIMS_INITIAL.SA.COUNT'],
        annualization: 'rate'
      }
    }
    expect(() => validateCodeTableRows(broken)).toThrow(/annualization/)
  })
})
