import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const platformFetch = vi.hoisted(() => vi.fn())
vi.mock('@platform/network/platformFetch', () => ({ getPlatformFetch: platformFetch }))

import { createRawRecordStore } from '../../application/rawRecordStore'
import { createMacroCalendarEvidenceArchive } from '../macroCalendarEvidenceArchive'
import type { MacroCalendarRevision } from '../macroCalendarContracts'
import { createMacroCalendarHttpClient } from '../macroCalendarHttpClient'
import { createMacroCalendarRepository } from '../macroCalendarRepository'
import { createMacroEconomicCalendarQueryService } from '../macroEconomicCalendarQueryService'
import { createFedFomcDecisionEvidence } from './fedFomcDecisionEvidence'
import { createFedFomcDecisionRefreshService } from './fedFomcDecisionRefreshService'

const detectedAt = '2026-08-13T08:00:00.000Z'
const currentUrl = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm'
const historyRows = readFileSync(join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/fed-statements/fixtures/fed-fomc-statement-history-2026.html'), 'utf8')

describe('Fed FOMC decision refresh', () => {
  it.each(['raise', 'lower'] as const)('projects a derived explicit %s final range through refresh, SQLite and public query', async verb => {
    const input = { history: history(), prior: priorBody(), current: currentBody().replaceAll(
      'maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent',
      `${verb} the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent`
    ) }
    const { refresh, repository } = harness(input)
    await expect(refresh.refresh({ detectedAt, runId: `derived-${verb}-range` })).resolves.toEqual({ state: 'updated' })
    const stored = repository.getEffectiveEventAsOf({ eventKey: schedule().eventKey, asOf: detectedAt })!
    const result = createMacroEconomicCalendarQueryService({ repository }).getEventDetail({ eventKey: schedule().eventKey, asOf: detectedAt })
    expect(stored.actual?.displayValue).toBe('3.75%–4.00%')
    expect(result).toMatchObject({ state: 'available', event: { actual: stored.actual, previous: stored.previous, scheduledAt: '2026-07-29T18:00:00.000Z' } })
    expect(result.state === 'available' && result.event.caveats).not.toContain('official-value-revised')
    repository.close()
  })
  it('reports the saved current value when the optional prior request throws', async () => {
    const input = { history: history(), prior: priorBody(), current: currentBody(), failHistory: true }
    const { refresh, repository } = harness(input)
    await expect(refresh.refresh({ detectedAt, runId: 'derived-prior-failure' })).resolves.toEqual({ state: 'updated' })
    const result = createMacroEconomicCalendarQueryService({ repository }).getEventDetail({ eventKey: schedule().eventKey, asOf: detectedAt })
    expect(result).toMatchObject({ state: 'available', event: { actual: { displayValue: '3.50%–3.75%' }, previous: undefined } })
    repository.close()
  })
  it.each(['actual', 'previous'] as const)('marks only a real existing %s value change, not enrichment or evidence-only revisions', async field => {
    const input = { history: '<html></html>', prior: priorBody(), current: currentBody() }
    const { refresh, repository } = harness(input)
    const query = createMacroEconomicCalendarQueryService({ repository })
    const read = (asOf: string) => {
      const result = query.getEventDetail({ eventKey: schedule().eventKey, asOf })
      expect(result.state).toBe('available')
      return result.state === 'available' ? result.event : undefined
    }
    await refresh.refresh({ detectedAt, runId: 'derived-current' })
    expect(read(detectedAt)?.caveats).not.toContain('official-value-revised')
    input.history = history()
    const enrichedAt = '2026-08-13T08:01:00.000Z'
    await refresh.refresh({ detectedAt: enrichedAt, runId: 'derived-enrichment' })
    expect(read(enrichedAt)?.previous?.displayValue).toBe('3.75%–4.00%')
    expect(read(enrichedAt)?.caveats).not.toContain('official-value-revised')
    input.current += '\n<!-- derived evidence only -->'
    const evidenceAt = '2026-08-13T08:02:00.000Z'
    await refresh.refresh({ detectedAt: evidenceAt, runId: 'derived-evidence' })
    expect(read(evidenceAt)?.caveats).not.toContain('official-value-revised')
    if (field === 'actual') input.current = currentBody().replaceAll('3-1/2 to 3-3/4 percent', '3-1/4 to 3-1/2 percent')
    else input.prior = priorBody().replaceAll('3-3/4 to 4 percent', '4 to 4-1/4 percent')
    const correctedAt = '2026-08-13T08:03:00.000Z'
    await refresh.refresh({ detectedAt: correctedAt, runId: 'derived-correction' })
    expect(read(correctedAt)?.caveats).toContain('official-value-revised')
    input.current += '\n<!-- derived later evidence -->'
    await refresh.refresh({ detectedAt: '2026-08-13T08:04:00.000Z', runId: 'derived-later-evidence' })
    expect(read('2026-08-13T08:04:00.000Z')?.caveats).toContain('official-value-revised')
    expect(read(enrichedAt)?.caveats).not.toContain('official-value-revised')
    repository.close()
  })
  it('appends evidence A-B-A with unchanged ranges when no prior decision is available', async () => {
    const input = { history: '<html></html>', prior: '', current: currentBody() }
    const { refresh, repository } = harness(input)
    const ids: string[] = []
    // Derived evidence-only changes: the target range and publication date stay unchanged.
    for (const [index, suffix] of ['', '\n<!-- derived evidence correction -->', ''].entries()) {
      input.current = currentBody() + suffix
      const at = `2026-08-13T09:0${index}:00.000Z`
      await expect(refresh.refresh({ detectedAt: at, runId: `derived-evidence-${index}` })).resolves.toEqual({ state: 'updated' })
      const stored = repository.getEffectiveEventAsOf({ eventKey: schedule().eventKey, asOf: at })!
      expect(stored.actual?.displayValue).toBe('3.50%–3.75%')
      ids.push(stored.revisionId)
    }
    expect(new Set(ids).size).toBe(3)
    await expect(refresh.refresh({ detectedAt: '2026-08-13T09:03:00.000Z', runId: 'derived-evidence-replay' })).resolves.toEqual({ state: 'unchanged' })
    repository.close()
  })
  it('appends A-B-A-B changes with distinct chain identities and keeps consecutive replay idempotent', async () => {
    const input = { history: history(), prior: priorBody(), current: currentBody() }
    const { refresh, repository } = harness(input)
    const values = ['3-1/2 to 3-3/4 percent', '3-1/4 to 3-1/2 percent', '3-1/2 to 3-3/4 percent', '3-1/4 to 3-1/2 percent']
    const ids: string[] = []
    for (const [index, value] of values.entries()) {
      input.current = currentBody().replaceAll('3-1/2 to 3-3/4 percent', value)
      const at = `2026-08-13T08:0${index}:00.000Z`
      await expect(refresh.refresh({ detectedAt: at, runId: `derived-chain-${index}` })).resolves.toEqual({ state: 'updated' })
      const stored = repository.getEffectiveEventAsOf({ eventKey: schedule().eventKey, asOf: at })!
      expect(stored.actual?.displayValue).toBe(index % 2 ? '3.25%–3.50%' : '3.50%–3.75%')
      expect(stored.previous?.displayValue).toBe('3.75%–4.00%')
      ids.push(stored.revisionId)
    }
    expect(new Set(ids).size).toBe(4)
    const count = repository.inspectStorage().rowCount
    await expect(refresh.refresh({ detectedAt: '2026-08-13T08:05:00.000Z', runId: 'derived-chain-replay' })).resolves.toEqual({ state: 'unchanged' })
    expect(repository.inspectStorage().rowCount).toBe(count)
    repository.close()
  })
  it('projects a verified current target range when no prior official statement is available', async () => {
    const recorded: Array<{ meetingDate: string; targetRange: { lowerPercent: number; upperPercent: number }; statementUrl: string }> = []
    const rawRecords = createRawRecordStore()
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    repository.appendIfNew(schedule())
    const refresh = createFedFomcDecisionRefreshService({
      http: {
        request: vi.fn(async (descriptorId: string) => descriptorId === 'macro-calendar-fed-statement'
          ? response('macro-calendar-fed-statement', rss())
          : unavailable('macro-calendar-fed-statement-history')),
        requestFomcStatement: vi.fn(async (url: string) => url === currentUrl
          ? response('macro-calendar-fed-statement-body', currentBody())
          : unavailable('macro-calendar-fed-statement-body'))
      },
      evidence: createFedFomcDecisionEvidence({
        archive: createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: mkdtempSync(join(tmpdir(), 'mi-fed-evidence-')) })
      }),
      repository,
      facts: { recordDecision: (facts) => recorded.push(facts) }
    })

    await expect(refresh.refresh({ detectedAt, runId: 'fed-release-run' })).resolves.toEqual({ state: 'updated' })
    expect(recorded[0]).toMatchObject({ meetingDate: '2026-07-29', targetRange: { lowerPercent: 3.5, upperPercent: 3.75 }, statementUrl: currentUrl })

    const result = createMacroEconomicCalendarQueryService({ repository }).getEventDetail({
      eventKey: 'US.FOMC.2026-07-29', asOf: detectedAt
    })
    expect(result).toEqual(expect.objectContaining({
      state: 'available',
      event: expect.objectContaining({
        lifecycleState: 'released',
        publishedAt: '2026-07-29T18:00:00.000Z',
        actual: { displayValue: '3.50%–3.75%', numericLowerBound: 3.5, numericUpperBound: 3.75, unit: 'percent' },
        previous: undefined
      })
    }))
    expect(JSON.stringify(result)).not.toMatch(/sourceUrl|rawRecordId|evidenceHash|https?:|html|parser/i)

    await expect(refresh.refresh({ detectedAt: '2026-08-13T08:01:00.000Z', runId: 'fed-release-replay' })).resolves.toEqual({ state: 'unchanged' })
    expect(repository.inspectStorage().rowCount).toBe(2)
    repository.close()
  })

  it('writes current actual through the bounded BOM statement transport when Content-Length is absent', async () => {
    const rawRecords = createRawRecordStore()
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    repository.appendIfNew(schedule())
    const body = currentBody()
    const bytes = new TextEncoder().encode(body)
    const request = vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 3))
        controller.enqueue(bytes.slice(3))
        controller.close()
      }
    }), { status: 200, headers: { 'content-type': 'text/html' } }))
    platformFetch.mockReturnValue(request)
    const httpClient = createMacroCalendarHttpClient()
    const refresh = createFedFomcDecisionRefreshService({
      http: {
        request: vi.fn(async (descriptorId: string) => descriptorId === 'macro-calendar-fed-statement'
          ? response('macro-calendar-fed-statement', rss())
          : unavailable('macro-calendar-fed-statement-history')),
        requestFomcStatement: (url: string) => httpClient.requestFomcStatement(url)
      },
      evidence: createFedFomcDecisionEvidence({
        archive: createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: mkdtempSync(join(tmpdir(), 'mi-fed-evidence-')) })
      }),
      repository
    })

    await expect(refresh.refresh({ detectedAt, runId: 'bom-stream-run' })).resolves.toEqual({ state: 'updated' })
    expect(repository.getEffectiveEventAsOf({ eventKey: 'US.FOMC.2026-07-29', asOf: detectedAt })?.actual).toEqual({
      displayValue: '3.50%–3.75%', numericLowerBound: 3.5, numericUpperBound: 3.75, unit: 'percent'
    })
    expect(request).toHaveBeenCalledTimes(1)
    repository.close()
  })

  it('refreshes only the requested current FOMC schedule and forwards its abort signal', async () => {
    const rawRecords = createRawRecordStore()
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    repository.appendIfNew(schedule())
    const controller = new AbortController()
    const request = vi.fn(async (_descriptorId: string, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal)
      return response('macro-calendar-fed-statement', rss())
    })
    const requestFomcStatement = vi.fn(async (_url: string, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal)
      return response('macro-calendar-fed-statement-body', currentBody())
    })
    const refresh = createFedFomcDecisionRefreshService({
      http: { request, requestFomcStatement },
      evidence: createFedFomcDecisionEvidence({
        archive: createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: mkdtempSync(join(tmpdir(), 'mi-fed-evidence-')) })
      }),
      repository
    })

    await expect(refresh.refresh({
      detectedAt, runId: 'manual-fomc-run', expectedEventKey: 'US.FOMC.2026-07-29'
    }, controller.signal)).resolves.toEqual({ state: 'updated' })
    expect(repository.getEffectiveEventAsOf({ eventKey: 'US.FOMC.2026-07-29', asOf: detectedAt })?.actual).toBeDefined()
    repository.close()
  })

  it('writes no FOMC evidence or revision when the signal aborts after the current body resolves', async () => {
    const rawRecords = createRawRecordStore()
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    repository.appendIfNew(schedule())
    const controller = new AbortController()
    const refresh = createFedFomcDecisionRefreshService({
      http: {
        request: vi.fn(async () => response('macro-calendar-fed-statement', rss())),
        requestFomcStatement: vi.fn(async () => {
          controller.abort()
          return response('macro-calendar-fed-statement-body', currentBody())
        })
      },
      evidence: createFedFomcDecisionEvidence({
        archive: createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: mkdtempSync(join(tmpdir(), 'mi-fed-evidence-')) })
      }),
      repository
    })

    await expect(refresh.refresh({ detectedAt, runId: 'aborted-after-body-run' }, controller.signal)).resolves.toEqual({ state: 'unavailable' })
    expect(repository.inspectStorage().rowCount).toBe(1)
    expect(repository.getEffectiveEventAsOf({ eventKey: 'US.FOMC.2026-07-29', asOf: detectedAt })?.actual).toBeUndefined()
    expect(rawRecords.listSafeSummaries()).toEqual([])
    repository.close()
  })

  it('adds a validated adjacent prior as an official revision without replacing current actual', async () => {
    const { refresh, repository } = harness({ history: history(), prior: priorBody() })

    await expect(refresh.refresh({ detectedAt, runId: 'first-run' })).resolves.toEqual({ state: 'updated' })
    const first = repository.getEffectiveEventAsOf({ eventKey: 'US.FOMC.2026-07-29', asOf: detectedAt })!
    expect(first).toMatchObject({
      revisionKind: 'official-revision', lifecycleState: 'released',
      actual: { numericLowerBound: 3.5, numericUpperBound: 3.75 },
      previous: { numericLowerBound: 3.75, numericUpperBound: 4, displayValue: '3.75%–4.00%', unit: 'percent' }
    })

    await expect(refresh.refresh({ detectedAt: '2026-08-13T08:01:00.000Z', runId: 'replay-run' })).resolves.toEqual({ state: 'unchanged' })
    expect(repository.inspectStorage().rowCount).toBe(4)
    repository.close()
  })

  it.each([
    ['a duplicate history statement link', historyRows.replace('monetary20260617a.htm', 'monetary20260729a.htm')],
    ['a non-statement history item', historyRows.replace('<strong>Statement:</strong>', '<strong>Minutes:</strong>')]
  ])('keeps current actual and makes no prior write for %s', async (_label, malformedHistory) => {
    const { refresh, repository } = harness({ history: malformedHistory, prior: priorBody() })

    await expect(refresh.refresh({ detectedAt, runId: 'invalid-prior-run' })).resolves.toEqual({ state: 'updated' })
    expect(repository.getEffectiveEventAsOf({ eventKey: 'US.FOMC.2026-07-29', asOf: detectedAt })).toMatchObject({
      revisionKind: 'official-release', actual: expect.any(Object), previous: undefined
    })
    repository.close()
  })

  it('writes neither FOMC body evidence nor an event revision when current validation fails', async () => {
    const rawRecords = createRawRecordStore()
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    repository.appendIfNew(schedule())
    const refresh = createFedFomcDecisionRefreshService({
      http: {
        request: vi.fn(async () => response('macro-calendar-fed-statement', rss())),
        requestFomcStatement: vi.fn(async () => response('macro-calendar-fed-statement-body', currentBody().replaceAll('Federal Reserve issues FOMC statement', 'Federal Reserve issues FOMC minutes')))
      },
      evidence: createFedFomcDecisionEvidence({ archive: createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: mkdtempSync(join(tmpdir(), 'mi-fed-evidence-')) }) }),
      repository
    })

    await expect(refresh.refresh({ detectedAt, runId: 'invalid-current-run' })).resolves.toEqual({ state: 'unavailable' })
    expect(repository.inspectStorage().rowCount).toBe(1)
    expect(repository.getEffectiveEventAsOf({ eventKey: 'US.FOMC.2026-07-29', asOf: detectedAt })?.actual).toBeUndefined()
    expect(rawRecords.listSafeSummaries()).toEqual([])
    repository.close()
  })

  it('retains the last official value when a later refresh is unavailable', async () => {
    const rawRecords = createRawRecordStore()
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    repository.appendIfNew(schedule())
    let available = true
    const refresh = createFedFomcDecisionRefreshService({
      http: {
        request: vi.fn(async (descriptorId: string) => available
          ? descriptorId === 'macro-calendar-fed-statement'
            ? response(descriptorId, rss())
            : unavailable(descriptorId)
          : unavailable(descriptorId)),
        requestFomcStatement: vi.fn(async () => available
          ? response('macro-calendar-fed-statement-body', currentBody())
          : unavailable('macro-calendar-fed-statement-body'))
      },
      evidence: createFedFomcDecisionEvidence({ archive: createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: mkdtempSync(join(tmpdir(), 'mi-fed-evidence-')) }) }),
      repository
    })

    await expect(refresh.refresh({ detectedAt, runId: 'retention-success' })).resolves.toEqual({ state: 'updated' })
    available = false
    await expect(refresh.refresh({ detectedAt: '2026-08-13T09:00:00.000Z', runId: 'retention-failure' })).resolves.toEqual({ state: 'unavailable' })
    expect(repository.getEffectiveEventAsOf({ eventKey: 'US.FOMC.2026-07-29', asOf: '2026-08-13T09:00:00.000Z' })?.actual?.displayValue).toBe('3.50%–3.75%')
    repository.close()
  })
})

