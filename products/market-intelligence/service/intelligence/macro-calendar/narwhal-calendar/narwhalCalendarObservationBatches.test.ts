import { describe, expect, it } from 'vitest'

import { narwhalCanonicalIdentityKey } from '../marketCalendarMetricIdentity'
import { decodeCalendarSourceEventId } from '../marketCalendarSourceEventId'
import { narwhalObservationBatches, narwhalStandardRowInputsDetailed } from './narwhalCalendarObservationBatches'
import type { NarwhalParsedRelease } from './narwhalCalendarParser'

const AT = '2026-11-13T13:30:00.000Z'
const base = {
  timezone: 'America/New_York', seriesId: 'usa-employment-statistics', country: 'USA',
  status: 'scheduled', dateBasis: 'exact' as const, eventDate: '2026-11-13'
}
const release = (over: Partial<NarwhalParsedRelease>): NarwhalParsedRelease =>
  ({ ...base, releaseId: 'r1', at: AT, name: 'Employment report', values: [], ...over }) as NarwhalParsedRelease

describe('Narwhal 发布 → 日历观测批次', () => {
  it('有值发布按 (国家, metric_key, period) 定身份，period 取自来源', () => {
    const batches = narwhalObservationBatches([release({
      values: [{ measure: 'nonfarm_payrolls_change', concept: 'nonfarm_payrolls_change', actual: '165' }],
      period: '2026-10'
    })], { locale: 'zh', parserVersion: 'v1', collectionIdPrefix: 'x' })
    const economic = batches.find((batch) => batch.descriptorId.endsWith('economic-data'))
    expect(economic).toBeDefined()
    const factKey = String(economic!.parseResult.drafts[0]!.marketFactKey)
    expect(narwhalCanonicalIdentityKey(factKey)).toBe('USA|US.NONFARM.SA.CHANGE|2026-10')
  })

  it('事件型发布按 (国家, 类型, 时刻) 定身份，且单独成批', () => {
    const batches = narwhalObservationBatches([release({ name: 'Fed speech', topic: 'policy_communication' })],
      { locale: 'zh', parserVersion: 'v1', collectionIdPrefix: 'x' })
    const speech = batches.find((batch) => batch.descriptorId.endsWith('central-bank-activities'))
    expect(speech).toBeDefined()
    expect(narwhalCanonicalIdentityKey(String(speech!.parseResult.drafts[0]!.marketFactKey)))
      .toBe(`USA|central-bank-activity|${AT}`)
  })

  it('同一次发布被拆成两条 release 时，同一身份只留一行', () => {
    const values = [{ measure: 'nonfarm_payrolls_change', concept: 'nonfarm_payrolls_change', actual: '165' }]
    const batches = narwhalObservationBatches([
      release({ releaseId: 'a', values, period: '2026-10' }),
      release({ releaseId: 'b', values, period: '2026-10' })
    ], { locale: 'zh', parserVersion: 'v1', collectionIdPrefix: 'x' })
    const economic = batches.find((batch) => batch.descriptorId.endsWith('economic-data'))
    expect(economic!.parseResult.drafts).toHaveLength(1)
  })

  it('测度映射不上时用源内身份：身份必须可解（国家|release_id|时刻），不再写裸 id', () => {
    const batches = narwhalObservationBatches([release({
      name: 'Something we have never mapped',
      values: [{ measure: 'not_in_table', concept: 'not_in_table', actual: '1' }], period: '2026-10'
    })], { locale: 'zh', parserVersion: 'v1', collectionIdPrefix: 'x' })
    const draft = batches[0]!.parseResult.drafts[0]!
    // 裸 id 解不出身份，重放只能记 bad-identity，那批发布就永远补不回日历（真机上三条就这样丢的）。
    expect(narwhalCanonicalIdentityKey(String(draft.marketFactKey)))
      .toBe(`USA|r1|${AT}`)
  })

  it('源名登记过事件码的指标型发布，采集时就把事件身份带上（政策利率决议那条）', () => {
    const batches = narwhalObservationBatches([release({
      name: 'Policy rate decision', values: [], period: undefined
    })], { locale: 'zh', parserVersion: 'v1', collectionIdPrefix: 'x' })
    const draft = batches[0]!.parseResult.drafts[0]!
    expect(narwhalCanonicalIdentityKey(String(draft.marketFactKey)))
      .toBe(`USA|evt.policy-rate-decision|${AT}`)
  })
})

