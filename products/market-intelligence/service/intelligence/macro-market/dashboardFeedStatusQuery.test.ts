import { describe, expect, it } from 'vitest'

import { createDashboardFeedStatusQuery } from './dashboardFeedStatusQuery'

type Fakes = Readonly<{
  profiles?: Readonly<Record<string, Readonly<{ enabled?: boolean; credentialRef?: string | null }>>>
  credentials?: Readonly<Record<string, boolean>>
  notes?: Readonly<Record<string, string>>
  health?: Readonly<Record<string, Readonly<{ lastSuccessAt?: string; lastFailureAt?: string }>>>
  throwOn?: string
}>

function query(fakes: Fakes = {}) {
  return createDashboardFeedStatusQuery({
    resolveProfile: async (sourceId) => {
      if (fakes.throwOn === sourceId) throw new Error('profile-unavailable')
      return fakes.profiles?.[sourceId] ?? { enabled: false, credentialRef: null }
    },
    hasCredential: async credentialRef => fakes.credentials?.[credentialRef] === true,
    readNote: key => fakes.notes?.[key],
    readHealth: sourceId => fakes.health?.[sourceId] ?? {}
  })
}

const keyed = (sourceId: string, enabled = true) => ({ [sourceId]: { enabled, credentialRef: sourceId } })

describe('dashboard feed status query', () => {
  it('reports one entry per admitted source, in the strip\'s reading order', async () => {
    const status = await query().status()
    expect(status.map(source => source.sourceId)).toEqual(['realmarketapi-market', 'twelve-data-market', 'fred-rates-liquidity'])
  })

  it('separates unconfigured from configured-but-disabled', async () => {
    const unconfigured = (await query({ profiles: keyed('realmarketapi-market'), credentials: {} }).status())[0]
    expect(unconfigured).toMatchObject({ enabled: true, hasCredential: false })
    const disabled = (await query({ profiles: keyed('realmarketapi-market', false), credentials: { 'realmarketapi-market': true } }).status())[0]
    expect(disabled).toMatchObject({ enabled: false, hasCredential: true })
  })

  it('reads the failure code from the last tick\'s own outcome note, and only when it failed', async () => {
    const failed = (await query({
      profiles: keyed('realmarketapi-market'), credentials: { 'realmarketapi-market': true },
      notes: { 'realmarketapi.lastOutcome': 'unavailable:credential-rejected', 'realmarketapi.lastFailureCode': 'credential-rejected' }
    }).status())[0]
    expect(failed.failureCode).toBe('credential-rejected')

    // A later success is the last word: the older failure code must not outlive it.
    const recovered = (await query({
      profiles: keyed('realmarketapi-market'), credentials: { 'realmarketapi-market': true },
      notes: {
        'realmarketapi.lastOutcome': 'stored', 'realmarketapi.lastFailureCode': 'credential-rejected',
        'realmarketapi.lastRunAtMs': '1700000000000'
      }
    }).status())[0]
    expect(recovered.failureCode).toBeUndefined()
    expect(recovered.lastSuccessAtMs).toBe(1_700_000_000_000)
  })

  it('drops an outcome code the boundary cannot name instead of forwarding the material', async () => {
    const hostile = await query({
      profiles: keyed('realmarketapi-market'), credentials: { 'realmarketapi-market': true },
      notes: {
        'realmarketapi.lastOutcome': 'unavailable:https://api.realmarketapi.com/v1/price?apikey=SECRET0123456789',
        'realmarketapi.lastFailureCode': 'apikey=SECRET0123456789'
      }
    }).status()
    const serialised = JSON.stringify(hostile)
    expect(serialised).not.toContain('SECRET')
    expect(serialised).not.toContain('apikey')
    expect(serialised).not.toContain('realmarketapi.com')
    expect(hostile[0].failureCode).toBeUndefined()
  })

  it('takes Twelve Data\'s last successful tick from its own note and FRED\'s from the pipeline health', async () => {
    const status = await query({
      profiles: { ...keyed('twelve-data-market'), ...keyed('fred-rates-liquidity') },
      credentials: { 'twelve-data-market': true, 'fred-rates-liquidity': true },
      notes: { lastRunAtMs: '1700000000000' },
      health: { 'fred-rates-liquidity': { lastSuccessAt: '2026-09-14T12:00:00.000Z' } }
    }).status()
    expect(status.find(source => source.sourceId === 'twelve-data-market')?.lastSuccessAtMs).toBe(1_700_000_000_000)
    expect(status.find(source => source.sourceId === 'fred-rates-liquidity')?.lastSuccessAtMs).toBe(Date.parse('2026-09-14T12:00:00.000Z'))
  })

  it('collapses one unreadable source to "not enabled, not keyed" without failing its neighbours', async () => {
    const status = await query({
      profiles: { ...keyed('twelve-data-market') }, credentials: { 'twelve-data-market': true }, throwOn: 'realmarketapi-market'
    }).status()
    expect(status[0]).toMatchObject({ sourceId: 'realmarketapi-market', enabled: false, hasCredential: false })
    expect(status[1]).toMatchObject({ sourceId: 'twelve-data-market', enabled: true, hasCredential: true })
  })
})
