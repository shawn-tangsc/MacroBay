import type { JobRuntime } from '@platform/jobs'
import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import {
  SYNC_RUN_IPC_METHODS, SYNC_RUN_LIMITS,
  type SyncRunQuery, type SyncRunResult, type SyncRunWindow
} from '../../../../contracts/syncRunRecords'
import { projectSyncAudit, projectSyncRuns, syncRunsCsv } from '../syncRunProjection'
import type { SyncAuditStore } from '../syncAuditStore'

const productId = 'market-intelligence'

/** Both reads are projections of the platform's job runs; nothing is written here. */
export function registerSyncRunIpc(
  register: ProductIpcRegistrar,
  jobRuntime: Pick<JobRuntime, 'listRuns'>,
  now: () => string = () => new Date().toISOString(),
  csvHeader: readonly string[] = ['time', 'source', 'action', 'outcome', 'durationMs', 'failureCode', 'correlationId', 'detail'],
  audit?: Pick<SyncAuditStore, 'list'>
): void {
  const read = (payload: unknown): SyncRunResult => {
    const query = parseQuery(payload)
    if (!query) return { state: 'unavailable', failureCode: 'query-invalid' }
    try {
      const nowMs = Date.parse(now())
      const jobRows = projectSyncRuns(jobRuntime.listRuns({ productId, limit: SYNC_RUN_LIMITS.maximumLimit }), query, nowMs)
      const auditRows = audit
        ? audit.list({ since: sinceOf(query.window, nowMs), limit: SYNC_RUN_LIMITS.maximumLimit })
          .map(projectSyncAudit)
          .filter((row) => query.sourceId === undefined || row.sourceId === query.sourceId)
          .filter((row) => query.outcome === undefined || row.outcome === query.outcome)
        : []
      const rows = [...jobRows, ...auditRows].sort((left, right) => right.at.localeCompare(left.at))
        .slice(0, Math.min(Math.max(query.limit, 1), SYNC_RUN_LIMITS.maximumLimit))
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

function sinceOf(window: SyncRunWindow, nowMs: number): string {
  if (window === 'all') return new Date(0).toISOString()
  return new Date(nowMs - SYNC_RUN_LIMITS.windowMs[window]).toISOString()
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
