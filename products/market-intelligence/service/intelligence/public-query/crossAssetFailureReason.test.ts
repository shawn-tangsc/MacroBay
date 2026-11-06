import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { crossAssetNotWired, crossAssetRejected, crossAssetThrew } from './crossAssetFailureReason'

/**
 * Three failures, three names. The point is that they can never be mistaken for one another at a
 * surface: "not wired" is a build problem, "threw" is a runtime problem, and "rejected" is the data
 * being wrong — a reader told "cross-asset domain missing" for any of them learns nothing.
 */
describe('cross-asset failure reasons', () => {
  it('names the three situations differently', () => {
    const reasons = [crossAssetNotWired(), crossAssetThrew(new Error('boom')), crossAssetRejected('closedReturns.missing:4h')]
    expect(reasons).toEqual(['not-wired', 'threw:boom', 'rejected:closedReturns.missing:4h'])
    expect(new Set(reasons.map((reason) => reason.split(':')[0]))).toEqual(new Set(['not-wired', 'threw', 'rejected']))
  })

  it('bounds a thrown message instead of pasting it whole', () => {
    const reason = crossAssetThrew(new Error(`x\n${'y'.repeat(400)}`))
    expect(reason.startsWith('threw:x ')).toBe(true)
    expect(reason.length).toBeLessThanOrEqual(128)
  })

  it('says the rejection itself is unknown when no field is known', () => {
    expect(crossAssetRejected()).toBe('rejected:unparsed')
  })

  it('keeps the service from folding a failure back into a bare undefined', () => {
    // A bare `catch { return undefined }` is how this bug started: the reader gets nothing and no
    // reason. Any new outlet must record its reason first.
    const source = readFileSync('products/market-intelligence/service/intelligence/public-query/publicQueryService.ts', 'utf8')
    // The cross-asset outlet specifically: from its method to its setter. The macro snapshots keep
    // their folding for now and are recorded as the same class of problem, to be named when the
    // maintenance rule is announced.
    const outlet = source.slice(source.indexOf('async queryCrossAssetSnapshot'), source.indexOf('setCrossAssetQuery'))
    expect(outlet).not.toMatch(/catch\s*\{\s*return undefined\s*\}/)
    expect(source).toContain('recordCrossAssetFailure(crossAssetNotWired())')
    expect(source).toContain('recordCrossAssetFailure(crossAssetThrew(error))')
    expect(source).toContain('crossAssetRejected(rejection.field)')
    expect(source).toContain('readCrossAssetFailure()')
  })
})
