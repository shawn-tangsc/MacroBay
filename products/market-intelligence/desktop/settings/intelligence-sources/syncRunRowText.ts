import type { SyncRunRow } from '../../../contracts/syncRunRecords'

import type { SyncRunText } from './SyncRunSection'

/**
 * How one row names things: its tally, its task, its sources.
 *
 * These take the row and the copy table and return strings — no React, no state. They live here so
 * the table stays a table, and so the export uses the same wording as the row it exports.
 */

/**
 * The batch's tally, as one sentence, or nothing.
 *
 * Composed here rather than stored: the parts are numbers, and the separator is punctuation a
 * locale owns. A run without a tally gets no sentence at all — printing "0 of 0" would claim the
 * batch ran and found nothing, which is the opposite of "this record predates the count".
 */
export function syncRunTallyText(row: SyncRunRow, text: SyncRunText): string | undefined {
  const counts = row.counts
  if (counts === undefined) return undefined
  const parts = [
    text.counts.replace('{total}', String(counts.total)).replace('{succeeded}', String(counts.succeeded))
  ]
  if (counts.failed > 0) parts.push(text.countsFailed.replace('{failed}', String(counts.failed)))
  if (counts.skipped > 0) parts.push(text.countsSkipped.replace('{skipped}', String(counts.skipped)))
  const reason = row.resultReasonCode === undefined
    ? undefined
    : text.resultReasons[row.resultReasonCode] ?? text.resultReasonUnknown
  const tally = parts.join(text.countsSeparator)
  return reason === undefined ? tally : `${tally}${text.joiner}${reason}`
}

/** A product-side row uses its action as the handler id, so audit actions come before the raw label. */
export function syncRunAuditTaskLabel(handlerId: string, text: SyncRunText): string | undefined {
  return Object.prototype.hasOwnProperty.call(text.actions, handlerId)
    ? text.actions[handlerId as keyof SyncRunText['actions']]
    : undefined
}

/** The reader's name for the task; never an untranslated internal job name. */
export function syncRunTaskLabel(row: SyncRunRow, text: SyncRunText): string {
  return text.tasks[row.handlerId] ?? syncRunAuditTaskLabel(row.handlerId, text) ?? row.taskLabel
}

export function syncRunSourceLabel(source: SyncRunRow['sources'][number], text: SyncRunText): string {
  return text.sourceNames?.[source.sourceId] ?? source.label
}
