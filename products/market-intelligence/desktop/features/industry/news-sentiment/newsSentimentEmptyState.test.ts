import { describe, expect, it } from 'vitest'

import { resolveNewsSentimentEmptyState } from './newsSentimentEmptyState'

const readiness = (overrides: Partial<NonNullable<Parameters<typeof resolveNewsSentimentEmptyState>[0]['readiness']>> = {}) => ({
  total: 4, enabledCount: 4, failedCount: 0, neverRanCount: 0,
  failedSourceIds: [], neverRanSourceIds: [],
  ...overrides
})

const base = {
  state: 'empty' as const,
  itemCount: 0,
  windowStart: '2026-10-31T12:00:00.000Z'
}

describe('news sentiment empty state', () => {
  it('says nothing when there are rows', () => {
    expect(resolveNewsSentimentEmptyState({ ...base, state: 'available', itemCount: 3, readiness: readiness() })).toBeUndefined()
  })

  it('names the four causes that are not "quiet"', () => {
    expect(resolveNewsSentimentEmptyState({ ...base, readiness: readiness({ enabledCount: 0 }) })).toEqual({ kind: 'sources-disabled' })
    expect(resolveNewsSentimentEmptyState({ ...base, readiness: readiness({ failedCount: 4 }) })).toEqual({ kind: 'collection-failed' })
    expect(resolveNewsSentimentEmptyState({ ...base, readiness: readiness({ neverRanCount: 4 }) })).toEqual({ kind: 'never-ran' })
    expect(resolveNewsSentimentEmptyState({ ...base, latestKnownItemAt: '2026-10-31T09:00:00.000Z', readiness: readiness() }))
      .toEqual({ kind: 'stale', lastKnownItemAt: '2026-10-31T09:00:00.000Z' })
  })

  it('treats a partial failure or a partial run as no explanation at all', () => {
    // One source down still delivers news; saying "collection failed" would be a false cause.
    expect(resolveNewsSentimentEmptyState({ ...base, readiness: readiness({ failedCount: 1 }) })).toEqual({ kind: 'quiet' })
    expect(resolveNewsSentimentEmptyState({ ...base, readiness: readiness({ neverRanCount: 2, enabledCount: 4 }) })).toEqual({ kind: 'quiet' })
  })

  it('calls a genuinely empty period quiet, not stale', () => {
    expect(resolveNewsSentimentEmptyState({ ...base, readiness: readiness() })).toEqual({ kind: 'quiet' })
    // A judgment inside the window cannot make the window stale.
    expect(resolveNewsSentimentEmptyState({ ...base, latestKnownItemAt: '2026-10-31T12:30:00.000Z', readiness: readiness() }))
      .toEqual({ kind: 'quiet' })
  })

  it('does not explain a failed read as an empty window', () => {
    expect(resolveNewsSentimentEmptyState({ ...base, state: 'unavailable', readiness: readiness({ enabledCount: 0 }) })).toBeUndefined()
  })
})

describe('a window with unjudged news is not a quiet window', () => {
  it('names "arrived but not judged", and the cause when it is known', () => {
    // 2026-11-18：规则没命中不写判定行，于是空列表可能是「有新闻但没判」。说「安静」就是假话。
    expect(resolveNewsSentimentEmptyState({ ...base, readiness: readiness(), unjudgedInWindow: 2 }))
      .toEqual({ kind: 'unjudged' })
    expect(resolveNewsSentimentEmptyState({ ...base, readiness: readiness(), unjudgedInWindow: 1, unjudgedCause: 'model-off' }))
      .toEqual({ kind: 'unjudged', cause: 'model-off' })
    expect(resolveNewsSentimentEmptyState({ ...base, readiness: readiness(), unjudgedInWindow: 1, unjudgedCause: 'model-unavailable' }))
      .toEqual({ kind: 'unjudged', cause: 'model-unavailable' })
  })

  it('beats "stale" but loses to a source that is switched off or broken', () => {
    // 窗口里**有东西**，只是没判：把读者引到「往前翻」没有用，翻也翻不到判定。
    expect(resolveNewsSentimentEmptyState({
      ...base, readiness: readiness(), unjudgedInWindow: 3, latestKnownItemAt: '2026-10-31T09:00:00.000Z'
    })).toEqual({ kind: 'unjudged' })
    // 源没开/全挂是更前面的原因：那种情况下「为什么空」不是没判。
    expect(resolveNewsSentimentEmptyState({ ...base, readiness: readiness({ enabledCount: 0 }), unjudgedInWindow: 3 }))
      .toEqual({ kind: 'sources-disabled' })
  })

  it('stays quiet when nothing is waiting for a judgment', () => {
    expect(resolveNewsSentimentEmptyState({ ...base, readiness: readiness(), unjudgedInWindow: 0 })).toEqual({ kind: 'quiet' })
  })
})
