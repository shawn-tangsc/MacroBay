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

export function createWebSearchBudget() {
  const events = new Set<string>()
  let searches = 0
  return Object.freeze({
    canSearch(eventKey: string): boolean {
      if (searches >= dailyBriefWebSearchBudget.maximumSearches) return false
      if (!events.has(eventKey) && events.size >= dailyBriefWebSearchBudget.maximumEvents) return false
      return true
    },
    record(eventKey: string): void {
      events.add(eventKey)
      searches += 1
    },
    get state() { return { events: events.size, searches } }
  })
}
