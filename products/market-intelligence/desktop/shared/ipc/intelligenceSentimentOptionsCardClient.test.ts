// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { intelligenceSentimentOptionsCardClient } from './intelligenceSentimentOptionsCardClient'

const input = { asOf: '2026-08-06T12:00:00.000Z', timeZone: 'Asia/Shanghai', windowDays: 30 as const }

const fearGreed = {
  state: 'available', score: 22, bucket: 'extreme-fear',
  observedAt: '2026-08-06T10:00:00.000Z', latestDay: '2026-08-06',
  daysAgo: 0, stale: false, seriesStart: '2026-08-06',
  points: [{ day: '2026-08-06', observedAt: '2026-08-06T10:00:00.000Z', score: 22, bucket: 'extreme-fear' }]
} as const

afterEach(() => vi.unstubAllGlobals())

describe('intelligenceSentimentOptionsCardClient', () => {
  it('passes an unreadable skew store through and keeps the fear-greed half', async () => {
    // 存储读不出来是这一支在真机上的形态。渲染层的解析只认 `state` 是不是字符串，这一条钉住它
    // 不会因为多了一个不认识的状态码就把整卡退回两段读不到。
    const payload = {
      ...input,
      fearGreed,
      optionSkew: { state: 'unavailable', failureCode: 'option-skew-query-unavailable' }
    }
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => payload) } } })

    await expect(intelligenceSentimentOptionsCardClient.query(input)).resolves.toEqual(payload)
  })

  it('calls the one card query with the three inputs it accepts', async () => {
    const invoke = vi.fn(async () => ({ ...input, fearGreed, optionSkew: { state: 'not-connected' } }))
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await intelligenceSentimentOptionsCardClient.query(input)
    expect(invoke).toHaveBeenCalledWith(
      'market-intelligence',
      INTELLIGENCE_PUBLIC_QUERY_METHODS.querySentimentOptionsCard,
      { asOf: input.asOf, timeZone: input.timeZone, windowDays: 30 }
    )
  })

  it('fails closed when the bridge throws or the answer belongs to another request', async () => {
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => { throw new Error('no-handler') }) } } })
    await expect(intelligenceSentimentOptionsCardClient.query(input)).resolves.toMatchObject({
      fearGreed: { state: 'unavailable' },
      optionSkew: { state: 'unavailable' }
    })

    vi.stubGlobal('window', {
      platform: {
        products: {
          invoke: vi.fn(async () => ({ ...input, asOf: '2026-08-07T12:00:00.000Z', fearGreed, optionSkew: { state: 'empty' } }))
        }
      }
    })
    await expect(intelligenceSentimentOptionsCardClient.query(input)).resolves.toMatchObject({
      asOf: input.asOf,
      fearGreed: { state: 'unavailable' }
    })
  })
})