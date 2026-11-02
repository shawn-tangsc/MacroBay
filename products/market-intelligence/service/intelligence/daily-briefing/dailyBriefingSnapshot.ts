import { createHash } from 'node:crypto'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'

/**
 * The frozen facts of one period, as an identifier two editions can be compared by.
 *
 * A packet is per language: it carries localized titles and summaries. The agreement the release
 * promises is narrower and stricter than "the documents look alike" — same numbers, same cutoff,
 * same row set — so the digest is taken over the language-independent part: the edition window,
 * the numeric data rows, the news and calendar identities, and the events the brief points at.
 * Two editions written from the same batch therefore hash the same string without anyone having to
 * compare screenshots, and a changed number changes the hash.
 */
export type DailyBriefingSnapshot = Readonly<{ id: string; hash: string }>

export function briefingSnapshot(document: DailyBriefingDocument, packet: DailyBriefingFactPacket): DailyBriefingSnapshot {
  const hash = createHash('sha256').update(stableStringify(snapshotFacts(document, packet))).digest('hex')
  return Object.freeze({ id: `bs_${hash.slice(0, 24)}`, hash })
}

/** Exported for the tests that prove the digest ignores wording and notices a number. */
export function snapshotFacts(document: DailyBriefingDocument, packet: DailyBriefingFactPacket): unknown {
  return {
    date: document.edition.date,
    windowStart: document.edition.windowStart,
    windowEnd: document.edition.windowEnd,
    timeZone: document.edition.timeZone,
    // `data` and `next` are built from ids and numbers, not from the language's words.
    data: document.data,
    news: {
      state: packet.news.state,
      items: packet.news.items.map((item) => ({
        id: item.itemId,
        polarity: item.polarity,
        strength: item.strength,
        confidence: item.confidence,
        publishedAt: item.publishedAt
      }))
    },
    calendar: {
      state: packet.calendar.state,
      events: packet.calendar.events.map((event) => ({ eventKey: event.eventKey, scheduledAt: event.scheduledAt }))
    },
    next: document.next.items.map((item) => ({ eventKey: item.eventKey, at: item.at }))
  }
}

/** Sorted keys everywhere: the same facts must produce the same bytes whatever order they arrive in. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}
