/**
 * The `source_id` format for a task result is agreed in exactly one place. Producers and readers
 * both call these two functions, so a format change cannot leave one side parsing the old shape.
 *
 * The middle segment is the run outcome (not the delivery status), and `runLogId` may itself
 * contain colons: the outcome is the last segment, and only a known outcome counts.
 */
export const taskResultOutcomes = ['completed', 'failed', 'cancelled'] as const
export type TaskResultOutcome = (typeof taskResultOutcomes)[number]

export function taskResultSourceId(runLogId: string, outcome: TaskResultOutcome): string {
  return `${runLogId}:${outcome}`
}

export function parseTaskResultSourceId(sourceId: string): { runLogId: string; outcome: TaskResultOutcome } | null {
  const separator = sourceId.lastIndexOf(':')
  if (separator <= 0) return null
  const outcome = sourceId.slice(separator + 1)
  if (!(taskResultOutcomes as readonly string[]).includes(outcome)) return null
  return { runLogId: sourceId.slice(0, separator), outcome: outcome as TaskResultOutcome }
}
