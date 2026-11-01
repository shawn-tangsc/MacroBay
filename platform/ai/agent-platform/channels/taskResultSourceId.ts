/**
 * The `source_id` format for a task result is agreed in exactly one place. Producers and readers
 * both call these two functions, so a format change cannot leave one side parsing the old shape.
 *
 * The LAST segment is the run outcome, and `runLogId` may itself contain colons. This is the run
 * outcome, deliberately not the delivery status: `ChannelDeliveryStatus` lives on the delivery row,
 * and swapping the two compiles and never throws — it only produces wrong counts.
 */
export const taskResultOutcomes = ['completed', 'failed', 'cancelled'] as const

/** What happened to the task run. NOT `ChannelDeliveryStatus`, which says where the message went. */
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
