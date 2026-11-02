import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { dailyBriefingPolicy } from '../../../contracts/dailyBriefing'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'

/** The generation budget and the two guards it needs; kept out of the service file for its size. */

/**
 * The renderer validates a document against the same two budgets, so the service must never build
 * an edition whose candidate pool is larger than the document can carry. News candidates are the
 * directional rows the builder would select; title duplicates are collapsed during selection but
 * still count against the input budget, so a duplicate flood fails instead of shrinking silently.
 * Macro candidates are the builder's own released/high/actual list, which the document keeps whole
 * in `macroCandidates` so the count here reads the same implementation the writer saw.
 */
export function candidateOverflow(packet: DailyBriefingFactPacket, document: DailyBriefingDocument): boolean {
  const newsCandidates = packet.news.items.filter((item) =>
    item.polarity !== 'neutral' && item.strength >= 2 && item.confidence >= 50).length
  const macroCandidates = document.news.macroCandidates?.length ?? 0
  return newsCandidates > dailyBriefingPolicy.maximumNewsItems ||
    macroCandidates > dailyBriefingPolicy.maximumMacroItems
}

export async function withDeadline<T>(read: Promise<T>, milliseconds: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          // The losing turn rejects later: it is being cancelled at this instant. `Promise.race`
          // already subscribes to its inputs, but observe the loser explicitly here so a future
          // rewrite of this deadline can never leave a rejection for the main process.
          void read.catch(() => undefined)
          // The timeout is a cancellation, not just an abandoned wait: the work behind `read` is
          // told to stop before the caller is released with a failure.
          onTimeout?.()
          reject(new Error('daily-briefing-generation-timeout'))
        }, milliseconds)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function cutoffDate(today: string): string {
  const start = Date.parse(`${today}T00:00:00.000Z`)
  return new Date(start - (dailyBriefingPolicy.retentionDays - 1) * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}

/** A model round that ran out of output is a writing failure, not a generic timeout. */
export function isOutputTruncation(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /truncat|max[_-]?tokens|stop_reason/i.test(`${error.name} ${error.message}`)
}
