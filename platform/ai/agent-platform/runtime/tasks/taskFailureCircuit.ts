import type { TaskRunLogEntity } from '../../schemas/taskSchemas'

export function countConsecutiveTerminalFailures(
  taskRunLogs: readonly TaskRunLogEntity[],
  failureResetAt: string | null | undefined = null
): number {
  const resetAtMs = failureResetAt ? Date.parse(failureResetAt) : Number.NaN
  const logs = [...taskRunLogs].sort((a, b) => {
    const delta = Date.parse(b.startedAt) - Date.parse(a.startedAt)
    return delta !== 0 ? delta : a.id.localeCompare(b.id)
  })
  let failures = 0

  for (const log of logs) {
    if (Number.isFinite(resetAtMs) && Date.parse(log.startedAt) <= resetAtMs) break
    if (log.status === 'running') continue
    if (log.status === 'failed') {
      failures += 1
      continue
    }
    break
  }

  return failures
}
