import { describe, expect, it } from 'vitest'

import { createPolicyPathMarketSource, parsePolicyPathMarketPayload } from './policyPathMarketSource'

const market = (title: string, yes: string, bid: number, ask: number) => ({
  groupItemTitle: title, outcomePrices: JSON.stringify([yes, String(1 - Number(yes))]), bestBid: bid, bestAsk: ask
})
const payload = JSON.stringify([{
  title: 'Fed Decision in December?',
  markets: [
    market('25 bps increase', '0.765', 0.76, 0.77),
    market('No change', '0.215', 0.21, 0.22),
    market('50+ bps increase', '0.0195', 0.02, 0.02),
    market('25 bps decrease', '0.0045', 0.00, 0.01),
    market('50+ bps decrease', '0.0025', 0.00, 0.00)
  ]
}])

describe('policy path market source', () => {
  it('normalises the five buckets and keeps the tightest quote', () => {
    const observation = parsePolicyPathMarketPayload(payload, '2026-10-30T02:10:00.000Z')!
    expect(observation.at).toBe('2026-10-30T02:10:00.000Z')
    expect(observation.values['hike-25']).toBeCloseTo(0.760, 3)
    expect(Object.values(observation.values).reduce((total, value) => total + value, 0)).toBeCloseTo(1, 10)
    // hike-25 leads at ~76%; its own quote is the one shown, not the 2%/2% tail bucket.
    expect(observation.quote).toEqual({ bid: 0.76, ask: 0.77 })
  })

  it('refuses a payload that is not a full distribution', () => {
    expect(parsePolicyPathMarketPayload(JSON.stringify([{ markets: [market('25 bps increase', '0.765', 0.76, 0.77)] }]), '2026-10-30T02:10:00.000Z')).toBeUndefined()
    expect(parsePolicyPathMarketPayload('not json', '2026-10-30T02:10:00.000Z')).toBeUndefined()
    expect(parsePolicyPathMarketPayload(JSON.stringify([]), '2026-10-30T02:10:00.000Z')).toBeUndefined()
  })

  it('treats a non-2xx response as no reading rather than an empty one', async () => {
    const source = createPolicyPathMarketSource({ request: async () => ({ ok: false, status: 502, body: payload }) })
    await expect(source.fetchMeeting({ slug: 'fed-decision-in-december', at: '2026-10-30T02:10:00.000Z' })).resolves.toBeUndefined()
    const blank = createPolicyPathMarketSource({ request: async () => ({ ok: true, status: 200, body: payload }) })
    await expect(blank.fetchMeeting({ slug: ' ', at: '2026-10-30T02:10:00.000Z' })).resolves.toBeUndefined()
  })
})
