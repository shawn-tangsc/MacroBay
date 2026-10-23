import {
  fearGreedSnapshotPolicy,
  isCanonicalFearGreedSnapshotTime,
  isFearGreedSnapshotScore,
  resolveFearGreedSnapshotBucket,
  type FearGreedSnapshotQueryInput,
  type FearGreedSnapshotResult
} from '../../../contracts/intelligenceQueryContracts'
import type { IntelligencePipeline } from '../application/intelligencePipeline'

export type FearGreedSnapshotQueryDependencies = {
  pipeline: Pick<IntelligencePipeline, 'listItems' | 'listMetricEvents'>
}

export function queryFearGreedSnapshot(
  input: FearGreedSnapshotQueryInput & FearGreedSnapshotQueryDependencies
): FearGreedSnapshotResult {
  if (!isCanonicalFearGreedSnapshotTime(input.asOf)) return unavailable()

  try {
    const metrics = input.pipeline.listMetricEvents()
    const items = input.pipeline.listItems()
    if (!Array.isArray(metrics) || !Array.isArray(items)) return unavailable()

    const candidates: Candidate[] = []
    for (const metric of metrics) {
      if (!isFixedFearGreedMetric(metric)) continue
      const record = safeRecord(metric)
      if (!record) return unavailable()
      if (!isCanonicalFearGreedSnapshotTime(record.releaseTime)) return unavailable()
      if (record.releaseTime > input.asOf) continue

      const itemId = safeNonEmptyString(record, 'itemId')
      if (!itemId) return unavailable()
      const linkedItems = items.filter((item) => {
        const itemRecord = safeRecord(item)
        return itemRecord && safeNonEmptyString(itemRecord, 'itemId') === itemId
      })
      if (linkedItems.length !== 1) return unavailable()
      const linkedItem = safeRecord(linkedItems[0])
      if (!linkedItem || linkedItem.sourceId !== fearGreedSnapshotPolicy.sourceId || !isCanonicalFearGreedSnapshotTime(linkedItem.detectedAt)) return unavailable()
      if (linkedItem.detectedAt > input.asOf) continue

      candidates.push({ actual: record.actual, releaseTime: record.releaseTime })
    }

    if (candidates.length === 0) return { state: 'empty', asOf: input.asOf }
    const observedAt = candidates.reduce((latest, candidate) => candidate.releaseTime > latest ? candidate.releaseTime : latest, candidates[0].releaseTime)
    const newest = candidates.filter((candidate) => candidate.releaseTime === observedAt)
    if (!newest.every((candidate) => isFearGreedSnapshotScore(candidate.actual))) return unavailable()
    const score = newest[0].actual as number
    if (!newest.every((candidate) => candidate.actual === score)) return unavailable()
    const bucket = resolveFearGreedSnapshotBucket(score)
    return bucket ? { state: 'available', asOf: input.asOf, score, bucket, observedAt } : unavailable()
  } catch {
    return unavailable()
  }
}

type Candidate = { actual: unknown; releaseTime: string }

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

function unavailable(): Extract<FearGreedSnapshotResult, { state: 'unavailable' }> {
  return { state: 'unavailable', failureCode: fearGreedSnapshotPolicy.unavailableFailureCode }
}
