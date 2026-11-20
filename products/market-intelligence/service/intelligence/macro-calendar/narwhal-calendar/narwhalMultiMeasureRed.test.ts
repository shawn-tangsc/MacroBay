import { describe, expect, it } from 'vitest'

import { narwhalObservationBatches } from './narwhalCalendarObservationBatches'

/**
 * **多指标串值**（用户 2026-11-21）：一条发布覆盖多个指标时，**值只能有一份**——
 * 所以 draft 不许同时声称覆盖多个指标。
 *
 * **现在是红的，`skip` 是等口径，不是已修**（待办清单 #70）：`draftOf` 的 `measureKeys` 列全部指标、
 * 值只取主测度一个，而 draft 的身份键 `['narwhal', descriptorId, locale, sourceEventId]` **不含 measure**——
 * 「值属于哪个指标」在 draft 层就丢了，所以按 measure 拆成多条会互相覆盖，这是契约改动。
 * 两条修法（按 measure 各自带值 / 各落「未提供」+ `value-owner-unknown`）等用户拍板。
 *
 * **拍板后先把这个 `it.skip` 去掉、看它红一次，再动 `draftOf`**——别反过来。
 */
const release = {
  releaseId: 'emp-2026-11', at: '2026-11-06T13:30:00.000Z', timezone: 'America/New_York',
  seriesId: 'EMP', name: 'Employment report', country: 'USA', status: 'published', dateBasis: 'exact',
  eventDate: '2026-11-06',
  values: [
    { measure: 'nonfarm_payrolls_change', concept: 'nonfarm_payrolls_change', previous: '165', actual: '88' },
    { measure: 'unemployment_rate', concept: 'unemployment_rate', previous: '4.1', actual: '4.2' }
  ]
} as never

describe('多指标串值', () => {
  it.skip('多 measure 的发布不许产出「一份值覆盖两个指标」的 draft', () => {
    const batches = narwhalObservationBatches([release], { locale: 'zh', parserVersion: 'v1', collectionIdPrefix: 'probe' })
    const drafts = batches.flatMap((batch) => batch.parseResult.drafts as Array<Record<string, unknown>>)
    const multi = drafts.filter((draft) => String(draft.measureKeys ?? '').includes(','))
    expect(multi.map((draft) => ({ measureKeys: draft.measureKeys, previous: draft.providerPrevious }))).toEqual([])
  })
})