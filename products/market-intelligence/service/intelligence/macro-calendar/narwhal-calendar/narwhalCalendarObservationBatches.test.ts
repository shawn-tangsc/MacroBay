import { describe, expect, it } from 'vitest'

import { narwhalCanonicalIdentityKey } from '../marketCalendarMetricIdentity'
import { narwhalObservationBatches } from './narwhalCalendarObservationBatches'
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
