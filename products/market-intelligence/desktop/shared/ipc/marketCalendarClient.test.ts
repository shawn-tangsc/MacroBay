// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { marketCalendarPublicPolicy as policy } from '../../../contracts/macro/marketCalendarQueryContracts'
afterEach(() => vi.unstubAllGlobals())
it('checks market scopes and exact public outputs on the renderer side', async () => {
  const { marketCalendarClient } = await import('./marketCalendarClient')
  const query = { month: '2026-09', locale: 'zh' as const, asOf: '2026-09-10T00:00:00.000Z' }
  const invoke = vi.fn().mockResolvedValue({ state: 'available', ...query, events: [], sources: policy.kinds.map(eventType =>
    ({ eventType, status: 'unavailable', sourceObservedAt: null })) })
  vi.stubGlobal('platform', { products: { invoke } })
  expect((await marketCalendarClient.queryMonth(query)).state).toBe('available')
  expect(invoke).toHaveBeenCalledWith('market-intelligence', policy.methods.query, query)
  invoke.mockResolvedValue({ state: 'available', ...query, events: [], sources: [], body: 'private' })
  expect((await marketCalendarClient.queryMonth(query)).state).toBe('unavailable')
  invoke.mockResolvedValue({ state: 'unavailable', sources: [], failureCode: 'disabled', apiKey: 'private' })
  expect(await marketCalendarClient.refresh({ month: query.month, locale: query.locale })).toEqual({ state: 'unavailable', sources: [], failureCode: 'readiness-unavailable' })
  invoke.mockClear()
  expect((await marketCalendarClient.refresh({ month: '2026-13', locale: 'zh' })).state).toBe('unavailable')
  expect(invoke).not.toHaveBeenCalled()
})