function harness(input: { history: string; prior: string; current?: string; failHistory?: boolean }) {
  const rawRecords = createRawRecordStore()
  const repository = createMacroCalendarRepository({ filePath: ':memory:' })
  repository.appendManyIfNew([schedule(), priorSchedule()])
  const refresh = createFedFomcDecisionRefreshService({
    http: {
      request: vi.fn(async (descriptorId: string) => {
        if (descriptorId === 'macro-calendar-fed-statement') return response(descriptorId, rss())
        if (descriptorId === 'macro-calendar-fed-statement-history') {
          if (input.failHistory) throw new Error('derived-prior-failure')
          return response(descriptorId, input.history)
        }
        return unavailable(descriptorId)
      }),
      requestFomcStatement: vi.fn(async (url: string) => url === currentUrl
        ? response('macro-calendar-fed-statement-body', input.current ?? currentBody())
        : response('macro-calendar-fed-statement-body', input.prior))
    },
    evidence: createFedFomcDecisionEvidence({ archive: createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: mkdtempSync(join(tmpdir(), 'mi-fed-evidence-')) }) }),
    repository
  })
  return { refresh, repository }
}

function schedule(): MacroCalendarRevision {
  return {
    revisionId: 'fomc-schedule', eventKey: 'US.FOMC.2026-07-29', releaseGroupKey: 'US.FOMC.2026-07-29',
    eventFamily: 'fomc', eventNameKey: 'fomc', countryCode: 'US', importance: 'high', periodKey: '2026-07-29',
    lifecycleState: 'scheduled', revisionKind: 'schedule', scheduledDate: '2026-07-29',
    detectedAt: '2026-08-03T13:53:07.000Z', recordedAt: '2026-08-03T13:53:07.000Z',
    providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule',
    sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', rawRecordId: 'schedule-raw',
    evidenceHash: 'schedule-evidence', evidenceRefs: [], snapshotHash: 'pending', parserVersion: 'fed-fomc-schedule-v2',
    caveats: ['official-time-not-published']
  }
}

function priorSchedule(): MacroCalendarRevision {
  return {
    ...schedule(), revisionId: 'fomc-prior-schedule', eventKey: 'US.FOMC.2026-06-17', releaseGroupKey: 'US.FOMC.2026-06-17',
    periodKey: '2026-06-17', scheduledDate: '2026-06-17'
  }
}

function response(descriptorId: string, body: string) {
  return { ok: true as const, descriptorId, status: 200, acceptedBytes: Buffer.byteLength(body, 'utf8'), body, contentType: 'text/html' }
}

function unavailable(descriptorId: string) {
  return { ok: false as const, descriptorId, failureCode: 'network-request-failed' as const }
}

function rss(): string {
  return readFileSync(join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/fixtures/fed-press-feed-2026-08-03.xml'), 'utf8')
}

function currentBody(): string {
  return readFileSync(join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/fed-statements/fixtures/fed-fomc-decision-2026-07-29.html'), 'utf8')
}

function priorBody(): string {
  return currentBody()
    .replaceAll('20260729', '20260617')
    .replaceAll('July 29, 2026', 'June 17, 2026')
    .replaceAll('3-1/2 to 3-3/4 percent', '3-3/4 to 4 percent')
}

function history(): string {
  return historyRows
}
