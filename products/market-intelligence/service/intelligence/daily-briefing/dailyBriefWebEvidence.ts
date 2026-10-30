export type DailyBriefWebEvidenceField = 'actual' | 'consensus' | 'previous' | 'reaction'

export type DailyBriefWebEvidenceRef = Readonly<{
  evidenceRefId: string
  eventKey: string
  field: DailyBriefWebEvidenceField
  value: string
  sourceName: string
  sourceUrl: string
  publishedAt: string
  retrievedAt: string
  sourceConflict?: boolean
}>

export type WebEvidenceCheck = 'ok' | 'missing-source' | 'invalid-url' | 'invalid-time' | 'after-cutoff'

export const dailyBriefWebSearchBudget = Object.freeze({ maximumEvents: 3, maximumSearches: 6 })

/** `cached` means the same event/field lookup already ran in this edition; it must not search again. */
export type WebSearchBudgetOutcome = 'search' | 'cached' | 'denied'

export type WebSearchBudgetState = Readonly<{ events: number; searches: number }>

/**
 * The per-edition search budget. One event may need more than one field (for example consensus and
 * reaction), but a field already looked up is served from the cache instead of being searched twice.
 * The caps are hard stops: a fourth event or a seventh distinct lookup is denied, not truncated.
 */
export function createWebSearchBudget() {
  const events = new Set<string>()
  const searches = new Set<string>()
  const cacheKey = (eventKey: string, field?: DailyBriefWebEvidenceField): string => `${eventKey}\u0000${field ?? ''}`
  const canSearch = (eventKey: string, field?: DailyBriefWebEvidenceField): boolean => {
    const event = eventKey.trim()
    if (!event) return false
    if (searches.has(cacheKey(event, field))) return false
    if (searches.size >= dailyBriefWebSearchBudget.maximumSearches) return false
    if (!events.has(event) && events.size >= dailyBriefWebSearchBudget.maximumEvents) return false
    return true
  }
  const record = (eventKey: string, field?: DailyBriefWebEvidenceField): boolean => {
    const event = eventKey.trim()
    if (!canSearch(event, field)) return false
    searches.add(cacheKey(event, field))
    events.add(event)
    return true
  }
  return Object.freeze({
    canSearch,
    record,
    request(eventKey: string, field?: DailyBriefWebEvidenceField): WebSearchBudgetOutcome {
      const event = eventKey.trim()
      if (searches.has(cacheKey(event, field))) return 'cached'
      return record(event, field) ? 'search' : 'denied'
    },
    get state(): WebSearchBudgetState { return { events: events.size, searches: searches.size } }
  })
}

export function checkDailyBriefWebEvidence(ref: DailyBriefWebEvidenceRef, cutoff: string): WebEvidenceCheck {
  if (!ref.sourceName.trim() || !ref.value.trim()) return 'missing-source'
  if (!/^https:\/\//i.test(ref.sourceUrl)) return 'invalid-url'
  const published = Date.parse(ref.publishedAt)
  const retrieved = Date.parse(ref.retrievedAt)
  const limit = Date.parse(cutoff)
  if (!Number.isFinite(published) || !Number.isFinite(retrieved) || !Number.isFinite(limit)) return 'invalid-time'
  if (published > limit || retrieved > limit) return 'after-cutoff'
  return 'ok'
}

/** Official statistical/central-bank domains outrank media when two sources conflict. */
export function isOfficialWebSource(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.endsWith('.gov') || ['ecb.europa.eu', 'bis.org', 'imf.org', 'oecd.org'].some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch { return false }
}
