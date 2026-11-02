import { createHash } from 'node:crypto'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'

/**
 * The facts of one generation, before any language-specific text is attached.
 *
 * A packet is per language: it carries localized titles, translated news and the reader's prior
 * conclusions in that language. Everything the two editions must agree on — numbers, row order,
 * the cutoff, the events the brief points at — lives here instead, and this is the only shape the
 * snapshot digest accepts. The localized layer builds packets *from* this; it cannot feed bytes
 * back into it, because the digest reads nothing else.
 *
 * `timeline` is kept because the localized layer derives prior conclusions from it; it is not part
 * of the digest.
 */
export type TimelineItem = ReturnType<MarketAnalysisRepository['listTimeline']>['items'][number]

export type DailyBriefingFactSnapshot = Readonly<{
  asOf: string
  windowStart: string
  windowEnd: string
  windowHours: number
  /** Kept for the localized layer; not digested. */
  timeline: readonly TimelineItem[]
  conclusion: DailyBriefingFactPacket['conclusion']
  news: Readonly<{ state: DailyBriefingFactPacket['news']['state']; items: DailyBriefingFactPacket['news']['items'] }>
  readings: DailyBriefingFactPacket['readings']
  positioning?: NonNullable<DailyBriefingFactPacket['positioning']>
  policyPath?: NonNullable<DailyBriefingFactPacket['policyPath']>
  market: DailyBriefingFactPacket['market']
  enabled: DailyBriefingFactPacket['enabled']
}>

export type DailyBriefingSnapshot = Readonly<{ id: string; hash: string }>

/**
 * The facts inside an already-rendered packet. Used where a caller holds a packet and needs the
 * neutral half again (the deterministic fill does this, and tests build one from a packet stub);
 * it never invents a value the packet does not carry.
 */
export function factSnapshotFromPacket(packet: DailyBriefingFactPacket): DailyBriefingFactSnapshot {
  return Object.freeze({
    asOf: packet.asOf,
    windowStart: packet.windowStart,
    windowEnd: packet.windowEnd,
    windowHours: packet.windowHours,
    timeline: Object.freeze([]),
    conclusion: packet.conclusion,
    news: Object.freeze({ state: packet.news.state, items: packet.news.items }),
    readings: packet.readings,
    ...(packet.positioning ? { positioning: packet.positioning } : {}),
    ...(packet.policyPath ? { policyPath: packet.policyPath } : {}),
    market: packet.market,
    enabled: packet.enabled
  })
}

/**
 * The digest two editions of a period are compared by: the window, the numeric rows, the news and
 * event identities, and the events the brief points at. Titles, summaries and prior conclusions
 * are deliberately absent — two languages say different sentences by design.
 */
export function briefingSnapshot(document: DailyBriefingDocument, facts: DailyBriefingFactSnapshot): DailyBriefingSnapshot {
  const hash = createHash('sha256').update(stableStringify(snapshotFacts(document, facts))).digest('hex')
  return Object.freeze({ id: `bs_${hash.slice(0, 24)}`, hash })
}

/** Exported for the tests that prove the digest ignores wording and notices a number. */
export function snapshotFacts(document: DailyBriefingDocument, facts: DailyBriefingFactSnapshot): unknown {
  return {
    date: document.edition.date,
    windowStart: document.edition.windowStart,
    windowEnd: document.edition.windowEnd,
    timeZone: document.edition.timeZone,
    data: document.data,
    news: {
      state: facts.news.state,
      items: facts.news.items.map((item) => ({
        id: item.itemId,
        polarity: item.polarity,
        strength: item.strength,
        confidence: item.confidence,
        publishedAt: item.publishedAt
      }))
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
