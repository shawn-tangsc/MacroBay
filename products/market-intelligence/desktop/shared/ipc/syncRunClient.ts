import { SYNC_RUN_IPC_METHODS, type SyncRunQuery, type SyncRunResult, type SyncRunRow } from '../../../contracts/syncRunRecords'

const productId = 'market-intelligence'

export type SyncRunCsvResult =
  | Readonly<{ state: 'available'; csv: string }>
  | Readonly<{ state: 'unavailable'; failureCode: string }>

export const syncRunClient = {
  async list(query: SyncRunQuery): Promise<SyncRunResult> {
    return sanitize(await invoke(SYNC_RUN_IPC_METHODS.list, query))
  },
  async exportCsv(query: SyncRunQuery): Promise<SyncRunCsvResult> {
    const value = await invoke(SYNC_RUN_IPC_METHODS.exportCsv, query)
    if (!isObject(value)) return { state: 'unavailable', failureCode: 'malformed' }
    if (value.state === 'available' && typeof value.csv === 'string') return { state: 'available', csv: value.csv }
    return { state: 'unavailable', failureCode: typeof value.failureCode === 'string' ? value.failureCode : 'unavailable' }
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
    correlationId: typeof value.correlationId === 'string' ? value.correlationId : value.runId,
    ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
    ...(typeof value.failureCode === 'string' ? { failureCode: value.failureCode } : {}),
    ...(typeof value.detail === 'string' ? { detail: value.detail } : {})
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
