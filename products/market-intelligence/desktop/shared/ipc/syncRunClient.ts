import {
  SYNC_RUN_IPC_METHODS,
  type SyncRunAggregateResult,
  type SyncRunAnalysis,
  type SyncRunAnalysisResult,
  type SyncRunDailyRow,
  type SyncRunQuery,
  type SyncRunResult,
  type SyncRunRow
} from '../../../contracts/syncRunRecords'

const productId = 'market-intelligence'

export const syncRunClient = {
  async list(query: SyncRunQuery): Promise<SyncRunResult> {
    return sanitize(await invoke(SYNC_RUN_IPC_METHODS.list, query))
  },
  async aggregates(): Promise<SyncRunAggregateResult> {
    return sanitizeAggregates(await invoke(SYNC_RUN_IPC_METHODS.aggregates, undefined))
  },
}

/**
 * A summary answer keeps its state: `unavailable` carries a reason and must reach the page as
 * "cannot answer", never as an empty history.
 */
export function sanitizeAggregates(value: unknown): SyncRunAggregateResult {
  if (!isObject(value)) return { state: 'unavailable', reason: 'aggregates-unavailable', rows: [] }
  const rows = (Array.isArray(value.rows) ? value.rows : []).map(readDailyRow).filter((row): row is SyncRunDailyRow => row !== undefined)
  if (value.state === 'available') return { state: 'available', rows }
  return {
    state: 'unavailable',
    reason: value.reason === 'memory-store-has-no-aggregates' ? value.reason : 'aggregates-unavailable',
    rows
  }
}

function readDailyRow(value: unknown): SyncRunDailyRow | undefined {
  if (!isObject(value) || typeof value.day !== 'string' || typeof value.handlerId !== 'string') return undefined
  if (typeof value.runs !== 'number' || typeof value.failures !== 'number') return undefined
  return {
    day: value.day,
    handlerId: value.handlerId,
    taskLabel: typeof value.taskLabel === 'string' ? value.taskLabel : value.handlerId,
    runs: value.runs,
    failures: value.failures
  }
}

async function invoke(method: string, payload: unknown): Promise<unknown> {
  try {
    if (!window.platform?.products?.invoke) return undefined
    return await window.platform.products.invoke(productId, method, payload)
  } catch {
    return undefined
  }
}

/** Only rows the page can render; a malformed row is dropped rather than drawn half-empty. */
export function sanitize(value: unknown): SyncRunResult {
  if (!isObject(value)) return { state: 'unavailable', failureCode: 'malformed' }
  if (value.state !== 'available' || !Array.isArray(value.rows)) {
    return { state: 'unavailable', failureCode: typeof value.failureCode === 'string' ? value.failureCode : 'unavailable' }
  }
  const rows = value.rows.map(readRow).filter((row): row is SyncRunRow => row !== undefined)
  return { state: 'available', rows }
}

function readRow(value: unknown): SyncRunRow | undefined {
  if (!isObject(value) || typeof value.at !== 'string' || typeof value.runId !== 'string') return undefined
  if (typeof value.taskLabel !== 'string' || typeof value.handlerId !== 'string') return undefined
  const action = value.action as SyncRunRow['action']
  if (!['collect', 'refresh', 'analysis', 'configure', 'test', 'import', 'other'].includes(action)) return undefined
  const outcome = value.outcome
  if (outcome !== 'succeeded' && outcome !== 'failed' && outcome !== 'cancelled' && outcome !== 'running') return undefined
  return {
    at: value.at, runId: value.runId, taskLabel: value.taskLabel, handlerId: value.handlerId, action, outcome,
    sources: readSources(value.sources),
    analysis: readAnalysis(value.analysis),
    correlationId: typeof value.correlationId === 'string' ? value.correlationId : value.runId,
    ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
    ...(typeof value.failureCode === 'string' ? { failureCode: value.failureCode } : {}),
    ...(typeof value.detail === 'string' ? { detail: value.detail } : {})
  }
}

const analysisStates: ReadonlySet<SyncRunAnalysisResult['state']> = new Set([
  'queued', 'running', 'succeeded', 'invalid-output', 'failed', 'cancelled', 'stale', 'superseded'
])

/**
 * The analysis side of a row, as far as the payload can state it.
 *
 * "The payload said nothing" is not the same answer as "the task has no analysis" or "the analysis
 * has no link": it is `unavailable`, because a missing field means the read could not answer, and
 * drawing that as a normal state would be the 没有 / 拿不到 mistake.
 */
function readAnalysis(value: unknown): SyncRunAnalysis {
  if (!isObject(value)) return { state: 'unavailable' }
  if (value.state === 'not-applicable') return { state: 'not-applicable' }
  if (value.state === 'unlinked') return { state: 'unlinked' }
  if (value.state !== 'linked') return { state: 'unavailable' }
  const result = readAnalysisResult(value.result)
  return result ? { state: 'linked', result } : { state: 'unavailable' }
}

function readAnalysisResult(value: unknown): SyncRunAnalysisResult | undefined {
  if (!isObject(value) || typeof value.runId !== 'string' || !value.runId) return undefined
  const state = value.state as SyncRunAnalysisResult['state']
  if (!analysisStates.has(state)) return undefined
  return {
    runId: value.runId,
    state,
    ...(typeof value.failureCode === 'string' ? { failureCode: value.failureCode } : {}),
    ...(typeof value.failureDetailCode === 'string' ? { failureDetailCode: value.failureDetailCode } : {}),
    ...(typeof value.startedAt === 'string' ? { startedAt: value.startedAt } : {}),
    ...(typeof value.completedAt === 'string' ? { completedAt: value.completedAt } : {}),
    ...(typeof value.modelProviderId === 'string' ? { modelProviderId: value.modelProviderId } : {}),
    ...(typeof value.modelId === 'string' ? { modelId: value.modelId } : {})
  }
}

function readSources(value: unknown): SyncRunRow['sources'] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => isObject(entry) && typeof entry.sourceId === 'string' && typeof entry.label === 'string'
      ? { sourceId: entry.sourceId, label: entry.label }
      : undefined)
    .filter((entry): entry is { sourceId: string; label: string } => entry !== undefined)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
