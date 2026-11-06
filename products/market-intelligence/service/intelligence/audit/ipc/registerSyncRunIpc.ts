import type { JobRuntime } from '@platform/jobs'
import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import type { AnalysisRun } from '../../../../contracts/marketAnalysisContracts'
import {
  SYNC_RUN_IPC_METHODS, SYNC_RUN_LIMITS, syncRunAggregateDayWindow,
  type SyncRunAggregateResult, type SyncRunQuery, type SyncRunResult, type SyncRunWindow
} from '../../../../contracts/syncRunRecords'
import { projectDailyAggregates } from '../syncRunAggregation'
import { projectSyncAudit, projectSyncRuns, type SyncRunAnalysisLookup } from '../syncRunProjection'
import type { SyncAuditStore } from '../syncAuditStore'

const productId = 'market-intelligence'

/**
 * The read side the analysis column needs: every analysis run, so one page can be joined without a
 * query per row. The caller owns the store; this module only reads it.
 */
export type SyncRunAnalysisSource = Readonly<{
  listRuns: () => readonly AnalysisRun[]
}>

/** Both reads are projections of the platform's job runs; nothing is written here. */
export function registerSyncRunIpc(
  register: ProductIpcRegistrar,
  jobRuntime: Pick<JobRuntime, 'listRuns' | 'listRunAggregates'>,
  now: () => string = () => new Date().toISOString(),
  audit?: Pick<SyncAuditStore, 'list'>,
  analysis?: SyncRunAnalysisSource
): void {
  const read = (payload: unknown): SyncRunResult => {
    const query = parseQuery(payload)
    if (!query) return { state: 'unavailable', failureCode: 'query-invalid' }
    try {
      const nowMs = Date.parse(now())
      const analysisLookup = lookupOf(analysis)
      // The platform orders by run id as a string, which stops matching time past the 9999th run;
      // ask for time order so "last 24 hours" is not a month-old page.
      const jobRows = projectSyncRuns(
        jobRuntime.listRuns({ productId, newestFirst: true, limit: SYNC_RUN_LIMITS.maximumLimit }),
        query,
        nowMs,
        analysisLookup
      )
      const auditRows = audit
        ? audit.list({ since: sinceOf(query.window, nowMs), limit: SYNC_RUN_LIMITS.maximumLimit })
          .map(projectSyncAudit)
          .filter((row) => query.sourceId === undefined || row.sources.some((source) => source.sourceId === query.sourceId))
          .filter((row) => query.outcome === undefined || row.outcome === query.outcome)
        : []
      const rows = [...jobRows, ...auditRows].sort((left, right) => right.at.localeCompare(left.at))
        .slice(0, Math.min(Math.max(query.limit, 1), SYNC_RUN_LIMITS.maximumLimit))
      return { state: 'available', rows }
    } catch {
      return { state: 'unavailable', failureCode: 'runs-unavailable' }
    }
  }
  /**
   * The per-day counts that outlive the 30-day detail window.
   *
   * A store that cannot answer says so with a reason code: the reader must never see an empty
   * history where the truth is "this store keeps no history".
   */
  const readAggregates = (): SyncRunAggregateResult => {
    try {
      const { fromDay, toDay } = syncRunAggregateDayWindow(Date.parse(now()))
      return projectDailyAggregates(jobRuntime.listRunAggregates({ fromDay, toDay, definitionIdPrefix: `${productId}.` }))
    } catch {
      return { state: 'unavailable', reason: 'aggregates-unavailable', rows: [] }
    }
  }

  register(productId, SYNC_RUN_IPC_METHODS.list, async (payload) => read(payload))
  register(productId, SYNC_RUN_IPC_METHODS.aggregates, async () => readAggregates())
}

function lookupOf(source: SyncRunAnalysisSource | undefined): SyncRunAnalysisLookup | undefined {
  if (!source) return undefined
  const byJobRunId = new Map<string, AnalysisRun>()
  const byRunId = new Map<string, AnalysisRun>()
  for (const run of source.listRuns()) {
    byRunId.set(run.id, run)
    if (run.jobRunId) byJobRunId.set(run.jobRunId, run)
  }
  return { byJobRunId, byRunId }
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
