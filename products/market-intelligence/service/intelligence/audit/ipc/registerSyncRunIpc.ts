import type { JobRunRecord, JobRuntime } from '@platform/jobs'
import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import type { AnalysisRun } from '../../../../contracts/marketAnalysisContracts'
import {
  SYNC_RUN_IPC_METHODS, SYNC_RUN_LIMITS, SYNC_RUN_LOAD_CAP, isAnalysisRunId, syncRunAggregateDayWindow,
  type SyncRunAggregateResult, type SyncRunQuery, type SyncRunResult, type SyncRunWindow
} from '../../../../contracts/syncRunRecords'
import { projectDailyAggregates } from '../syncRunAggregation'
import { projectSyncAudit, projectSyncRun, projectSyncRuns, type SyncRunAnalysisLookup } from '../syncRunProjection'
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
  jobRuntime: Pick<JobRuntime, 'getRun' | 'listRuns' | 'listRunPage' | 'listRunAggregates'>,
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
      // 两件事必须都在服务端做，缺一件「24 小时」就还是假的：
      // 1. 窗口 —— 否则取回的 500 条只覆盖 3.6 小时（这个产品一天 4,940 条 run）；
      // 2. 续取 —— 窗口对了也装不进一页，500 条上限仍然会截断。
      const loaded = loadWindowRuns(jobRuntime, {
        productId,
        newestFirst: true,
        limit: SYNC_RUN_LIMITS.maximumLimit,
        // 任务筛在服务端做：`idx_job_runs_handler_id` 已在，稀疏任务不必和采集抢前 500 条的名额。
        ...(query.handlerId === undefined ? {} : { handlerId: query.handlerId }),
        createdFrom: sinceOf(query.window, nowMs)
      })
      // 平台按 created_at 筛，行上的 `at` 可能取 completedAt；边界上那一两条交给这一层再判一次。
      // 投影的 `limit` 是**这一页最多多少行**，所以放宽到装载上限——`query.limit` 只决定每页取多少。
      const jobRows = projectSyncRuns(loaded.runs, { ...query, limit: SYNC_RUN_LOAD_CAP }, nowMs, analysisLookup)
      const auditRows = audit
        ? audit.list({ since: sinceOf(query.window, nowMs), limit: SYNC_RUN_LIMITS.maximumLimit })
          .map(projectSyncAudit)
          .filter((row) => query.sourceId === undefined || row.sources.some((source) => source.sourceId === query.sourceId))
          .filter((row) => query.outcome === undefined || row.outcome === query.outcome)
        : []
      // A notification's target may be older than the newest page the list reads; fetch that one
      // task row on its own so the link can still locate it instead of reporting "not found".
      const focused = focusedJobRun(jobRuntime, query, analysisLookup)
      const focusedRow = focused ? projectSyncRun(focused, analysisLookup) : undefined
      const rows = dedupeById([
        ...jobRows,
        ...auditRows,
        ...(focusedRow ? [focusedRow] : [])
      ]).sort((left, right) => right.at.localeCompare(left.at))
        // `query.limit` 是**存储层每页多少条**，不是这一页能显示多少：窗口里所有取回的记录都要
        // 交给页面，否则「续取」白做，24 小时又只剩一页。
        .slice(0, SYNC_RUN_LOAD_CAP + (focusedRow ? 1 : 0))
      return { state: 'available', rows, ...(loaded.truncated ? { truncated: true } : {}) }
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

/**
 * 取完一个窗口：先按 `createdFrom` 由存储层筛，再按游标续取，直到取完或触到装载上限。
 *
 * 上限不是沉默的：触到就回 `truncated`，页面必须把它说出来。**「只取回一部分」本身不撒谎，
 * 假装取全了才撒谎。**
 */
function loadWindowRuns(
  jobRuntime: Pick<JobRuntime, 'listRunPage'>,
  query: Parameters<JobRuntime['listRunPage']>[0] & { limit: number }
): Readonly<{ runs: readonly JobRunRecord[]; truncated: boolean }> {
  const runs: JobRunRecord[] = []
  let cursor: string | undefined
  for (;;) {
    const page = jobRuntime.listRunPage({ ...query, ...(cursor === undefined ? {} : { cursor }) })
    runs.push(...page.runs)
    cursor = page.nextCursor ?? undefined
    if (cursor === undefined) return { runs, truncated: false }
    if (runs.length >= SYNC_RUN_LOAD_CAP) return { runs: runs.slice(0, SYNC_RUN_LOAD_CAP), truncated: true }
  }
}

function dedupeById(rows: readonly (SyncRunRowLike)[]): SyncRunRowLike[] {
  const seen = new Set<string>()
  return rows.filter((row) => (seen.has(row.runId) ? false : (seen.add(row.runId), true)))
}

type SyncRunRowLike = ReturnType<typeof projectSyncRun>

/**
 * The task run behind one analysis run, fetched past the newest page.
 *
 * The durable direction is `mi_analysis_runs.job_run_id`; today that write-back is still empty, so
 * the id the task carried in its payload is the fallback. Only the first match is wanted.
 */
function focusedJobRun(
  jobRuntime: Pick<JobRuntime, 'getRun' | 'listRuns'>,
  query: SyncRunQuery,
  lookup: SyncRunAnalysisLookup | undefined
): JobRunRecord | undefined {
  const analysisRunId = query.analysisRunId
  if (!analysisRunId || !lookup) return undefined
  const analysisRun = lookup.byRunId.get(analysisRunId)
  if (!analysisRun) return undefined
  if (analysisRun.jobRunId) {
    const linked = jobRuntime.getRun(analysisRun.jobRunId)
    if (linked) return linked
  }
  return jobRuntime.listRuns({
    productId,
    payload: { analysisRunId },
    newestFirst: true,
    limit: 1
  })[0]
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
  if (value.handlerId !== undefined && typeof value.handlerId !== 'string') return undefined
  if (value.outcome !== undefined && !['succeeded', 'failed', 'cancelled', 'running'].includes(String(value.outcome))) return undefined
  if (value.analysisRunId !== undefined && (typeof value.analysisRunId !== 'string' || !isAnalysisRunId(value.analysisRunId))) return undefined
  return {
    window: window as SyncRunWindow,
    limit,
    ...(typeof value.sourceId === 'string' && value.sourceId ? { sourceId: value.sourceId } : {}),
    ...(typeof value.handlerId === 'string' && value.handlerId ? { handlerId: value.handlerId } : {}),
    ...(typeof value.outcome === 'string' ? { outcome: value.outcome as SyncRunQuery['outcome'] } : {}),
    ...(typeof value.analysisRunId === 'string' ? { analysisRunId: value.analysisRunId } : {})
  }
}
