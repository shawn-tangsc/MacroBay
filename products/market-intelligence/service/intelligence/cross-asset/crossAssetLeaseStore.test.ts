import { describe, expect, it } from 'vitest'
import { createCrossAssetLeaseStore } from './crossAssetLeaseStore'

describe('cross-asset visible leases', () => {
  it('limits active leases to four and expires abandoned leases after 30 seconds', () => {
    let now = 1000
    const leases = createCrossAssetLeaseStore({ now: () => now })
    const acquired = Array.from({ length: 4 }, () => leases.acquire())
    expect(new Set(acquired.map(item => item.state === 'active' && item.leaseId)).size).toBe(4)
    expect(leases.acquire()).toEqual({ state: 'limited' })
    expect(leases.count()).toBe(4)
    now += 30_000
    expect(leases.count()).toBe(0)
    expect(leases.acquire().state).toBe('active')
  })

  it('renews a known live lease, rejects expired/unknown ids and releases idempotently', () => {
    let now = 0
    const leases = createCrossAssetLeaseStore({ now: () => now })
    const first = leases.acquire()
    if (first.state !== 'active') throw new Error('fixture admission')
    now = 10_000
    expect(leases.renew(first.leaseId)).toMatchObject({ state: 'active', expiresAt: 40_000 })
    expect(leases.renew('unknown')).toEqual({ state: 'expired' })
    now = 40_000
    expect(leases.renew(first.leaseId)).toEqual({ state: 'expired' })
    expect(leases.release(first.leaseId)).toEqual({ state: 'released' })
    expect(leases.release(first.leaseId)).toEqual({ state: 'released' })
  })
})
