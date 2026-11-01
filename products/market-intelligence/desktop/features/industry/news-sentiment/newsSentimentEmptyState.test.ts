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
