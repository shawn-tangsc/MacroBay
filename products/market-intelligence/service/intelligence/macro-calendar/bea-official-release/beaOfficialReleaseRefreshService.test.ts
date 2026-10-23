import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import { createBeaOfficialReleaseRefreshService } from './beaOfficialReleaseRefreshService'
import type { MacroCalendarRevision } from '../macroCalendarContracts'

const detectedAt = '2026-08-26T12:45:00.000Z'
function schedule(patch: Partial<MacroCalendarRevision> = {}): MacroCalendarRevision { return { revisionId: 'pce', eventKey: 'US.PCE.2026-07', releaseGroupKey: 'US.BEA.PCE.2026-07', eventFamily: 'pce', eventNameKey: 'pce', countryCode: 'US', importance: 'high', periodKey: '2026-07', lifecycleState: 'scheduled', revisionKind: 'schedule', scheduledDate: '2026-08-26', scheduledAt: '2026-08-26T12:30:00.000Z', detectedAt: '2026-08-01T00:00:00.000Z', recordedAt: '2026-08-01T00:00:00.000Z', providerId: 'macro-calendar-bea', descriptorId: 'macro-calendar-bea-schedule', sourceUrl: 'https://www.bea.gov/news/schedule', evidenceHash: 'schedule', evidenceRefs: [], snapshotHash: 'schedule', parserVersion: 'schedule', caveats: [], ...patch } }
const core = () => schedule({ revisionId: 'core', eventKey: 'US.CORE_PCE.2026-07', eventFamily: 'core-pce', eventNameKey: 'core-pce' })
const gdp = () => schedule({ revisionId: 'gdp', eventKey: 'US.GDP.2026-Q2.SECOND', releaseGroupKey: 'US.BEA.GDP.2026-Q2.SECOND', eventFamily: 'gdp', eventNameKey: 'gdp', periodKey: '2026-Q2' })
const pioPage = readFileSync(new URL('./fixtures/bea-pio-july-2026.html', import.meta.url), 'utf8')
const gdpPage = readFileSync(new URL('./fixtures/bea-gdp-second-q2-2026.html', import.meta.url), 'utf8')
const rss = readFileSync(new URL('./fixtures/bea-rss-2026-08-26.xml', import.meta.url), 'utf8')

