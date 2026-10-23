import { createHash } from 'node:crypto'

import { MARKET_ANALYSIS_ERROR_CODES, isMarketAnalysisFiniteNumber, type AnalysisPhase } from '../../../contracts/marketAnalysisContracts'

export type AnalysisIdempotencyInput = Readonly<{
  eventGroupId: string
  snapshotHash: string
  analysisPhase: AnalysisPhase
  triggerKey: string
}>

export function canonicalizeMarketAnalysisJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function hashMarketAnalysisJson(value: unknown): string {
  return createHash('sha256').update(canonicalizeMarketAnalysisJson(value)).digest('hex')
}

export function buildAnalysisIdempotencyKey(input: AnalysisIdempotencyInput): string {
  return hashMarketAnalysisJson(input)
}

export type AnalysisSnapshotHashInput = Readonly<{
  profileId: string
  asOf: string
  dataCutoff: string
  facts: readonly unknown[]
  missingDomains: readonly string[]
  caveats: readonly string[]
  evidenceRefs: readonly unknown[]
}>

/**
 * Projects a snapshot onto exactly the fields `snapshotHash` covers.
 *
 * Both the hash builder and the persistence validator must use this projection.
 * The derived `change` record is audit metadata and is deliberately excluded, so a
 * snapshot stays hash-stable whether or not the record is present.
 */
export function snapshotHashInput(snapshot: Readonly<{
  profileId: string
  asOf: string
  dataCutoff: string
  facts: readonly unknown[]
  missingDomains: readonly string[]
  caveats: readonly string[]
  evidenceRefs: readonly unknown[]
}>): AnalysisSnapshotHashInput {
  return {
    profileId: snapshot.profileId,
    asOf: snapshot.asOf,
    dataCutoff: snapshot.dataCutoff,
    facts: snapshot.facts,
    missingDomains: snapshot.missingDomains,
    caveats: snapshot.caveats,
    evidenceRefs: snapshot.evidenceRefs
  }
}

export function buildAnalysisSnapshotHash(input: AnalysisSnapshotHashInput): string {
  return hashMarketAnalysisJson({
    profileId: input.profileId,
    asOf: input.asOf,
    dataCutoff: input.dataCutoff,
    facts: [...input.facts].sort(compareByIdentityKeys(['domain', 'factId'])),
    missingDomains: [...input.missingDomains].sort(),
    caveats: [...input.caveats].sort(),
    evidenceRefs: [...input.evidenceRefs].sort(compareByIdentity('evidenceRefId'))
  })
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!isMarketAnalysisFiniteNumber(value)) throw new Error(MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema)
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainRecord(value)) throw new Error(MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema)

  return Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = canonicalize(value[key])
    return result
  }, {})
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
}

function compareByIdentity(key: string): (left: unknown, right: unknown) => number {
  return compareByIdentityKeys([key])
}

function compareByIdentityKeys(keys: readonly string[]): (left: unknown, right: unknown) => number {
  return (left, right) => {
    for (const key of keys) {
      const result = String((left as Record<string, unknown>)[key]).localeCompare(String((right as Record<string, unknown>)[key]))
      if (result !== 0) return result
    }
    return 0
  }
}