describe('不是发布的东西不进日历', () => {
  it('GDP 即时预测：写进表但标 estimate（不排除）', () => {
    const rows = narwhalStandardRowInputsDetailed([
      release({ releaseId: 'nowcast-1', seriesId: 'usa-gdp-nowcast', period: '2026-Q4',
        values: [{ measure: 'gdp_nowcast_qoq_annualized', concept: 'gdp', actual: '2.1' }] }),
      release({ releaseId: 'gdp-1', seriesId: 'usa-gdp', period: '2026-Q3',
        values: [{ measure: 'gdp_nowcast_qoq_annualized', concept: 'gdp', actual: '3.1' }] })
    ]).rows
    // 两条都写：即时预测标 estimate（日历会过滤掉它），GDP 那条不标（默认 release）。
    // 指标行的身份是**四段**（方案 §2.4）：`国家|指标码|期|首次排期日`，不再是源内 releaseId。
    const decoded = rows.map((row) => decodeCalendarSourceEventId(row.sourceEventId))
    expect(decoded.map((item) => item?.periodKey)).toEqual(['2026-Q4', '2026-Q3'])
    expect(rows.find((row) => decodeCalendarSourceEventId(row.sourceEventId)?.periodKey === '2026-Q4')?.rowKind)
      .toBe('estimate')
    expect(rows.find((row) => decodeCalendarSourceEventId(row.sourceEventId)?.periodKey === '2026-Q3')?.rowKind)
      .toBeUndefined()
  })
})

describe('映射不上的行必须交出去，不许静默丢', () => {
  it('无 period、类型串不在表里 → 记工作清单，**但照样显示**（源内身份）', () => {
    const detailed = narwhalStandardRowInputsDetailed([
      release({ releaseId: 'unknown-1', name: 'Brand new event type', values: [] })
    ])
    // 两件事同时成立：读者看得见这次发布，我们也看得见缺口。
    expect(detailed.unmapped).toEqual([
      { sourceKey: 'unknown-1', name: 'Brand new event type', reason: 'unknown-event-type' }
    ])
    expect(detailed.rows).toHaveLength(1)
    expect(detailed.rows[0]!.identityKind).toBe('source')
    expect(detailed.rows[0]!.metricKey).toBe('unknown-1')
    expect(detailed.rows[0]!.sourceEventId).toBe('unknown-1')
  })
})

describe('状态闭集：源给什么报什么，认不出落 unknown（不按日期猜）', () => {
  it('认不出的状态串 → unknown', () => {
    const detailed = narwhalStandardRowInputsDetailed([
      release({ releaseId: 'st-1', seriesId: 'usa-employment-statistics', period: '2026-10',
        status: 'indicative-ish', values: [] })
    ])
    expect(detailed.rows[0]!.status).toBe('unknown')
  })
})

describe('「有期间没值」不进 unmapped：它不是映射缺口', () => {
  it('有测度依据 → 按组主测度生成空值指标行，unmapped 为空', () => {
    const detailed = narwhalStandardRowInputsDetailed([
      release({ releaseId: 'nv-basis', seriesId: 'usa-employment-statistics', period: '2026-10',
        status: 'scheduled', values: [] })
    ])
    expect(detailed.unmapped).toEqual([])
    expect(detailed.rows).toHaveLength(1)
    expect(detailed.rows[0]!.kind).toBe('indicator')
    expect(detailed.rows[0]!.metricKey).toBe('US.ADP.SA.CHANGE')
    expect(detailed.rows[0]!.fromMeasure).toBeUndefined()   // 不承载 measure，测度层不数它
    expect(detailed.rows[0]!.status).toBe('scheduled')
  })

  it('源说已发布但没有实际值 → 不落 published，退回待补值（用户 2026-11-16）', () => {
    // 帝国大厦那条就是这样进库的：narwhal 标 published、只有预期与前值，而「已发布优先」的取舍
    // 逻辑会把它当成权威。published 的定义是**有实际值**；没有实际值就只能退回待补值，
    // 24 小时窗口过后由对账落 missing。
    const detailed = narwhalStandardRowInputsDetailed([
      release({ releaseId: 'nv-pub', name: 'Household debt', seriesId: 'usa-household-debt',
        period: '2026-09', status: 'published', eventDate: '2026-11-04', values: [] })
    ])
    expect(detailed.unmapped).toEqual([])
    expect(detailed.rows[0]!.metricKey).toBe('evt.household-debt')
    expect(detailed.rows[0]!.status).toBe('backfilling')
  })

  it('有实际值的 published 照旧是 published', () => {
    // 用表里登记过的 measure：没登记的 measure 会走「源内身份」那一支，测不到这条判据。
    const detailed = narwhalStandardRowInputsDetailed([
      release({ releaseId: 'nv-act', name: 'Employment situation', seriesId: 'usa-nonfarm-payrolls',
        period: '2026-10', status: 'published', eventDate: '2026-11-06',
        values: [{ measure: 'nonfarm_payrolls_change', concept: 'nonfarm_payrolls_change',
          previous: '29', consensus: '50', actual: '165' }] })
    ])
    expect(detailed.rows[0]!.status).toBe('published')
  })

  it('无依据、无事件码 → 源内身份显示（不再消失），也不进 unmapped', () => {
    const detailed = narwhalStandardRowInputsDetailed([
      release({ releaseId: 'nv-source', name: 'Usa securities transactions',
        seriesId: 'usa-securities-transactions', period: '2026-10', status: 'scheduled', values: [] })
    ])
    expect(detailed.unmapped).toEqual([])
    expect(detailed.rows[0]!.identityKind).toBe('source')
    expect(detailed.rows[0]!.metricKey).toBe('nv-source')
    expect(detailed.rows[0]!.status).toBe('scheduled')
  })
})

