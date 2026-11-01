import { describe, expect, it, vi } from 'vitest'
import type { ProductIpcHandler } from '@platform/desktop/ipc/productIpcRegistry'

import { withSyncAudit } from './syncAuditRecorder'

const registrarWith = () => {
  const handlers = new Map<string, ProductIpcHandler>()
  const register = (productId: string, method: string, handler: ProductIpcHandler) => { handlers.set(method, handler) }
  return { handlers, register }
}

describe('sync audit recorder', () => {
  it('records a successful source switch with what changed', async () => {
    const { handlers, register } = registrarWith()
    const store = { append: vi.fn() }
    const audit = withSyncAudit(register, store, () => '2026-10-30T09:00:00.000Z')
    audit('market-intelligence', 'intelligenceSources.saveProfile', async () => ({ state: 'saved' }))

    await handlers.get('intelligenceSources.saveProfile')!({ sourceId: 'policy-path-market', enabled: true })
    expect(store.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'configure', target: 'policy-path-market', actor: 'user', outcome: 'succeeded', detail: 'enabled=true'
    }))
  })

  it('records a failure and still rethrows it', async () => {
    const { handlers, register } = registrarWith()
    const store = { append: vi.fn() }
    const audit = withSyncAudit(register, store, () => '2026-10-30T09:00:00.000Z')
    audit('market-intelligence', 'intelligence.macro.economicCalendar.refreshFedFomcDecision', async () => { throw new Error('provider-disabled') })

    await expect(handlers.get('intelligence.macro.economicCalendar.refreshFedFomcDecision')!({})).rejects.toThrow('provider-disabled')
    expect(store.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'refresh', target: 'macro-calendar-fed', outcome: 'failed', failureCode: 'provider-disabled'
    }))
  })

  it('never fails the action because the audit write failed', async () => {
    const { handlers, register } = registrarWith()
    const audit = withSyncAudit(register, { append: () => { throw new Error('disk full') } })
    audit('market-intelligence', 'intelligenceSources.runNow', async () => ({ state: 'queued' }))
    await expect(handlers.get('intelligenceSources.runNow')!({ sourceId: 'fred-rates-liquidity' })).resolves.toEqual({ state: 'queued' })
  })

  it('leaves methods it does not describe alone', () => {
    const { handlers, register } = registrarWith()
    const store = { append: vi.fn() }
    withSyncAudit(register, store)('market-intelligence', 'intelligence.queryFearGreedSnapshot', async () => ({ state: 'available' }))
    expect(store.append).not.toHaveBeenCalled()
    expect(handlers.has('intelligence.queryFearGreedSnapshot')).toBe(true)
  })
})
