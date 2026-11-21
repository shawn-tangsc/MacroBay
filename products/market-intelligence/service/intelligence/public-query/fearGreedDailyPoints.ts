import {
  fearGreedSnapshotPolicy,
  isCanonicalFearGreedSnapshotTime,
  isFearGreedSnapshotScore,
  resolveFearGreedSnapshotBucket,
  type FearGreedSnapshotBucket
} from '../../../contracts/intelligenceQueryContracts'
import type { IntelligencePipeline } from '../application/intelligencePipeline'

/** One day of the index: the source's own UTC day label, the release that owns that day, its score. */
export type FearGreedDayPoint = {
  day: string
  observedAt: string
  score: number
  bucket: FearGreedSnapshotBucket
}

export type FearGreedDailyPointsRead =
  | { state: 'available'; days: FearGreedDayPoint[]; skipped: number }
  | { state: 'empty' }
  | { state: 'unavailable' }

type Candidate = { actual: unknown; releaseTime: string }

/**
 * The one reader of "which days does the index have, and what is each day's value".
 *
 * Two consumers: the snapshot (only the latest day) and the card's series. Keeping the day rule in
 * one place is what stops the snapshot from saying "19th = 24" while the curve's 19th says 22.
 *
 * A day's point is the release with the latest `releaseTime` inside that UTC day; `day` is the
 * source label (`releaseTime.slice(0, 10)`), never a reader-local day. Two releases at the exact
 * same instant must agree, otherwise the day is unreadable rather than silently picked.
 */
export function readFearGreedDailyPoints(input: {
  pipeline: Pick<IntelligencePipeline, 'listItems' | 'listMetricEvents'>
  asOf: string
  /**
   * Series callers tolerate a corrupt day (skip it, count it); the snapshot must stay strict, so
   * its caller omits this. A missing item link or a non-canonical release is the case this covers.
   */
  tolerateBadEntries?: boolean
}): FearGreedDailyPointsRead {
  try {
    let skipped = 0
    const metrics = input.pipeline.listMetricEvents()
    const items = input.pipeline.listItems()
    if (!Array.isArray(metrics) || !Array.isArray(items)) return { state: 'unavailable' }

    const candidates: Candidate[] = []
    for (const metric of metrics) {
      if (!isFixedFearGreedMetric(metric)) continue
      const record = safeRecord(metric)
      if (!record) { if (input.tolerateBadEntries) { skipped += 1; continue } return { state: 'unavailable' } }
      if (!isCanonicalFearGreedSnapshotTime(record.releaseTime)) { if (input.tolerateBadEntries) { skipped += 1; continue } return { state: 'unavailable' } }
      if (record.releaseTime > input.asOf) continue

      const itemId = safeNonEmptyString(record, 'itemId')
      if (!itemId) { if (input.tolerateBadEntries) { skipped += 1; continue } return { state: 'unavailable' } }
      const linkedItems = items.filter((item) => {
        const itemRecord = safeRecord(item)
        return itemRecord && safeNonEmptyString(itemRecord, 'itemId') === itemId
      })
      if (linkedItems.length !== 1) { if (input.tolerateBadEntries) { skipped += 1; continue } return { state: 'unavailable' } }
      const linkedItem = safeRecord(linkedItems[0])
      if (!linkedItem || linkedItem.sourceId !== fearGreedSnapshotPolicy.sourceId || !isCanonicalFearGreedSnapshotTime(linkedItem.detectedAt)) {
        if (input.tolerateBadEntries) { skipped += 1; continue }
        return { state: 'unavailable' }
      }
      if (linkedItem.detectedAt > input.asOf) continue

      candidates.push({ actual: record.actual, releaseTime: record.releaseTime })
    }

    if (candidates.length === 0) return { state: 'empty' }

    const latestInstant = candidates.reduce((latest, candidate) => candidate.releaseTime > latest ? candidate.releaseTime : latest, candidates[0]!.releaseTime)
    const newest = candidates.filter((candidate) => candidate.releaseTime === latestInstant)
    if (!newest.every((candidate) => isFearGreedSnapshotScore(candidate.actual))) return { state: 'unavailable' }
    const newestScore = newest[0]!.actual as number
    if (!newest.every((candidate) => candidate.actual === newestScore)) return { state: 'unavailable' }

    const byDay = new Map<string, Candidate>()
    for (const candidate of candidates) {
      const day = candidate.releaseTime.slice(0, 10)
      const held = byDay.get(day)
      if (!held || candidate.releaseTime > held.releaseTime) byDay.set(day, candidate)
    }

    const days: FearGreedDayPoint[] = []
    for (const [day, candidate] of byDay) {
      // A corrupt older day becomes a gap, not a broken card: the curve draws what it has and the
      // gap stays a gap. The newest day was validated above, so the snapshot's answer cannot move.
      if (!isFearGreedSnapshotScore(candidate.actual)) continue
      const bucket = resolveFearGreedSnapshotBucket(candidate.actual)
      if (!bucket) continue
      days.push({ day, observedAt: candidate.releaseTime, score: candidate.actual, bucket })
    }
    days.sort((left, right) => right.day.localeCompare(left.day))

    return days.length === 0 ? { state: 'empty' } : { state: 'available', days, skipped }
  } catch {
    return { state: 'unavailable' }
  }
}

function safeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) return undefined
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Object.getOwnPropertyDescriptor(value, key)?.get || Object.getOwnPropertyDescriptor(value, key)?.set) return undefined
  }
  return value as Record<string, unknown>
}

function safeNonEmptyString(record: Record<string, unknown>, field: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, field)
  return descriptor?.enumerable === true && 'value' in descriptor && typeof descriptor.value === 'string' && descriptor.value.trim()
    ? descriptor.value
    : undefined
}

function isFixedFearGreedMetric(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) return false
  const sourceId = Object.getOwnPropertyDescriptor(value, 'sourceId')
  const metricKey = Object.getOwnPropertyDescriptor(value, 'metricKey')
  return sourceId?.enumerable === true && metricKey?.enumerable === true &&
    !sourceId.get && !sourceId.set && !metricKey.get && !metricKey.set &&
    sourceId.value === fearGreedSnapshotPolicy.sourceId && metricKey.value === fearGreedSnapshotPolicy.metricKey
}