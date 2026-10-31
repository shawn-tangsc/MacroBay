import { describe, expect, it, vi } from 'vitest'

import { createPredictionVerificationService } from './predictionVerificationService'

describe('predictionVerificationService', () => {
  it('marks a due prediction insufficient-data when no comparable evidence is available', () => {
    const appendPredictionVerification = vi.fn()
    const updatePredictionStatus = vi.fn()
    const service = createPredictionVerificationService({
      repository: {
        listDuePredictions: vi.fn(() => [{ id: 'mi-pr-1', asset: 'BTC', conditions: ['price_return(BTC,15m)>=0.5%'], horizonStart: '2026-09-27T23:45:00.000Z', status: 'pending', verificationDueAt: '2026-09-28T00:00:00.000Z', horizonEnd: '2026-09-28T00:00:00.000Z' }]),
        appendPredictionVerification,
        updatePredictionStatus
      } as never,
      now: () => '2026-09-28T00:01:00.000Z',
      idFactory: () => 'mi-pv-1'
    })

    const result = service.verifyDue({ asOf: '2026-09-28T00:01:00.000Z', observations: [] })

    expect(result).toEqual({ verified: 1, skipped: 0 })
    expect(appendPredictionVerification).toHaveBeenCalledWith(expect.objectContaining({ id: 'mi-pv-1', predictionId: 'mi-pr-1', status: 'insufficient-data', reasonCode: 'no-comparable-observation' }))
    expect(updatePredictionStatus).toHaveBeenCalledWith({ id: 'mi-pr-1', status: 'insufficient-data' })
  })

  it('marks a due prediction insufficient-data when observations do not satisfy its supported condition', () => {
    const appendPredictionVerification = vi.fn()
    const service = createPredictionVerificationService({
      repository: {
        listDuePredictions: vi.fn(() => [{ id: 'mi-pr-2', asset: 'BTC', status: 'pending', verificationDueAt: '2026-09-28T00:00:00.000Z', horizonStart: '2026-09-27T23:00:00.000Z', horizonEnd: '2026-09-28T00:00:00.000Z', conditions: ['price_return(BTC,15m)>=0.5%'] }]),
        appendPredictionVerification,
        updatePredictionStatus: vi.fn()
      } as never,
      now: () => '2026-09-28T00:02:00.000Z',
      idFactory: () => 'mi-pv-2'
    })

    const result = service.verifyDue({ asOf: '2026-09-28T00:02:00.000Z', observations: [{ asset: 'ETH', observedAt: '2026-09-28T00:00:00.000Z', comparable: true, evidenceRefId: 'ev-eth' }] })

    expect(result).toEqual({ verified: 1, skipped: 0 })
    expect(appendPredictionVerification).toHaveBeenCalledWith(expect.objectContaining({ status: 'insufficient-data', reasonCode: 'no-comparable-observation' }))
  })

  it('does not duplicate a repeated watermark', () => {
    const appendPredictionVerification = vi.fn()
    const service = createPredictionVerificationService({
      repository: {
        listDuePredictions: vi.fn(() => [{ id: 'mi-pr-3', status: 'pending', verificationDueAt: '2026-09-28T00:00:00.000Z', horizonEnd: '2026-09-28T00:00:00.000Z' }]),
        appendPredictionVerification, updatePredictionStatus: vi.fn(), hasPredictionVerificationAt: vi.fn(() => true)
      } as never, now: () => '2026-09-28T00:02:00.000Z', idFactory: () => 'mi-pv-3'
    })
    expect(service.verifyDue({ asOf: '2026-09-28T00:02:00.000Z', observations: [] })).toEqual({ verified: 0, skipped: 1 })
    expect(appendPredictionVerification).not.toHaveBeenCalled()
  })

  it('confirms a supported price-return condition only with matching asset evidence', () => {
    const appendPredictionVerificationAndUpdateStatus = vi.fn()
    const service = createPredictionVerificationService({
      repository: {
        listDuePredictions: vi.fn(() => [{ id: 'mi-pr-4', asset: 'BTC', status: 'pending', horizonStart: '2026-09-28T00:00:00.000Z', horizonEnd: '2026-09-28T00:15:00.000Z', verificationDueAt: '2026-09-28T00:15:00.000Z', conditions: ['price_return(BTC,15m)>=0.5%'] }]),
        appendPredictionVerification: vi.fn(), updatePredictionStatus: vi.fn(), appendPredictionVerificationAndUpdateStatus
      } as never, now: () => '2026-09-28T00:16:00.000Z', idFactory: () => 'mi-pv-4'
    })
    expect(service.verifyDue({ asOf: '2026-09-28T00:16:00.000Z', observations: [{ asset: 'BTC', horizon: '15m', observedAt: '2026-09-28T00:15:00.000Z', comparable: true, evidenceRefId: 'ev-btc', priceReturnPct: 0.8 }] })).toEqual({ verified: 1, skipped: 0 })
    expect(appendPredictionVerificationAndUpdateStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', evidenceRefs: ['ev-btc'] }), { predicate: 'price_return(BTC,15m)>=0.5%', conditionCount: 1 })
  })

  it('does not use a comparable observation without an evidence reference to decide a prediction', () => {
    const appendPredictionVerificationAndUpdateStatus = vi.fn()
    const service = createPredictionVerificationService({
      repository: {
        listDuePredictions: vi.fn(() => [{ id: 'mi-pr-evidence', asset: 'BTC', status: 'pending', horizonStart: '2026-09-28T00:00:00.000Z', horizonEnd: '2026-09-28T00:15:00.000Z', verificationDueAt: '2026-09-28T00:15:00.000Z', conditions: ['price_return(BTC,15m)>=0.5%'] }]),
        appendPredictionVerification: vi.fn(), updatePredictionStatus: vi.fn(), appendPredictionVerificationAndUpdateStatus
      } as never, now: () => '2026-09-28T00:16:00.000Z', idFactory: () => 'mi-pv-evidence'
    })

    service.verifyDue({ asOf: '2026-09-28T00:16:00.000Z', observations: [{ asset: 'BTC', observedAt: '2026-09-28T00:15:00.000Z', comparable: true, priceReturnPct: 0.8 }] })

    expect(appendPredictionVerificationAndUpdateStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'insufficient-data', reasonCode: 'no-comparable-observation', evidenceRefs: [] }), { predicate: 'price_return(BTC,15m)>=0.5%', conditionCount: 1 })
  })

  it('verifies supported relative-return and funding-delta predicates with their matching observation', () => {
    const appendPredictionVerificationAndUpdateStatus = vi.fn()
    const service = createPredictionVerificationService({
      repository: {
        listDuePredictions: vi.fn(() => [{ id: 'mi-pr-derived', asset: 'BTC', status: 'pending', horizonStart: '2026-09-28T00:00:00.000Z', horizonEnd: '2026-09-28T08:00:00.000Z', verificationDueAt: '2026-09-28T08:00:00.000Z', conditions: ['relative_return(BTC,ETH,2h)>=1.0%', 'funding_delta(BTC,8h)<=0.05%'] }]),
        appendPredictionVerification: vi.fn(), updatePredictionStatus: vi.fn(), appendPredictionVerificationAndUpdateStatus
      } as never, now: () => '2026-09-28T08:01:00.000Z', idFactory: () => 'mi-pv-derived'
    })

    service.verifyDue({
      asOf: '2026-09-28T08:01:00.000Z',
      observations: [
        { asset: 'BTC', relativeToAsset: 'ETH', horizon: '2h', observedAt: '2026-09-28T02:00:00.000Z', comparable: true, evidenceRefId: 'ev-relative', relativeReturnPct: 1.1 },
        { asset: 'BTC', interval: '8h', observedAt: '2026-09-28T08:00:00.000Z', comparable: true, evidenceRefId: 'ev-funding', fundingDeltaPctPoints: 0.04 }
      ]
    })

    expect(appendPredictionVerificationAndUpdateStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', evidenceRefs: ['ev-relative', 'ev-funding'] }), { predicate: 'relative_return(BTC,ETH,2h)>=1% && funding_delta(BTC,8h)<=0.05%', conditionCount: 2 })
  })

  it('records a partially-confirmed result when supported conditions have mixed outcomes', () => {
    const appendPredictionVerificationAndUpdateStatus = vi.fn()
    const service = createPredictionVerificationService({
      repository: {
        listDuePredictions: vi.fn(() => [{ id: 'mi-pr-partial', asset: 'BTC', status: 'pending', horizonStart: '2026-09-28T00:00:00.000Z', horizonEnd: '2026-09-28T00:15:00.000Z', verificationDueAt: '2026-09-28T00:15:00.000Z', conditions: ['price_return(BTC,15m)>=0.5%', 'price_return(ETH,15m)>=0.5%'] }]),
        appendPredictionVerification: vi.fn(), updatePredictionStatus: vi.fn(), appendPredictionVerificationAndUpdateStatus
      } as never, now: () => '2026-09-28T00:16:00.000Z', idFactory: () => 'mi-pv-partial'
    })

    service.verifyDue({ asOf: '2026-09-28T00:16:00.000Z', observations: [
      { asset: 'BTC', horizon: '15m', observedAt: '2026-09-28T00:15:00.000Z', comparable: true, evidenceRefId: 'ev-btc', priceReturnPct: 0.8 },
      { asset: 'ETH', horizon: '15m', observedAt: '2026-09-28T00:15:00.000Z', comparable: true, evidenceRefId: 'ev-eth', priceReturnPct: 0.1 }
    ] })

    expect(appendPredictionVerificationAndUpdateStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'partially-confirmed' }), { predicate: 'price_return(BTC,15m)>=0.5% && price_return(ETH,15m)>=0.5%', conditionCount: 2 })
  })

  it('does not use an observation that arrived after the prediction horizon', () => {
    const appendPredictionVerificationAndUpdateStatus = vi.fn()
    const service = createPredictionVerificationService({
      repository: {
        listDuePredictions: vi.fn(() => [{ id: 'mi-pr-late', asset: 'BTC', status: 'pending', horizonStart: '2026-09-28T00:00:00.000Z', horizonEnd: '2026-09-28T00:15:00.000Z', verificationDueAt: '2026-09-28T00:15:00.000Z', conditions: ['price_return(BTC,15m)>=0.5%'] }]),
        appendPredictionVerification: vi.fn(), updatePredictionStatus: vi.fn(), appendPredictionVerificationAndUpdateStatus
      } as never, now: () => '2026-09-28T00:17:00.000Z', idFactory: () => 'mi-pv-late'
    })

    service.verifyDue({ asOf: '2026-09-28T00:17:00.000Z', observations: [{ asset: 'BTC', horizon: '15m', observedAt: '2026-09-28T00:16:00.000Z', comparable: true, evidenceRefId: 'ev-late', priceReturnPct: 0.8 }] })

    expect(appendPredictionVerificationAndUpdateStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'insufficient-data', reasonCode: 'no-comparable-observation' }), { predicate: 'price_return(BTC,15m)>=0.5%', conditionCount: 1 })
  })

  it('records unsupported predicates as insufficient-data without treating them as price observations', () => {
    const appendPredictionVerificationAndUpdateStatus = vi.fn()
    const service = createPredictionVerificationService({
      repository: {
        listDuePredictions: vi.fn(() => [{ id: 'mi-pr-unsupported', asset: 'BTC', status: 'pending', horizonStart: '2026-09-28T00:00:00.000Z', horizonEnd: '2026-09-28T00:15:00.000Z', verificationDueAt: '2026-09-28T00:15:00.000Z', conditions: ['BTC will go up'] }]),
        appendPredictionVerification: vi.fn(), updatePredictionStatus: vi.fn(), appendPredictionVerificationAndUpdateStatus
      } as never, now: () => '2026-09-28T00:16:00.000Z', idFactory: () => 'mi-pv-unsupported'
    })

    service.verifyDue({ asOf: '2026-09-28T00:16:00.000Z', observations: [{ asset: 'BTC', horizon: '15m', observedAt: '2026-09-28T00:15:00.000Z', comparable: true, evidenceRefId: 'ev-btc', priceReturnPct: 0.8 }] })

    expect(appendPredictionVerificationAndUpdateStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'insufficient-data', reasonCode: 'unsupported-condition', evidenceRefs: ['ev-btc'] }), { predicate: null, conditionCount: 1 })
  })

  it('records the first stored conditions and the full count when a prediction carries more than the ledger keeps', () => {
    const appendPredictionVerificationAndUpdateStatus = vi.fn()
    const conditions = Array.from({ length: 10 }, (_, index) => `price_return(BTC,15m)>=0.${index + 1}%`)
    const service = createPredictionVerificationService({
      repository: {
        listDuePredictions: vi.fn(() => [{ id: 'mi-pr-many', asset: 'BTC', status: 'pending', horizonStart: '2026-09-28T00:00:00.000Z', horizonEnd: '2026-09-28T00:15:00.000Z', verificationDueAt: '2026-09-28T00:15:00.000Z', conditions }]),
        appendPredictionVerification: vi.fn(), updatePredictionStatus: vi.fn(), appendPredictionVerificationAndUpdateStatus
      } as never, now: () => '2026-09-28T00:16:00.000Z', idFactory: () => 'mi-pv-many'
    })

    service.verifyDue({ asOf: '2026-09-28T00:16:00.000Z', observations: [{ asset: 'BTC', horizon: '15m', observedAt: '2026-09-28T00:15:00.000Z', comparable: true, evidenceRefId: 'ev-btc', priceReturnPct: 5 }] })

    const call = appendPredictionVerificationAndUpdateStatus.mock.calls[0] as [unknown, Readonly<{ predicate: string; conditionCount: number }>]
    expect(call[0]).toMatchObject({ status: 'confirmed' })
    // The verdict is decided on all ten; the record keeps eight and says how many there were.
    expect(call[1].conditionCount).toBe(10)
    expect(call[1].predicate.split(' && ')).toHaveLength(8)
    expect(call[1].predicate.startsWith('price_return(BTC,15m)>=0.1%')).toBe(true)
  })
})
