import { describe, expect, it } from 'vitest'

import { PREDICTION_LEDGER_SHAPE_POLICY, type PredictionLedgerEntry } from '../../../contracts/marketAnalysisContracts'
import { predictionLedgerBudget, predictionLedgerCutoffIso, predictionLedgerRetentionPolicy } from './predictionLedgerRetention'

const dayMs = 24 * 3_600_000

/**
 * A verdict row at every cap at once: the longest ids, every stored condition, every stored evidence ref.
 * Its serialized size is what the ceiling has to cover, so raising a cap fails here instead of quietly
 * widening a six-month ledger.
 */
function worstCaseEntry(): PredictionLedgerEntry {
  return {
    predictionId: `mi-pr-${'0'.repeat(36)}`,
    schemaVersion: 1,
    asset: 'ETH',
    horizonStart: '2026-10-31T23:59:59.999Z',
    horizonEnd: '2026-11-03T23:59:59.999Z',
    predicate: Array.from({ length: PREDICTION_LEDGER_SHAPE_POLICY.maximumStoredConditions }, () => 'relative_return(BTC,ETH,24h)<=-0.0123456%').join(' && '),
    conditionCount: 99,
    status: 'partially-confirmed',
    reasonCode: 'no-comparable-observation',
    ruleVersion: 'prediction-verification.v1',
    evidenceRefs: Array.from({ length: PREDICTION_LEDGER_SHAPE_POLICY.maximumStoredEvidenceRefs }, (_, index) => `query:binance-cross-asset:capital:BTC:close:2026-10-31T23:59:59.999Z:${index}`),
    evidenceRefCount: 120,
    predictionCreatedAt: '2026-10-31T23:45:00.000Z',
    evaluatedAt: '2026-11-03T23:59:59.999Z'
  }
}

/** What the store actually writes per row: the columns, with the evidence list as its own JSON value. */
function storedBytes(entry: PredictionLedgerEntry): number {
  return Buffer.byteLength([
    entry.predictionId, '1', entry.asset, entry.horizonStart, entry.horizonEnd, entry.predicate ?? '',
    String(entry.conditionCount), entry.status, entry.reasonCode, entry.ruleVersion,
    JSON.stringify(entry.evidenceRefs), String(entry.evidenceRefCount), entry.predictionCreatedAt, entry.evaluatedAt
  ].join(''))
}

describe('the verdict ledger’s window', () => {
  it('keeps six months measured from the verdict, not from the prediction', () => {
    expect(predictionLedgerRetentionPolicy.keepMs).toBe(180 * dayMs)
    // Fourteen days is the conclusion's window; the ledger's is the one that makes a hit rate count.
    expect(predictionLedgerRetentionPolicy.keepMs).toBeGreaterThan(14 * dayMs)
    expect(predictionLedgerCutoffIso(Date.parse('2026-10-31T00:00:00.000Z'))).toBe('2026-05-04T00:00:00.000Z')
  })

  it('permits a thousand and eighty rows at the daily ceiling and keeps them inside one disk budget', () => {
    const budget = predictionLedgerBudget()
    expect(budget.maximumRows).toBe(180 * predictionLedgerRetentionPolicy.maximumRowsPerDay)
    expect(budget.maximumRows).toBe(1_080)
    expect(budget.maximumBytes).toBe(1_080 * predictionLedgerRetentionPolicy.maximumRowBytes)
    expect(budget.withinBudget).toBe(true)
    expect(budget.maximumBytes).toBeLessThanOrEqual(predictionLedgerRetentionPolicy.budgetBytes)
  })
})

describe('the verdict ledger’s row shape', () => {
  it('stores a row at every cap within the ceiling the budget above assumes', () => {
    const entry = worstCaseEntry()
    expect(entry.predicate?.split(' && ')).toHaveLength(PREDICTION_LEDGER_SHAPE_POLICY.maximumStoredConditions)
    expect(entry.evidenceRefs).toHaveLength(PREDICTION_LEDGER_SHAPE_POLICY.maximumStoredEvidenceRefs)
    expect(storedBytes(entry)).toBeLessThanOrEqual(predictionLedgerRetentionPolicy.maximumRowBytes)
  })

  it('is bounded by caps, not by what a model happens to emit', () => {
    // A prediction may carry more conditions and cite more evidence than the record keeps; the full counts
    // are what make a capped row readable as capped.
    expect(worstCaseEntry().conditionCount).toBeGreaterThan(PREDICTION_LEDGER_SHAPE_POLICY.maximumStoredConditions)
    expect(worstCaseEntry().evidenceRefCount).toBeGreaterThan(PREDICTION_LEDGER_SHAPE_POLICY.maximumStoredEvidenceRefs)
    // A typical row (one predicate, a handful of refs) is far below the ceiling, which is why the ceiling is
    // what it is rather than the typical size.
    expect(storedBytes({ ...worstCaseEntry(), predicate: 'price_return(BTC,15m)>=0.5%', conditionCount: 1, evidenceRefs: ['ev-A'], evidenceRefCount: 1 }))
      .toBeLessThan(predictionLedgerRetentionPolicy.maximumRowBytes / 2)
  })
})