describe('BEA official-release refresh service', () => {
  it('writes an exact PCE/Core official pair only after RSS identity, page parsing, and both evidence bodies succeed', async () => {
    const appendManyIfNew = vi.fn(() => ({ insertedCount: 2, dedupedCount: 0 }))
    const requestPage = vi.fn(async () => ({ ok: true as const, descriptorId: 'macro-calendar-bea-release-page', status: 200, acceptedBytes: Buffer.byteLength(pioPage), body: pioPage, contentType: 'text/html' }))
    const recordAttemptIfDue = vi.fn(() => true)
    const service = createBeaOfficialReleaseRefreshService({
      repository: { listEffectiveMonthAsOf: () => [schedule(), core()], appendManyIfNew, recordBeaObservationAttemptIfDue: recordAttemptIfDue, clearBeaObservation: vi.fn(), clearExpiredBeaObservations: vi.fn() },
      http: { requestRss: async () => ({ ok: true as const, descriptorId: 'macro-calendar-bea-release-rss', status: 200, acceptedBytes: Buffer.byteLength(rss), body: rss, contentType: 'application/rss+xml' }), requestPage },
      evidence: { append: () => ({ rss: { rawRecordId: 'raw-rss', evidenceHash: 'rss' }, page: { rawRecordId: 'raw-page', evidenceHash: 'page' } }) }
    })

    await expect(service.refresh({ detectedAt, runId: 'bea-run' })).resolves.toEqual({ state: 'updated' })
    expect(requestPage).toHaveBeenCalledWith('https://www.bea.gov/news/2026/personal-income-and-outlays-july-2026', undefined)
    expect(recordAttemptIfDue).toHaveBeenCalledOnce()
    expect(appendManyIfNew).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ eventKey: 'US.PCE.2026-07', actual: expect.objectContaining({ numericValue: 3.7 }) }), expect.objectContaining({ eventKey: 'US.CORE_PCE.2026-07', actual: expect.objectContaining({ numericValue: 3.3 }) })]))
  })

  it('writes the cleaned official PIO and GDP Second facts after their matching RSS identities and pages', async () => {
    const appendManyIfNew = vi.fn((revisions: MacroCalendarRevision[]) => ({ insertedCount: revisions.length, dedupedCount: 0 }))
    const requestPage = vi.fn(async (url: string) => {
      const body = url.endsWith('gdp-second-estimate-and-corporate-profits-2nd-quarter-2026') ? gdpPage : pioPage
      return { ok: true as const, descriptorId: 'macro-calendar-bea-release-page', status: 200, acceptedBytes: Buffer.byteLength(body), body, contentType: 'text/html; charset=UTF-8' }
    })
    const service = createBeaOfficialReleaseRefreshService({
      repository: { listEffectiveMonthAsOf: () => [schedule(), core(), gdp()], appendManyIfNew, recordBeaObservationAttemptIfDue: () => true, clearBeaObservation: vi.fn(), clearExpiredBeaObservations: vi.fn() },
      http: { requestRss: async () => ({ ok: true as const, descriptorId: 'macro-calendar-bea-release-rss', status: 200, acceptedBytes: Buffer.byteLength(rss), body: rss, contentType: 'application/rss+xml' }), requestPage },
      evidence: { append: () => ({ rss: { rawRecordId: 'raw-rss', evidenceHash: 'rss' }, page: { rawRecordId: 'raw-page', evidenceHash: 'page' } }) }
    })

    await expect(service.refresh({ detectedAt, runId: 'bea-run' })).resolves.toEqual({ state: 'updated' })
    expect(requestPage).toHaveBeenCalledTimes(2)
    const written = appendManyIfNew.mock.calls.flatMap(([items]) => items)
    expect(written).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventKey: 'US.PCE.2026-07', actual: expect.objectContaining({ numericValue: 3.7 }) }),
      expect.objectContaining({ eventKey: 'US.CORE_PCE.2026-07', actual: expect.objectContaining({ numericValue: 3.3 }) }),
      expect.objectContaining({ eventKey: 'US.GDP.2026-Q2.SECOND', actual: expect.objectContaining({ numericValue: 1.5 }) })
    ]))
  })

  it('does not fetch a page or write when RSS identity fails', async () => {
    const requestPage = vi.fn(); const appendManyIfNew = vi.fn()
    const service = createBeaOfficialReleaseRefreshService({ repository: { listEffectiveMonthAsOf: () => [schedule(), core()], appendManyIfNew, recordBeaObservationAttemptIfDue: () => true, clearBeaObservation: vi.fn(), clearExpiredBeaObservations: vi.fn() }, http: { requestRss: async () => ({ ok: true as const, descriptorId: 'macro-calendar-bea-release-rss', status: 200, acceptedBytes: 1, body: '<rss/>', contentType: 'application/rss+xml' }), requestPage }, evidence: { append: vi.fn() } })
    await expect(service.refresh({ detectedAt, runId: 'bea-run' })).resolves.toEqual({ state: 'unchanged' })
    expect(requestPage).not.toHaveBeenCalled(); expect(appendManyIfNew).not.toHaveBeenCalled()
  })

  it('re-reads the effective group immediately before writing and fails closed on a new official conflict', async () => {
    const appendManyIfNew = vi.fn(() => ({ insertedCount: 2, dedupedCount: 0 }))
    let reads = 0
    const conflicting = schedule({ revisionId: 'official', revisionKind: 'official-release', lifecycleState: 'released', actual: { numericValue: 9, unit: 'percent-yoy', display: '9%' }, publishedAt: '2026-08-26T12:30:00.000Z' })
    const service = createBeaOfficialReleaseRefreshService({
      repository: {
        listEffectiveMonthAsOf: () => { reads += 1; return reads === 1 ? [schedule(), core()] : [conflicting, core({ revisionKind: 'official-release', lifecycleState: 'released', actual: { numericValue: 9, unit: 'percent-yoy', display: '9%' }, publishedAt: '2026-08-26T12:30:00.000Z' })] },
        appendManyIfNew, recordBeaObservationAttemptIfDue: () => true, clearBeaObservation: vi.fn(), clearExpiredBeaObservations: vi.fn()
      },
      http: { requestRss: async () => ({ ok: true as const, descriptorId: 'macro-calendar-bea-release-rss', status: 200, acceptedBytes: Buffer.byteLength(rss), body: rss, contentType: 'application/rss+xml' }), requestPage: async () => ({ ok: true as const, descriptorId: 'macro-calendar-bea-release-page', status: 200, acceptedBytes: Buffer.byteLength(pioPage), body: pioPage, contentType: 'text/html' }) },
      evidence: { append: () => ({ rss: { rawRecordId: 'raw-rss', evidenceHash: 'rss' }, page: { rawRecordId: 'raw-page', evidenceHash: 'page' } }) }
    })
    await expect(service.refresh({ detectedAt, runId: 'bea-run' })).resolves.toEqual({ state: 'unavailable' })
    expect(reads).toBeGreaterThanOrEqual(2)
    expect(appendManyIfNew).not.toHaveBeenCalled()
  })
})
