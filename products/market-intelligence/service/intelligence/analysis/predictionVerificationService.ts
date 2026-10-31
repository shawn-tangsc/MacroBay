import type { Prediction, PredictionLedgerCondition, PredictionVerification } from '../../../contracts/marketAnalysisContracts'
import { PREDICTION_LEDGER_SHAPE_POLICY } from '../../../contracts/marketAnalysisContracts'

/**
 * Exported so the horizon list the verifier checks can be asserted against the window policy the
 * analysis context reads (`crossAssetAnalysisWindows`): one mapping, two consumers, no drift.
 */
export const predictionVerificationPolicy = Object.freeze({
  owner: 'market-intelligence.prediction-verification-service',
  ruleVersion: 'prediction-verification.v1' as const,
  supportedAssets: ['BTC', 'ETH'] as const,
  supportedPriceHorizons: ['15m', '2h', '24h', '3d'] as const,
  supportedFundingIntervals: ['8h'] as const,
  predicatePattern: /^(price_return|relative_return|funding_delta)\(([^)]+)\)(>=|<=)(-?\d+(?:\.\d+)?)%$/u
})

type Asset = typeof predictionVerificationPolicy.supportedAssets[number]
type PriceHorizon = typeof predictionVerificationPolicy.supportedPriceHorizons[number]
type FundingInterval = typeof predictionVerificationPolicy.supportedFundingIntervals[number]
export type PredictionVerificationObservation = Readonly<{
  asset?: Asset
  relativeToAsset?: Asset
  horizon?: PriceHorizon
  interval?: FundingInterval
  observedAt: string
  comparable: boolean
  evidenceRefId?: string
  priceReturnPct?: number
  fundingDeltaPctPoints?: number
  relativeReturnPct?: number
}>
type Repository = Readonly<{
  listDuePredictions: (asOf: string) => readonly Prediction[]
  appendPredictionVerification: (value: PredictionVerification) => void
  updatePredictionStatus: (value: { id: string; status: Prediction['status'] }) => void
  /**
   * The one path that also writes the verdict ledger, because the ledger line has to travel in the same
   * transaction as the verdict: a verdict without its line, or a line without its verdict, would make the
   * calibration sample disagree with the record of how it was decided.
   */
  appendPredictionVerificationAndUpdateStatus?: (value: PredictionVerification, condition: PredictionLedgerCondition) => void
  hasPredictionVerificationAt?: (predictionId: string, evaluatedAt: string) => boolean
}>
type Evaluation = Readonly<{
  reasonCode: 'confirmed' | 'partially-confirmed' | 'invalidated' | 'unsupported-condition' | 'no-comparable-observation'
  status: Prediction['status']
  reason: string
  evidenceRefs: readonly string[]
  /** The machine conditions the verdict was decided on; null when the prediction carried none we can check. */
  predicate: string | null
}>
type Predicate =
  | Readonly<{ kind: 'price-return'; asset: Asset; horizon: PriceHorizon; operator: '>=' | '<='; threshold: number }>
  | Readonly<{ kind: 'relative-return'; asset: Asset; relativeToAsset: Asset; horizon: PriceHorizon; operator: '>=' | '<='; threshold: number }>
  | Readonly<{ kind: 'funding-delta'; asset: Asset; interval: FundingInterval; operator: '>=' | '<='; threshold: number }>

export function createPredictionVerificationService(deps: Readonly<{
  repository: Repository
  now: () => string
  idFactory: () => string
}>): Readonly<{ verifyDue: (input: { asOf: string; observations: readonly PredictionVerificationObservation[] }) => { verified: number; skipped: number } }> {
  function verifyDue(input: { asOf: string; observations: readonly PredictionVerificationObservation[] }) {
    let verified = 0
    let skipped = 0
    for (const prediction of deps.repository.listDuePredictions(input.asOf)) {
      if (deps.repository.hasPredictionVerificationAt?.(prediction.id, input.asOf)) {
        skipped += 1
        continue
      }
      const evaluation = evaluateConditions(prediction, input.observations, input.asOf)
      const verification: PredictionVerification = {
        id: deps.idFactory(), predictionId: prediction.id, status: evaluation.status, evaluatedAt: input.asOf,
        ruleVersion: predictionVerificationPolicy.ruleVersion, evidenceRefs: evaluation.evidenceRefs,
        reasonCode: evaluation.reasonCode, reason: evaluation.reason
      }
      const condition = { predicate: evaluation.predicate, conditionCount: prediction.conditions.length }
      if (deps.repository.appendPredictionVerificationAndUpdateStatus) deps.repository.appendPredictionVerificationAndUpdateStatus(verification, condition)
      else {
        // A repository that cannot write both in one transaction keeps the verdict alone. It is the older
        // shape, and the ledger's own check refuses to invent a line it was not handed.
        deps.repository.appendPredictionVerification(verification)
        deps.repository.updatePredictionStatus({ id: prediction.id, status: verification.status })
      }
      verified += 1
    }
    return { verified, skipped }
  }
  return { verifyDue }
}