describe('「有期间无值」不再进 unmapped（那是另一类事实）', () => {
  it('没有事件码、没有测度依据 → 源内身份照常成行，unmapped 一条都没有', () => {
    const detailed = narwhalStandardRowInputsDetailed([
      release({ releaseId: 'empty-values-1', name: 'Usa securities transactions',
        seriesId: 'usa-securities-transactions', period: '2026-10', values: [] })
    ])
    expect(detailed.unmapped).toEqual([])
    expect(detailed.rows).toHaveLength(1)
    expect(detailed.rows[0]!.identityKind).toBe('source')
    expect(detailed.rows[0]!.metricKey).toBe('empty-values-1')
  })
})

describe('写入端先查映射表：不再写源内身份等转正', () => {
  it('按国家的源内 id 映射里有这条 → 直接写码（判据：采集一轮后 source 不增长）', () => {
    // 206580 → JP.INVENTORY.NONE.MOM 是映射表里的一条；国家必须对得上才算。
    const detailed = narwhalStandardRowInputsDetailed([
      release({ releaseId: '["206580",1]', country: 'JP', name: '在庫', seriesId: 'no-such-series',
        period: '2026-10', values: [] })
    ])
    expect(detailed.rows).toHaveLength(1)
    expect(detailed.rows[0]!.identityKind).toBe('code')
    expect(detailed.rows[0]!.metricKey).toBe('JP.INVENTORY.NONE.MOM')
  })

  it('映射到别国的码 → 仍用源内身份（跨国家不写）', () => {
    const detailed = narwhalStandardRowInputsDetailed([
      release({ releaseId: '["206580",1]', country: 'US', name: '在庫', seriesId: 'no-such-series',
        period: '2026-10', values: [] })
    ])
    expect(detailed.rows[0]!.identityKind).toBe('source')
    expect(detailed.rows[0]!.metricKey).toBe('["206580",1]')
  })
})

describe('未知 measure 也要交出去（测度层守恒）', () => {
  it('有期间但 measure 不在映射表 → 记 unknown-measure，同时用源内身份显示', () => {
    const detailed = narwhalStandardRowInputsDetailed([
      release({ releaseId: 'r-x', period: '2026-10',
        values: [{ measure: 'not_in_table', concept: 'x', actual: '1' }] })
    ])
    expect(detailed.unmapped).toEqual([
      { sourceKey: 'r-x', name: 'Employment report', reason: 'unknown-measure', measureKeys: ['not_in_table'] }
    ])
    expect(detailed.rows).toHaveLength(1)
    expect(detailed.rows[0]!.identityKind).toBe('source')
    // 一个 measure 时值可以照挂；多个就不猜，留在工作清单里。
    expect(detailed.rows[0]!.actual).toBe('1')
  })

  it('两个 measure 全未映射 → 仍只出一行源内身份，值不猜', () => {
    const detailed = narwhalStandardRowInputsDetailed([
      release({ releaseId: 'r-y', period: '2026-10',
        values: [{ measure: 'a_unknown', concept: 'a', actual: '1' },
          { measure: 'b_unknown', concept: 'b', actual: '2' }] })
    ])
    expect(detailed.rows.filter((row) => row.identityKind === 'source')).toHaveLength(1)
    expect(detailed.rows[0]!.actual).toBeUndefined()
    expect(detailed.unmapped[0]!.measureKeys).toEqual(['a_unknown', 'b_unknown'])
  })
})
