import { describe, expect, it } from 'vitest'

import { narwhalCanonicalIdentityKey } from '../marketCalendarMetricIdentity'
import { narwhalObservationBatches, narwhalStandardRowInputs,
  narwhalStandardRowInputsDetailed } from './narwhalCalendarObservationBatches'
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

  it('算不出身份的发布写来源自己的 release_id，读回来是 unmapped', () => {
    const batches = narwhalObservationBatches([release({
      values: [{ measure: 'not_in_table', concept: 'not_in_table', actual: '1' }], period: '2026-10'
    })], { locale: 'zh', parserVersion: 'v1', collectionIdPrefix: 'x' })
    const draft = batches[0]!.parseResult.drafts[0]!
    expect(narwhalCanonicalIdentityKey(String(draft.marketFactKey))).toBeUndefined()
  })
})

describe('不是发布的东西不进日历', () => {
  it('GDP 即时预测：写进表但标 estimate（不排除）', () => {
    const rows = narwhalStandardRowInputs([
      release({ releaseId: 'nowcast-1', seriesId: 'usa-gdp-nowcast', period: '2026-Q4',
        values: [{ measure: 'gdp_nowcast_qoq_annualized', concept: 'gdp', actual: '2.1' }] }),
      release({ releaseId: 'gdp-1', seriesId: 'usa-gdp', period: '2026-Q3',
        values: [{ measure: 'gdp_nowcast_qoq_annualized', concept: 'gdp', actual: '3.1' }] })
    ])
    // 两条都写：即时预测标 estimate（日历会过滤掉它），GDP 那条不标（默认 release）。
    expect(rows.map((row) => row.sourceEventId)).toEqual(['nowcast-1', 'gdp-1'])
    expect(rows.find((row) => row.sourceEventId === 'nowcast-1')?.rowKind).toBe('estimate')
    expect(rows.find((row) => row.sourceEventId === 'gdp-1')?.rowKind).toBeUndefined()
  })
})

describe('映射不上的行必须交出去，不许静默丢', () => {
  it('无 period、类型串不在表里 → 进 unmapped，不消失', () => {
    const detailed = narwhalStandardRowInputsDetailed([
      release({ releaseId: 'unknown-1', name: 'Brand new event type', values: [] })
    ])
    expect(detailed.rows).toHaveLength(0)
    expect(detailed.unmapped).toEqual([
      { sourceKey: 'unknown-1', name: 'Brand new event type', reason: 'unknown-event-type' }
    ])
  })
})
