import type { JobRunAggregateResult } from '@platform/jobs'

import type {
  SyncRunAggregateResult,
  SyncRunAggregateUnavailableReason,
  SyncRunDailyRow
} from '../../../contracts/syncRunRecords'
import { syncRunHandlerCatalog } from './syncRunProjection'

/** The platform's daily rows name a definition; the reader gets the task's own name. */
export function projectDailyAggregates(
  result: JobRunAggregateResult,
  catalog: Readonly<Record<string, { taskLabel: string }>> = syncRunHandlerCatalog
): SyncRunAggregateResult {
  const rows: SyncRunDailyRow[] = result.rows.map((row) => ({
    day: row.day,
    handlerId: row.definitionId,
    // A definition the catalogue has never heard of keeps its id: inventing a name would hide the
    // fact that a new task started reporting history.
    taskLabel: catalog[row.definitionId]?.taskLabel ?? row.definitionId,
    runs: row.runs,
    failures: row.failures
  }))
  if (result.state === 'available') return { state: 'available', rows }
  return { state: 'unavailable', reason: reasonOf(result.reason), rows }
}

function reasonOf(reason: string): SyncRunAggregateUnavailableReason {
  return reason === 'memory-store-has-no-aggregates' ? reason : 'aggregates-unavailable'
}