function evaluateConditions(prediction: Prediction, values: readonly PredictionVerificationObservation[], asOf: string): Evaluation {
  const observations = values.filter(value => isComparableObservation(value, prediction, asOf))
  const evidenceRefs = uniqueEvidenceRefs(observations)
  const predicates = prediction.conditions.map(parsePredicate)
  if (predicates.length === 0 || predicates.some(predicate => predicate === undefined)) {
    return { reasonCode: 'unsupported-condition', status: 'insufficient-data', reason: '预测条件暂不支持确定性验证。', evidenceRefs, predicate: null }
  }
  const parsed = predicates.filter((predicate): predicate is Predicate => predicate !== undefined)
  const predicate = canonicalPredicates(parsed)
  const matches = parsed.map(item => matchesPredicate(item, observations))
  if (matches.some((match): match is undefined => match === undefined)) {
    return { reasonCode: 'no-comparable-observation', status: 'insufficient-data', reason: '预测窗口内没有可比行情观测。', evidenceRefs, predicate }
  }
  const matched = matches.filter(Boolean).length
  if (matched === matches.length) return { reasonCode: 'confirmed', status: 'confirmed', reason: '可比行情观测满足预测条件。', evidenceRefs, predicate }
  if (matched === 0) return { reasonCode: 'invalidated', status: 'invalidated', reason: '可比行情观测未满足预测条件。', evidenceRefs, predicate }
  return { reasonCode: 'partially-confirmed', status: 'partially-confirmed', reason: '可比行情观测仅满足部分预测条件。', evidenceRefs, predicate }
}

/**
 * The conditions as one canonical line, capped at the ledger's stored-condition limit.
 *
 * The cap is the ledger's, not the verifier's: the verdict is decided on every condition, and only the
 * *record* of what was decided keeps the first few. `conditionCount` on the ledger line carries the full
 * number, so a capped line is arithmetic, not a guess.
 */
function canonicalPredicates(predicates: readonly Predicate[]): string {
  return predicates.slice(0, PREDICTION_LEDGER_SHAPE_POLICY.maximumStoredConditions).map(formatPredicate).join(' && ')
}

/** The canonical spelling of a predicate: the same text `parsePredicate` reads back. */
function formatPredicate(predicate: Predicate): string {
  if (predicate.kind === 'price-return') return `price_return(${predicate.asset},${predicate.horizon})${predicate.operator}${predicate.threshold}%`
  if (predicate.kind === 'relative-return') return `relative_return(${predicate.asset},${predicate.relativeToAsset},${predicate.horizon})${predicate.operator}${predicate.threshold}%`
  return `funding_delta(${predicate.asset},${predicate.interval})${predicate.operator}${predicate.threshold}%`
}

function isComparableObservation(value: PredictionVerificationObservation, prediction: Prediction, asOf: string): value is PredictionVerificationObservation & Required<Pick<PredictionVerificationObservation, 'asset' | 'evidenceRefId'>> {
  return value.comparable && Boolean(value.asset) && Boolean(value.evidenceRefId) && isCanonicalTime(value.observedAt) &&
    value.observedAt >= prediction.horizonStart && value.observedAt <= prediction.horizonEnd && value.observedAt <= asOf
}

function parsePredicate(value: string): Predicate | undefined {
  const match = predictionVerificationPolicy.predicatePattern.exec(value.trim())
  if (!match) return undefined
  const kind = match[1]
  const args = match[2].split(',').map(value => value.trim())
  const operator = match[3] as '>=' | '<='
  const threshold = Number(match[4])
  if (!Number.isFinite(threshold)) return undefined
  if (kind === 'price_return' && args.length === 2 && isAsset(args[0]) && isPriceHorizon(args[1])) return { kind: 'price-return', asset: args[0], horizon: args[1], operator, threshold }
  if (kind === 'relative_return' && args.length === 3 && isAsset(args[0]) && isAsset(args[1]) && isPriceHorizon(args[2])) return { kind: 'relative-return', asset: args[0], relativeToAsset: args[1], horizon: args[2], operator, threshold }
  if (kind === 'funding_delta' && args.length === 2 && isAsset(args[0]) && isFundingInterval(args[1])) return { kind: 'funding-delta', asset: args[0], interval: args[1], operator, threshold }
  return undefined
}

function matchesPredicate(predicate: Predicate, observations: readonly PredictionVerificationObservation[]): boolean | undefined {
  if (predicate.kind === 'price-return') {
    const observation = observations.find(value => value.asset === predicate.asset && value.horizon === predicate.horizon && isFiniteValue(value.priceReturnPct))
    const value = observation?.priceReturnPct
    return value !== undefined && Number.isFinite(value) ? matchesThreshold(value, predicate) : undefined
  }
  if (predicate.kind === 'relative-return') {
    const observation = observations.find(value => value.asset === predicate.asset && value.relativeToAsset === predicate.relativeToAsset && value.horizon === predicate.horizon && isFiniteValue(value.relativeReturnPct))
    const value = observation?.relativeReturnPct
    return value !== undefined && Number.isFinite(value) ? matchesThreshold(value, predicate) : undefined
  }
  const observation = observations.find(value => value.asset === predicate.asset && value.interval === predicate.interval && isFiniteValue(value.fundingDeltaPctPoints))
  const value = observation?.fundingDeltaPctPoints
  return value !== undefined && Number.isFinite(value) ? matchesThreshold(value, predicate) : undefined
}

function matchesThreshold(value: number, predicate: Pick<Predicate, 'operator' | 'threshold'>): boolean {
  return predicate.operator === '>=' ? value >= predicate.threshold : value <= predicate.threshold
}

function uniqueEvidenceRefs(values: readonly PredictionVerificationObservation[]): string[] {
  return [...new Set(values.flatMap(value => value.evidenceRefId ? [value.evidenceRefId] : []))]
}

function isAsset(value: string | undefined): value is Asset {
  return predictionVerificationPolicy.supportedAssets.some(asset => asset === value)
}

function isPriceHorizon(value: string | undefined): value is PriceHorizon {
  return predictionVerificationPolicy.supportedPriceHorizons.some(horizon => horizon === value)
}

function isFundingInterval(value: string | undefined): value is FundingInterval {
  return predictionVerificationPolicy.supportedFundingIntervals.some(interval => interval === value)
}

function isFiniteValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isCanonicalTime(value: string): boolean {
  try { return new Date(value).toISOString() === value } catch { return false }
}
