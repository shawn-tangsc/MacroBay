import { randomUUID } from 'node:crypto'
import { crossAssetPolicy } from './crossAssetPolicy'

type Active = { state: 'active'; leaseId: string; expiresAt: number }
export type CrossAssetLeaseState = 'none' | 'active' | 'expired'

export function createCrossAssetLeaseStore(deps: { now: () => number }) {
  const leases = new Map<string, number>()
  // Remembering the last prune is what separates "never had a lease" from "the lease lapsed":
  // both leave zero active leases, but only one is a fault the reader can act on.
  let lastExpiredAt: number | null = null
  const prune = () => {
    const now = deps.now()
    for (const [id, expiresAt] of leases) {
      if (expiresAt <= now) {
        leases.delete(id)
        lastExpiredAt = now
      }
    }
  }
  return {
    acquire(): Active | { state: 'limited' } {
      prune()
      if (leases.size >= crossAssetPolicy.leases.maxActive) return { state: 'limited' }
      const leaseId = randomUUID()
      const expiresAt = deps.now() + crossAssetPolicy.leases.ttlMs
      leases.set(leaseId, expiresAt)
      return { state: 'active', leaseId, expiresAt }
    },
    renew(leaseId: string): Active | { state: 'expired' } {
      prune()
      if (!leases.has(leaseId)) return { state: 'expired' }
      const expiresAt = deps.now() + crossAssetPolicy.leases.ttlMs
      leases.set(leaseId, expiresAt)
      return { state: 'active', leaseId, expiresAt }
    },
    release(leaseId: string): { state: 'released' } {
      leases.delete(leaseId)
      // An explicit release is not an expiry: the channel is deliberately idle.
      if (leases.size === 0) lastExpiredAt = null
      return { state: 'released' }
    },
    has(leaseId: string) { prune(); return leases.has(leaseId) },
    count() { prune(); return leases.size },
    state(): CrossAssetLeaseState {
      prune()
      if (leases.size > 0) return 'active'
      return lastExpiredAt === null ? 'none' : 'expired'
    }
  }
}
