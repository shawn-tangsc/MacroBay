import {
  fearGreedSnapshotPolicy,
  isCanonicalFearGreedSnapshotTime,
  isFearGreedSnapshotScore,
  resolveFearGreedSnapshotBucket,
  type FearGreedSnapshotQueryInput,
  type FearGreedSnapshotResult
} from '../../../contracts/intelligenceQueryContracts'
import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'

const productId = 'market-intelligence'

export type IntelligenceFearGreedClient = {
  querySnapshot: (input: FearGreedSnapshotQueryInput) => Promise<FearGreedSnapshotResult>
}

export const intelligenceFearGreedClient: IntelligenceFearGreedClient = {
  async querySnapshot(input) {
    try {
      if (!isInput(input)) return unavailable()
      return sanitize(await window.platform?.products?.invoke(productId, INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFearGreedSnapshot, { asOf: input.asOf }), input)
    } catch {
      return unavailable()
    }
  }
}

function isInput(value: unknown): value is FearGreedSnapshotQueryInput {
  return isExactRecord(value, ['asOf']) && isCanonicalFearGreedSnapshotTime(value.asOf)
}

function sanitize(value: unknown, input: FearGreedSnapshotQueryInput): FearGreedSnapshotResult {
  if (isExactRecord(value, ['state', 'asOf', 'score', 'bucket', 'observedAt']) && value.state === 'available' &&
    value.asOf === input.asOf && isFearGreedSnapshotScore(value.score) && isCanonicalFearGreedSnapshotTime(value.observedAt) && value.observedAt <= input.asOf) {
    const bucket = resolveFearGreedSnapshotBucket(value.score)
    if (bucket && value.bucket === bucket) return { state: 'available', asOf: value.asOf, score: value.score, bucket, observedAt: value.observedAt }
  }
  if (isExactRecord(value, ['state', 'asOf']) && value.state === 'empty' && value.asOf === input.asOf) return { state: 'empty', asOf: value.asOf }
  if (isExactRecord(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === fearGreedSnapshotPolicy.unavailableFailureCode) return unavailable()
  return unavailable()
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return descriptor?.enumerable === true && 'value' in descriptor
    })
  } catch {
    return false
  }
}

function unavailable(): Extract<FearGreedSnapshotResult, { state: 'unavailable' }> {
  return { state: 'unavailable', failureCode: fearGreedSnapshotPolicy.unavailableFailureCode }
}
