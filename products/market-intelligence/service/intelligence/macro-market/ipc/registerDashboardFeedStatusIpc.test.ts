import { describe, expect, it } from 'vitest'

import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'
import { dashboardFeedStatusPublicPolicy, type DashboardFeedSourceStatus } from '../../../../contracts/macro/dashboardFeedStatusContracts'
import { registerDashboardFeedStatusIpc } from './registerMacroMarketIpc'

const entries: readonly DashboardFeedSourceStatus[] = [
  { sourceId: 'realmarketapi-market', enabled: true, hasCredential: false },
  { sourceId: 'twelve-data-market', enabled: true, hasCredential: true, lastSuccessAtMs: 1_700_000_000_000 },
  { sourceId: 'fred-rates-liquidity', enabled: false, hasCredential: true, failureCode: 'credential-rejected' }
]

function registered(status: () => Promise<readonly DashboardFeedSourceStatus[]>) {
  const handlers = new Map<string, (payload: unknown) => unknown>()
  registerDashboardFeedStatusIpc(
    ((productId, method, handler) => { handlers.set(`${productId}:${method}`, handler) }) as ProductIpcRegistrar,
    { status }
  )
  return handlers.get(`market-intelligence:${dashboardFeedStatusPublicPolicy.method}`)!
}

describe('dashboard feed status IPC', () => {
  it('answers the empty request with the sanitised per-source readiness', async () => {
    expect(await registered(async () => entries)({})).toEqual({ state: 'available', sources: entries })
  })

  it.each([undefined, null, { asOf: '2026-09-14T12:00:00.000Z' }, { sourceId: 'realmarketapi-market' }, [], 'query'])(
    'rejects the non-empty request %o without reading anything', async payload => {
      let read = false
      const answer = await registered(async () => { read = true; return entries })(payload)
      expect(answer).toEqual({ state: 'unavailable' })
      expect(read).toBe(false)
    })

  it('collapses a failing read, and a source the boundary does not admit, to unavailable', async () => {
    expect(await registered(async () => { throw new Error('store-unavailable') })({})).toEqual({ state: 'unavailable' })
    expect(await registered(async () => [{ ...entries[0], sourceId: 'binance-futures-positioning' } as never])({})).toEqual({ state: 'unavailable' })
    // The re-parse is the second guard: a code outside the admitted list never reaches the renderer.
    expect(await registered(async () => [{ sourceId: 'realmarketapi-market', enabled: true, hasCredential: true, failureCode: 'apikey=SECRET0123456789' } as never])({}))
      .toEqual({ state: 'unavailable' })
  })
})
