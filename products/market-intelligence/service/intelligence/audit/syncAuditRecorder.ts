import type { ProductIpcHandler, ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import type { SyncAuditEntry } from '../../../contracts/syncRunRecords'
import type { SyncAuditStore } from './syncAuditStore'

type AuditSpec = Readonly<{ action: SyncAuditEntry['action']; target: string; detail?: string }>

/**
 * Records the reader's own actions, which never pass through a job.
 *
 * The wrapper sits on the IPC seam: one place sees the payload, the duration and the failure, and a
 * write that cannot be recorded still answers the caller — an audit row is never worth failing a
 * refresh for.
 */
const auditSpecs: Readonly<Record<string, (payload: unknown) => AuditSpec>> = {
  'intelligenceSources.saveProfile': (payload) => ({
    action: 'configure',
    target: stringField(payload, 'sourceId') ?? 'unknown',
    ...(booleanField(payload, 'enabled') === undefined ? {} : { detail: `enabled=${booleanField(payload, 'enabled')}` })
  }),
  'intelligenceSources.runNow': (payload) => ({ action: 'refresh', target: stringField(payload, 'sourceId') ?? 'unknown' }),
  'intelligence.macro.economicCalendar.refreshFedFomcDecision': () => ({ action: 'refresh', target: 'macro-calendar-fed' }),
  'intelligence.macro.economicCalendar.importManualBlsIcs': () => ({ action: 'import', target: 'macro-calendar-bls' }),
  'intelligence.macro.economicCalendar.testProviderConnection': (payload) => ({
    action: 'test',
    target: stringField(payload, 'providerId') ?? 'unknown'
  })
}

export function withSyncAudit(
  register: ProductIpcRegistrar,
  store: Pick<SyncAuditStore, 'append'>,
  now: () => string = () => new Date().toISOString()
): ProductIpcRegistrar {
  return (productId, method, handler) => {
    const describe = auditSpecs[method]
    if (!describe) {
      register(productId, method, handler)
      return
    }
    register(productId, method, async (payload) => {
      const started = Date.now()
      const base = describe(payload)
      try {
        const result = await handler(payload)
        append({ ...base, at: now(), actor: 'user', outcome: outcomeOf(result), durationMs: Date.now() - started })
        return result
      } catch (error) {
        append({
          ...base, at: now(), actor: 'user', outcome: 'failed', durationMs: Date.now() - started,
          ...(failureCode(error) === undefined ? {} : { failureCode: failureCode(error) }),
          detail: message(error)
        })
        throw error
      }
    })

    function append(entry: Omit<SyncAuditEntry, 'id'>): void {
      try {
        store.append(entry)
      } catch {
        // Recording must never fail the action it describes.
      }
    }
  }
}

function outcomeOf(result: unknown): SyncAuditEntry['outcome'] {
  if (result && typeof result === 'object') {
    const state = (result as { state?: unknown }).state
    if (state === 'failed' || state === 'unavailable') return 'failed'
  }
  return 'succeeded'
}

function stringField(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value ? value : undefined
}

function booleanField(payload: unknown, key: string): boolean | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'boolean' ? value : undefined
}

function failureCode(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : ''
  return /([a-z]+(?:-[a-z]+){1,4})/.exec(message)?.[1]
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200)
}
