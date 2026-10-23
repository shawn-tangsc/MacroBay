import { describe, expect, it } from 'vitest'

import { buildRssCanonicalDedupeKey, resolveRevision } from './revisionResolver'

describe('revisionResolver', () => {
  it('maps the same rss guid to one item identity', () => {
    const key = buildRssCanonicalDedupeKey({
      guid: 'guid-123',
      title: 'Headline',
      publishedAt: '2026-07-05T10:00:00.000Z'
    })

    expect(key).toBe('rss:guid:guid-123')
  })

  it('creates a revision when the same identity body changes', () => {
    const first = resolveRevision({
      candidate: {
        itemId: 'item-1',
        canonicalDedupeKey: 'rss:guid:guid-123',
        title: 'Headline',
        bodyHash: 'hash-a',
        detectedAt: '2026-07-05T10:00:00.000Z'
      },
      existingRevisions: []
    })

    const second = resolveRevision({
      candidate: {
        itemId: 'item-1',
        canonicalDedupeKey: 'rss:guid:guid-123',
        title: 'Headline updated',
        bodyHash: 'hash-b',
        detectedAt: '2026-07-05T10:05:00.000Z'
      },
      existingRevisions: first.revision ? [first.revision] : []
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.revision?.previousRevisionId).toBe(first.revision?.revisionId)
    expect(second.isDuplicate).toBe(false)
  })

  it('treats unchanged body as duplicate revision input', () => {
    const first = resolveRevision({
      candidate: {
        itemId: 'item-1',
        canonicalDedupeKey: 'rss:guid:guid-123',
        title: 'Headline',
        bodyHash: 'hash-a',
        detectedAt: '2026-07-05T10:00:00.000Z'
      },
      existingRevisions: []
    })

    const duplicate = resolveRevision({
      candidate: {
        itemId: 'item-1',
        canonicalDedupeKey: 'rss:guid:guid-123',
        title: 'Headline',
        bodyHash: 'hash-a',
        detectedAt: '2026-07-05T10:01:00.000Z'
      },
      existingRevisions: first.revision ? [first.revision] : []
    })

    expect(duplicate.isDuplicate).toBe(true)
    expect(duplicate.created).toBe(false)
  })
})
