import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadMarketAnalysisRunOutcome } from './marketAnalysisRunOutcome'

const at = '2026-11-11T07:03:10.189Z'

afterEach(() => vi.unstubAllGlobals())

const run = {
  id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'invalid-output',
  failureCode: 'analysis-missing-evidence', queuedAt: at, startedAt: at, completedAt: at,
  asOf: at, dataCutoff: at, evidenceCount: 3
}

describe('loadMarketAnalysisRunOutcome', () => {
  it('reads one run by id and keeps only what the card shows', async () => {
    const invoke = vi.fn(async () => run)
    vi.stubGlobal('window', { platform: { products: { invoke } } })
    await expect(loadMarketAnalysisRunOutcome('mi-ar-1')).resolves.toEqual({
      state: 'available',
      run: { id: 'mi-ar-1', status: 'invalid-output', failureCode: 'analysis-missing-evidence', queuedAt: at, startedAt: at, completedAt: at }
    })
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'marketAnalysis.getAnalysisRun', { id: 'mi-ar-1' })
  })

  it('separates "no record" from "could not read"', async () => {
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => { throw new Error('analysis-run-not-found') }) } } })
    await expect(loadMarketAnalysisRunOutcome('mi-ar-x')).resolves.toEqual({ state: 'no-record' })

    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => { throw new Error('ipc down') }) } } })
    await expect(loadMarketAnalysisRunOutcome('mi-ar-1')).resolves.toEqual({ state: 'unreadable' })
  })

  it('refuses a payload it cannot trust instead of rendering half a card', async () => {
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => ({ ...run, status: 'weird' })) } } })
    await expect(loadMarketAnalysisRunOutcome('mi-ar-1')).resolves.toEqual({ state: 'unreadable' })
  })
})
