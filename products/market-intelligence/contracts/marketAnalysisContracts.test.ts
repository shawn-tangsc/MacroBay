import { describe, expect, it } from 'vitest'

import {
  MARKET_ANALYSIS_CONTRACT_POLICY,
  MARKET_ANALYSIS_ERROR_CODES,
  MARKET_ANALYSIS_ID_PREFIXES,
  MARKET_ANALYSIS_QUERY_STATES,
  MARKET_ANALYSIS_DOMAIN_ADMISSIONS,
  isMarketAnalysisCanonicalUtc,
  isMarketAnalysisFiniteNumber,
  isMarketAnalysisId
} from './marketAnalysisContracts'

describe('marketAnalysisContracts', () => {
  it('owns the schema, bounded model-output, and immutable ID policy', () => {
    expect(MARKET_ANALYSIS_CONTRACT_POLICY).toMatchObject({
      schemaVersion: 1,
      dataAccessProfileId: 'crypto-market-analysis-v1',
      maximumModelFieldCharacters: 2_000,
      maximumModelOutputBytes: 256 * 1024
    })
    expect(MARKET_ANALYSIS_ERROR_CODES).toMatchObject({
      providerNotReady: 'analysis-provider-not-ready',
      providerError: 'analysis-provider-error',
      timeout: 'analysis-timeout',
      cancelled: 'analysis-cancelled',
      contextMaxFactsInvalid: 'analysis-context-max-facts-invalid',
      storageFailed: 'analysis-storage-failed',
      notAvailable: 'analysis-not-available'
    })
    expect(MARKET_ANALYSIS_ID_PREFIXES).toMatchObject({
      eventGroup: 'mi-eg-',
      evidenceSnapshot: 'mi-es-',
      analysisRun: 'mi-ar-',
      summary: 'mi-as-',
      prediction: 'mi-pr-',
      predictionVerification: 'mi-pv-',
      timelineEntry: 'mi-tl-'
    })
  })

  it('accepts only canonical UTC millisecond timestamps', () => {
    expect(isMarketAnalysisCanonicalUtc('2026-09-25T08:30:00.000Z')).toBe(true)
    expect(isMarketAnalysisCanonicalUtc('2026-09-25T08:30:00Z')).toBe(false)
    expect(isMarketAnalysisCanonicalUtc('2026-09-25T08:30:00.000+00:00')).toBe(false)
    expect(isMarketAnalysisCanonicalUtc('not-a-time')).toBe(false)
  })

  it('accepts finite numbers but rejects NaN, infinity, and negative zero', () => {
    expect(isMarketAnalysisFiniteNumber(0)).toBe(true)
    expect(isMarketAnalysisFiniteNumber(0.5)).toBe(true)
    expect(isMarketAnalysisFiniteNumber(-0)).toBe(false)
    expect(isMarketAnalysisFiniteNumber(Number.NaN)).toBe(false)
    expect(isMarketAnalysisFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('requires each persisted record ID to use its owning prefix', () => {
    expect(isMarketAnalysisId('eventGroup', 'mi-eg-0172f72f-2e47-7b3c-bc6b-70ef9496f1a5')).toBe(true)
    expect(isMarketAnalysisId('analysisRun', 'mi-eg-0172f72f-2e47-7b3c-bc6b-70ef9496f1a5')).toBe(false)
    expect(isMarketAnalysisId('prediction', 'mi-pr-')).toBe(false)
  })

  it('owns the six-state data-access vocabulary without treating runtime state as admission', () => {
    expect(MARKET_ANALYSIS_DOMAIN_ADMISSIONS).toEqual([
      'production-ready',
      'connected-but-not-agent-tool',
      'fixture-only',
      'planned',
      'blocked',
      'temporarily-paused'
    ])
    expect(MARKET_ANALYSIS_QUERY_STATES).toEqual([
      'available',
      'empty',
      'stale',
      'unavailable',
      'missing',
      'not-comparable'
    ])
  })
})
