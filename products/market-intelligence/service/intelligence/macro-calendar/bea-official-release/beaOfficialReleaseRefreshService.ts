import type { MacroCalendarRevision } from '../macroCalendarContracts'
import { macroCalendarStoragePolicy } from '../macroCalendarPolicy'
import { beaOfficialReleasePollingPolicy, selectBeaOfficialReleaseCandidates } from './beaOfficialReleaseCandidateSelector'
import { recognizeBeaOfficialReleaseRss } from './beaOfficialReleaseRssRecognizer'
import { parseBeaOfficialReleasePage } from './beaOfficialReleasePageParser'
import { createBeaOfficialReleaseRevisions } from './beaOfficialReleaseRevisionFactory'

export const beaOfficialReleaseRefreshPolicy = Object.freeze({ rssDescriptorId: 'macro-calendar-bea-release-rss', pageDescriptorId: 'macro-calendar-bea-release-page', initialObservationIntervalMs: 15 * 60 * 1_000, delayedObservationIntervalMs: 6 * 60 * 60 * 1_000, dateOnlyObservationIntervalMs: 6 * 60 * 60 * 1_000 })

type HttpResult = { ok: true; descriptorId: string; status: number; acceptedBytes: number; body: string; contentType: string } | { ok: false; descriptorId: string; failureCode: string }

export function createBeaOfficialReleaseRefreshService(deps: Readonly<{
  repository: Pick<import('../macroCalendarRepository').MacroCalendarRepository, 'listEffectiveMonthAsOf' | 'appendManyIfNew' | 'recordBeaObservationAttemptIfDue' | 'clearBeaObservation' | 'clearExpiredBeaObservations'>
  http: Readonly<{ requestRss: (signal?: AbortSignal) => Promise<HttpResult>; requestPage: (url: string, signal?: AbortSignal) => Promise<HttpResult> }>
  evidence: Readonly<{ append: (input: { rssBody: string; pageBody: string; pageUrl: string; detectedAt: string; runId: string }) => { rss: { rawRecordId: string; evidenceHash: string }; page: { rawRecordId: string; evidenceHash: string } } | undefined }>
}>) {
  let inFlight = false
  return Object.freeze({
    async refresh(input: unknown, signal?: AbortSignal): Promise<Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>> {
      if (inFlight || signal?.aborted || !isInput(input)) return unavailable()
      inFlight = true
      try {
        const localRevisions = releaseWindowRevisions(deps.repository, input.detectedAt)
        deps.repository.clearExpiredBeaObservations({ before: new Date(Date.parse(input.detectedAt) - beaOfficialReleasePollingPolicy.delayedObservationWindowMs).toISOString() })
        const candidates = selectBeaOfficialReleaseCandidates({ revisions: localRevisions, now: input.detectedAt })
        let inserted = 0
        for (const candidate of candidates) {
          const interval = observationInterval(candidate.group, input.detectedAt)
          if (!deps.repository.recordBeaObservationAttemptIfDue({ releaseGroupKey: candidate.group.releaseGroupKey, scheduleFingerprint: candidate.scheduleFingerprint, now: input.detectedAt, minimumIntervalMs: interval })) continue
          const rss = await deps.http.requestRss(signal)
          if (!successful(rss, beaOfficialReleaseRefreshPolicy.rssDescriptorId) || signal?.aborted) continue
          const identity = recognizeBeaOfficialReleaseRss({ group: candidate.group, body: rss.body })
          if (!identity) continue
          const page = await deps.http.requestPage(identity.officialPageUrl, signal)
          if (!successful(page, beaOfficialReleaseRefreshPolicy.pageDescriptorId) || signal?.aborted) continue
          const facts = parseBeaOfficialReleasePage({ group: candidate.group, rss: identity, body: page.body })
          if (!facts || signal?.aborted) continue
          const evidence = deps.evidence.append({ rssBody: rss.body, pageBody: page.body, pageUrl: identity.officialPageUrl, detectedAt: input.detectedAt, runId: input.runId })
          const revisions = evidence ? createBeaOfficialReleaseRevisions({ group: candidate.group, rss: identity, facts, evidence, detectedAt: input.detectedAt }) : undefined
          if (!revisions || signal?.aborted) continue
          if (hasConflictingOfficial(revisions, releaseWindowRevisions(deps.repository, input.detectedAt))) return unavailable()
          const result = deps.repository.appendManyIfNew(revisions)
          inserted += result.insertedCount
          deps.repository.clearBeaObservation(candidate.group.releaseGroupKey)
        }
        return inserted > 0 ? updated() : unchanged()
      } catch { return unavailable() } finally { inFlight = false }
    }
  })
}
function releaseWindowRevisions(repository: Pick<import('../macroCalendarRepository').MacroCalendarRepository, 'listEffectiveMonthAsOf'>, asOf: string): MacroCalendarRevision[] {
  const at = Date.parse(asOf)
  if (!Number.isFinite(at)) return []
  const current = new Date(at)
  const currentMonth = monthBounds(current)
  const previous = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1))
  const previousMonth = current.getUTCDate() <= 2 ? monthBounds(previous) : undefined
  const revisions = [currentMonth, previousMonth].filter((value): value is { monthStart: string; monthEndExclusive: string } => value !== undefined)
    .flatMap((bounds) => repository.listEffectiveMonthAsOf({ ...bounds, asOf, limit: macroCalendarStoragePolicy.monthQueryMaxEvents }))
  return [...new Map(revisions.map((revision) => [revision.eventKey, revision])).values()]
}
function monthBounds(date: Date): { monthStart: string; monthEndExclusive: string } {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const next = new Date(Date.UTC(year, month + 1, 1))
  return { monthStart: start, monthEndExclusive: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01` }
}
function hasConflictingOfficial(revisions: readonly MacroCalendarRevision[], existing: readonly MacroCalendarRevision[]): boolean {
  return revisions.some((revision) => existing.some((current) => current.eventKey === revision.eventKey && current.revisionKind === 'official-release' && current.lifecycleState === 'released' &&
    (current.actual?.numericValue !== revision.actual?.numericValue || current.actual?.unit !== revision.actual?.unit || current.publishedAt !== revision.publishedAt)))
}
function observationInterval(group: { scheduledAt?: string }, now: string): number {
  if (!group.scheduledAt) return beaOfficialReleaseRefreshPolicy.dateOnlyObservationIntervalMs
  const elapsed = Date.parse(now) - Date.parse(group.scheduledAt)
  return elapsed <= beaOfficialReleasePollingPolicy.initialObservationWindowMs ? beaOfficialReleaseRefreshPolicy.initialObservationIntervalMs : beaOfficialReleaseRefreshPolicy.delayedObservationIntervalMs
}
function successful(value: HttpResult, descriptorId: string): value is Extract<HttpResult, { ok: true }> { return value.ok && value.descriptorId === descriptorId && value.status >= 200 && value.status < 300 && value.acceptedBytes === Buffer.byteLength(value.body, 'utf8') }
function isInput(value: unknown): value is { detectedAt: string; runId: string } { return Boolean(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 2 && typeof (value as any).detectedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test((value as any).detectedAt) && new Date((value as any).detectedAt).toISOString() === (value as any).detectedAt && typeof (value as any).runId === 'string' && (value as any).runId.trim()) }
function updated() { return Object.freeze({ state: 'updated' as const }) }
function unchanged() { return Object.freeze({ state: 'unchanged' as const }) }
function unavailable() { return Object.freeze({ state: 'unavailable' as const }) }
