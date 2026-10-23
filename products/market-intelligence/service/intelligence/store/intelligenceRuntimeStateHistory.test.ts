import { describe, expect, it } from 'vitest'

import type { RuntimeStateRecord } from '@platform/jobs'

import {
  appendRuntimeStateRevision,
  resolveRuntimeStatesAsOf,
  seedRuntimeStateRevisions
} from './intelligenceRuntimeStateHistory'

function revision(overrides: Partial<RuntimeStateRecord> = {}): RuntimeStateRecord {
  return {
    owner: 'product',
    productId: 'market-intelligence',
    resourceId: 'binance-announcements',
    status: 'idle',
    consecutiveFailures: 0,
    updatedAt: '2026-07-08T09:00:00.000Z',
    lastSuccessAt: '2026-07-08T09:00:00.000Z',
    ...overrides
  }
}

describe('intelligenceRuntimeStateHistory', () => {
  it('selects the latest revision with updatedAt <= asOf per source', () => {
    const revisions = [
      revision({ updatedAt: '2026-07-08T09:00:00.000Z', lastSuccessAt: '2026-07-08T09:00:00.000Z' }),
      revision({
        updatedAt: '2026-07-08T09:30:00.000Z',
        status: 'failed',
        consecutiveFailures: 1,
        lastFailureAt: '2026-07-08T09:30:00.000Z'
      }),
      revision({
        updatedAt: '2026-07-08T11:00:00.000Z',
        status: 'idle',
        consecutiveFailures: 0,
        lastSuccessAt: '2026-07-08T11:00:00.000Z',
        lastFailureAt: '2026-07-08T09:30:00.000Z'
      })
    ]

    const asOfTen = resolveRuntimeStatesAsOf(revisions, '2026-07-08T10:00:00.000Z')
    expect(asOfTen[0]?.lastFailureAt).toBe('2026-07-08T09:30:00.000Z')
    expect(asOfTen[0]?.lastSuccessAt).toBe('2026-07-08T09:00:00.000Z')

    const asOfNoon = resolveRuntimeStatesAsOf(revisions, '2026-07-08T12:00:00.000Z')
    expect(asOfNoon[0]?.lastSuccessAt).toBe('2026-07-08T11:00:00.000Z')
  })

  it('seeds history from snapshot when history is empty', () => {
    const seeded = seedRuntimeStateRevisions([], [revision()])
    expect(seeded).toHaveLength(1)
  })

  it('deduplicates identical consecutive revisions', () => {
    const first = revision()
    const next = appendRuntimeStateRevision([], first)
    const deduped = appendRuntimeStateRevision(next, { ...first })
    expect(deduped).toHaveLength(1)
  })
})
