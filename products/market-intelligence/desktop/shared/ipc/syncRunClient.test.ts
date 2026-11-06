import { describe, expect, it } from 'vitest'

import { sanitize } from './syncRunClient'

const row = (analysis: unknown) => ({
  at: '2026-11-06T10:06:03.000Z',
  runId: 'run-9',
  correlationId: 'run-9',
  taskLabel: 'AI 分析',
  handlerId: 'market-intelligence.runMarketAnalysis',
  action: 'analysis',
  outcome: 'succeeded',
  sources: [],
  analysis
})

function rows(value: unknown) {
  const result = sanitize({ state: 'available', rows: [row(value)] })
  if (result.state !== 'available') throw new Error('expected an available result')
  return result.rows[0]!.analysis
}

describe('sync run client analysis column', () => {
  it('keeps the linked record, its codes and its model', () => {
    expect(
      rows({
        state: 'linked',
        result: {
          runId: 'mi-ar-1',
          state: 'failed',
          failureCode: 'analysis-provider-error',
          failureDetailCode: 'upstream-aborted',
          startedAt: '2026-11-06T10:05:02.000Z',
          completedAt: '2026-11-06T10:06:03.000Z',
          modelProviderId: 'tokenrhythm',
          modelId: 'deepseek-v4.1-flash-1017'
        }
      })
    ).toEqual({
      state: 'linked',
      result: {
        runId: 'mi-ar-1',
        state: 'failed',
        failureCode: 'analysis-provider-error',
        failureDetailCode: 'upstream-aborted',
        startedAt: '2026-11-06T10:05:02.000Z',
        completedAt: '2026-11-06T10:06:03.000Z',
        modelProviderId: 'tokenrhythm',
        modelId: 'deepseek-v4.1-flash-1017'
      }
    })
  })

  it('says the result is unavailable when the payload did not carry one', () => {
    // "We could not read it" must not be drawn as "there is none" or as "not applicable".
    expect(rows(undefined)).toEqual({ state: 'unavailable' })
    expect(rows({ state: 'linked' })).toEqual({ state: 'unavailable' })
    expect(rows({ state: 'linked', result: { state: 'failed' } })).toEqual({ state: 'unavailable' })
  })

  it('keeps the two definite answers definite', () => {
    expect(rows({ state: 'not-applicable' })).toEqual({ state: 'not-applicable' })
    expect(rows({ state: 'unlinked' })).toEqual({ state: 'unlinked' })
  })
})
