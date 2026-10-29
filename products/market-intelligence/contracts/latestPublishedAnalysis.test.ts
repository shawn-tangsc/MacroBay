import { describe, expect, it } from 'vitest'

import { selectLatestPublishedEntry } from './latestPublishedAnalysis'

const entry = (id: string, kind: string, status: string) => ({ id, kind, status })

describe('latest published analysis', () => {
  it('returns the first published analysis or review', () => {
    expect(selectLatestPublishedEntry([
      entry('a', 'event', 'published'),
      entry('b', 'analysis', 'stale'),
      entry('c', 'review', 'published'),
      entry('d', 'analysis', 'published')
    ])?.id).toBe('c')
  })

  it('ignores system and prediction-update nodes', () => {
    expect(selectLatestPublishedEntry([
      entry('a', 'system', 'published'),
      entry('b', 'prediction-update', 'published')
    ])).toBeUndefined()
  })

  it('does not treat stale or superseded nodes as published', () => {
    expect(selectLatestPublishedEntry([
      entry('a', 'analysis', 'stale'),
      entry('b', 'review', 'superseded')
    ])).toBeUndefined()
  })
})
