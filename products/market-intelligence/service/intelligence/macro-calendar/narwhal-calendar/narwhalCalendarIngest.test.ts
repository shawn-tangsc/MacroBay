import { describe, expect, it } from 'vitest'

import { ingestNarwhalReleases } from './narwhalCalendarIngest'


describe('首发布快照不许由回填写', () => {
  it('captureFirstPublished: false → 一行快照都不写', () => {
    const snapshots: unknown[] = []
    const repository = {
      upsertReleaseRow: () => {},
      recordFirstPublished: (snapshot: unknown) => { snapshots.push(snapshot); return true }
    }
    const release = {
      releaseId: 'r-1', at: '2026-11-06T13:30:00.000Z', timezone: 'America/New_York', seriesId: 'usa-employment-report',
      name: 'Employment report', country: 'USA', status: 'published', dateBasis: 'exact' as const,
      eventDate: '2026-11-06', values: [{ measure: 'nonfarm_payrolls_change', previous: '60', actual: '165' }]
    }
    ingestNarwhalReleases({ releases: [release], detectedAt: '2026-11-13T09:45:00.000Z',
      recordedAt: '2026-11-13T09:45:00.000Z', captureFirstPublished: false }, repository)
    expect(snapshots).toHaveLength(0)
  })
})
