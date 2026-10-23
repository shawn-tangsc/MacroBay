import { expect, it } from 'vitest'

import { provenanceMethods, type ProvenanceExplanation } from '../../../contracts/provenanceContracts'
import { registerProvenanceIpc } from './registerProvenanceIpc'

/** 门本身：合法请求得到从 owner 现读的口径；非法请求与别侧的族各有自己的回答。 */
function handler() {
  const registered = new Map<string, (payload: unknown) => Promise<unknown>>()
  registerProvenanceIpc((productId, method, run) => { registered.set(`${productId}:${method}`, run) })
  return registered.get(`market-intelligence:${provenanceMethods.explainFigure}`)!
}

it('answers a family it owns through the product boundary', async () => {
  const answer = await handler()({ family: 'cross-market-reading' }) as ProvenanceExplanation
  expect(answer.state).toBe('available')
  expect(answer.state === 'available' && answer.values['flat-band.dxy']).toBe(0.06)
  expect(answer.state === 'available' && answer.cadence).toEqual({ kind: 'bar', intervalMs: 300_000 })
})

it('answers "not on this side" for the renderer\'s family, and refuses a malformed request', async () => {
  const other = await handler()({ family: 'daily-rate-row' }) as ProvenanceExplanation
  expect(other).toMatchObject({ state: 'unavailable', family: 'daily-rate-row', reason: 'not-on-this-side' })
  const malformed = await handler()({ family: 'not a family' }) as ProvenanceExplanation
  expect(malformed.state).toBe('unavailable')
})
