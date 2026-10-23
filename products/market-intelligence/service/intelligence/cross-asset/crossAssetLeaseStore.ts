import { randomUUID } from 'node:crypto'
import { crossAssetPolicy } from './crossAssetPolicy'

type Active = { state: 'active'; leaseId: string; expiresAt: number }
export function createCrossAssetLeaseStore(deps: { now: () => number }) {
  const leases = new Map<string, number>()
  const prune = () => { for (const [id, expiresAt] of leases) if (expiresAt <= deps.now()) leases.delete(id) }
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
    release(leaseId: string): { state: 'released' } { leases.delete(leaseId); return { state: 'released' } },
    has(leaseId: string) { prune(); return leases.has(leaseId) },
    count() { prune(); return leases.size }
  }
}
