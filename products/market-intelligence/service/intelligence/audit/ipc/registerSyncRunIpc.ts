import type { JobRunPage, JobRunRecord, JobRuntime } from '@platform/jobs'
import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import {
  SYNC_RUN_IPC_METHODS, SYNC_RUN_LIMITS,
  type SyncRunQuery, type SyncRunResult, type SyncRunWindow
} from '../../../../contracts/syncRunRecords'
import { projectSyncRuns, syncRunsCsv } from '../syncRunProjection'

const productId = 'market-intelligence'

/** Both reads are projections of the platform's job runs; nothing is written here. */
export function registerSyncRunIpc(
  register: ProductIpcRegistrar,
  jobRuntime: Pick<JobRuntime, 'listRuns'>,
  now: () => string = () => new Date().toISOString(),
  csvHeader: readonly string[] = ['time', 'source', 'action', 'outcome', 'durationMs', 'failureCode', 'detail']
): void {
  const read = (payload: unknown): SyncRunResult => {
    const query = parseQuery(payload)
    if (!query) return { state: 'unavailable', failureCode: 'query-invalid' }
    try {
      const rows = projectSyncRuns(jobRuntime.listRuns({ productId, limit: SYNC_RUN_LIMITS.maximumLimit }), query, Date.parse(now()))
      return { state: 'available', rows }
    } catch {
      return { state: 'unavailable', failureCode: 'runs-unavailable' }
    }
  }
  register(productId, SYNC_RUN_IPC_METHODS.list, async (payload) => read(payload))
  register(productId, SYNC_RUN_IPC_METHODS.exportCsv, async (payload) => {
    const result = read(payload)
    return result.state === 'available'
      ? { state: 'available' as const, csv: syncRunsCsv(result.rows, csvHeader) }
      : result
  })
}

function parseQuery(payload: unknown): SyncRunQuery | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const value = payload as Record<string, unknown>
  const window = value.window
  if (window !== '24h' && window !== '7d' && window !== 'all') return undefined
  const limit = typeof value.limit === 'number' && Number.isSafeInteger(value.limit) ? value.limit : SYNC_RUN_LIMITS.defaultLimit
  if (limit < 1 || limit > SYNC_RUN_LIMITS.maximumLimit) return undefined
  if (value.sourceId !== undefined && typeof value.sourceId !== 'string') return undefined
  if (value.outcome !== undefined && !['succeeded', 'failed', 'cancelled', 'running'].includes(String(value.outcome))) return undefined
  return {
    window: window as SyncRunWindow,
    limit,
    ...(typeof value.sourceId === 'string' && value.sourceId ? { sourceId: value.sourceId } : {}),
    ...(typeof value.outcome === 'string' ? { outcome: value.outcome as SyncRunQuery['outcome'] } : {})
  }
}

export type { JobRunPage, JobRunRecord }
