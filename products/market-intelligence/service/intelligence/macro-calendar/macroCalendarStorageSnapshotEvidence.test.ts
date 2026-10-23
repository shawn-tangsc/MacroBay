import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRawRecordStore } from '../application/rawRecordStore'
import { createMacroCalendarEvidenceArchive } from './macroCalendarEvidenceArchive'
import { createMacroCalendarRepository } from './macroCalendarRepository'
import { createMacroCalendarSqlite } from './macroCalendarSqlite'
import type { MacroCalendarRevision } from './macroCalendarContracts'
import { createBeaOfficialReleaseEvidence } from './bea-official-release/beaOfficialReleaseEvidence'
import { createBeaOfficialReleaseRevisions } from './bea-official-release/beaOfficialReleaseRevisionFactory'
import { createFedFomcDecisionEvidence } from './fed-statements/fedFomcDecisionEvidence'
import { createFedFomcDecisionRefreshService } from './fed-statements/fedFomcDecisionRefreshService'
import { collectSnapshotEvidence } from './macroCalendarStorageSnapshotEvidence'
import { createBlsEmploymentMvpRefreshService } from './bls-employment-refresh/blsEmploymentMvpRefreshService'
import { createBlsEmploymentMvpEvidence } from './bls-employment-refresh/blsEmploymentMvpEvidence'

const cleanup: Array<() => void> = []
const at = '2026-08-26T12:45:00.000Z'
afterEach(() => cleanup.splice(0).reverse().forEach(dispose => dispose()))
const hash = (body: string) => createHash('sha256').update(body).digest('hex')

// Derived contract data only; the real archive and official factories own the shapes.
function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'mc4d-evidence-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const storage = createMacroCalendarSqlite(join(dir, 'calendar.sqlite'))
  cleanup.push(() => storage.close())
  const repository = createMacroCalendarRepository({ storage })
  const archive = createMacroCalendarEvidenceArchive({ rawRecords: createRawRecordStore(), archiveDirectory: join(dir, 'archive') })
  const collect = () => collectSnapshotEvidence(storage.database, archive, async () => {})
  return { dir, storage, repository, archive, collect }
}
function schedule(): MacroCalendarRevision {
  return { revisionId: 'schedule', eventKey: 'US.FOMC.2026-07-29', releaseGroupKey: 'US.FOMC.2026-07-29',
    eventFamily: 'fomc', eventNameKey: 'fomc', countryCode: 'US', importance: 'high', periodKey: '2026-07-29',
    lifecycleState: 'scheduled', revisionKind: 'schedule', scheduledDate: '2026-07-29', detectedAt: at, recordedAt: at,
    providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule',
    sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    evidenceHash: hash('schedule'), evidenceRefs: [], snapshotHash: 'pending', parserVersion: 'derived', caveats: [] }
}
function bea(h: ReturnType<typeof harness>) {
  const url = 'https://www.bea.gov/news/2026/personal-income-and-outlays-july-2026'
  const evidence = createBeaOfficialReleaseEvidence({ archive: h.archive }).append({ rssBody: 'derived rss', pageBody: 'derived page', pageUrl: url, detectedAt: at, runId: 'derived' })!
  return createBeaOfficialReleaseRevisions({
    group: { kind: 'pce-core', releaseGroupKey: 'US.BEA.PCE.2026-07', eventKeys: ['US.PCE.2026-07', 'US.CORE_PCE.2026-07'], periodKey: '2026-07', scheduledDate: '2026-08-26', scheduledAt: '2026-08-26T12:30:00.000Z' },
    rss: { officialPageUrl: url, publishedAt: '2026-08-26T12:30:00.000Z' } as Parameters<typeof createBeaOfficialReleaseRevisions>[0]['rss'],
    facts: { pcePercent: 3.7, corePcePercent: 3.3 }, evidence, detectedAt: at
  })![0]!
}
async function fed(h: ReturnType<typeof harness>, prior: boolean, replay = false) {
  const fixture = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const body = fixture('./fed-statements/fixtures/fed-fomc-decision-2026-07-29.html')
  const currentUrl = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm'
  const response = (descriptorId: string, text: string) => ({ ok: true as const, descriptorId, status: 200, acceptedBytes: Buffer.byteLength(text), body: text, contentType: 'text/html' })
  let current = schedule()
  let hasPrior = prior
  const written: MacroCalendarRevision[] = []
  const service = createFedFomcDecisionRefreshService({
    repository: { getEffectiveEventAsOf: ({ eventKey }) => eventKey === current.eventKey ? current : { ...schedule(), eventKey, releaseGroupKey: eventKey, scheduledDate: '2026-06-17' },
      appendIfNew: revision => { written.push(revision); current = revision; return { inserted: true, revision } } },
    evidence: createFedFomcDecisionEvidence({ archive: h.archive }),
    http: { request: async descriptorId => descriptorId === 'macro-calendar-fed-statement'
      ? response(descriptorId, fixture('./fixtures/fed-press-feed-2026-08-03.xml'))
      : hasPrior ? response(descriptorId, fixture('./fed-statements/fixtures/fed-fomc-statement-history-2026.html')) : { ok: false, descriptorId, failureCode: 'derived-unavailable' },
    requestFomcStatement: async url => response('macro-calendar-fed-statement-body', url === currentUrl ? body : body.replaceAll('20260729', '20260617').replaceAll('July 29, 2026', 'June 17, 2026').replaceAll('3-1/2 to 3-3/4 percent', '3-3/4 to 4 percent')) }
  })
  expect((await service.refresh({ detectedAt: at, runId: 'derived' })).state).toBe('updated')
  if (replay) { hasPrior = false; await service.refresh({ detectedAt: at, runId: 'derived-replay' }) }
  return written.at(-1)!
}

describe('calendar snapshot evidence', () => {
  it('validates actual BLS family refresh output using its dedicated archive source', async () => {
    const h = harness()
    const events = ['CPI', 'CORE_CPI'].map((key, index): MacroCalendarRevision => ({ ...schedule(),
      eventKey: `US.${key}.RELEASE.2026-M07`, releaseGroupKey: 'US.CPI.RELEASE.2026-M07',
      eventFamily: index ? 'core-cpi' : 'cpi', eventNameKey: index ? 'core-cpi' : 'cpi', periodKey: '2026-M07',
      scheduledDate: '2026-08-07', providerId: 'macro-calendar-bls', descriptorId: 'macro-calendar-bls-python-schedule' }))
    const body = JSON.stringify({ status: 'REQUEST_SUCCEEDED', Results: { series: ['CUUR0000SA0', 'CUUR0000SA0L1E'].map(seriesID => ({ seriesID,
      data: [{ year: '2025', period: 'M06', value: '100' }, { year: '2025', period: 'M07', value: '101' }, { year: '2026', period: 'M06', value: '103' }, { year: '2026', period: 'M07', value: '105' }] })) } })
    const service = createBlsEmploymentMvpRefreshService({ now: () => at,
      valuesBridge: { run: async () => ({ state: 'response', status: 200, body }) },
      repository: { getEffectiveEventAsOf: ({ eventKey }) => events.find(event => event.eventKey === eventKey), appendManyIfNew: h.repository.appendManyIfNew },
      evidence: createBlsEmploymentMvpEvidence({ archive: h.archive }) })
    expect(await service.refresh({ eventKey: events[0]!.eventKey, confirmed: true })).toEqual({ state: 'updated' })
    expect((await h.collect()).records).toHaveLength(1)
  })
  it('keyset scans more than one page and rejects a conflict in the last page', async () => {
    const h = harness(); const revision = bea(h)
    for (let index = 0; index < 205; index++) h.repository.appendIfNew({ ...revision, revisionId: `row-${index.toString().padStart(3, '0')}`, eventKey: `event-${index}` })
    expect(await h.collect()).toMatchObject({ referenceCount: 410, bodyCount: 2 })
    h.storage.database.prepare('update mi_macro_calendar_revisions set evidence_hash=? where revision_id=?').run(hash('wrong'), 'row-204')
    await expect(h.collect()).rejects.toMatchObject({ code: 'evidence-invalid' })
  })
  it.each(['top-hash', 'top-id', 'duplicate', 'role', 'component-hash'] as const)('rejects BEA factory damage %s', async kind => {
    const h = harness(); const revision = bea(h)
    if (kind === 'top-hash') revision.evidenceHash = hash('wrong')
    if (kind === 'top-id') revision.rawRecordId = revision.evidenceRefs[1]!.rawRecordId
    if (kind === 'duplicate') revision.evidenceRefs.push(revision.evidenceRefs[0]!)
    if (kind === 'role') revision.evidenceRefs[0]!.fieldKinds = ['previous']
    if (kind === 'component-hash') revision.evidenceRefs[1]!.evidenceHash = hash('wrong')
    h.repository.appendIfNew(revision)
    await expect(h.collect()).rejects.toMatchObject({ code: 'evidence-invalid' })
  })
  it('rejects a conflicting same-ID inherited Fed body while accepting exact duplicates', async () => {
    const h = harness(); const revision = await fed(h, true, true)
    revision.evidenceRefs[0]!.evidenceHash = hash('different')
    h.repository.appendIfNew(revision)
    await expect(h.collect()).rejects.toMatchObject({ code: 'evidence-invalid' })
  })
  it('accepts empty official schema without creating market tables', async () => {
    const h = harness()
    expect(await h.collect()).toMatchObject({ referenceCount: 0, records: [], bodyCount: 0 })
  })
  it('verifies BEA factory composite and deduplicates its component records', async () => {
    const h = harness(); const revision = bea(h)
    h.repository.appendIfNew(revision)
    h.repository.appendIfNew({ ...revision, eventKey: 'second', revisionId: 'second' })
    expect(await h.collect()).toMatchObject({ referenceCount: 4, bodyCount: 2, records: expect.any(Array) })
    expect((await h.collect()).records).toHaveLength(2)
  })
  it.each([[false, false], [true, false], [true, true]])('verifies Fed refresh output prior=%s replay=%s', async (prior, replay) => {
    const h = harness(); const revision = await fed(h, prior, replay)
    if (replay) expect(revision.evidenceRefs.filter(ref => ref.fieldKinds[0] === 'actual')).toHaveLength(1)
    h.repository.appendIfNew(revision)
    expect((await h.collect()).records).toHaveLength(prior ? 2 : 1)
  })
  it.each(['top-hash', 'component-hash', 'top-id', 'duplicate', 'url', 'role'] as const)('rejects damaged composite %s', async kind => {
    const h = harness(); const revision = await fed(h, true)
    if (kind === 'top-hash') revision.evidenceHash = hash('wrong')
    if (kind === 'component-hash') revision.evidenceRefs[1]!.evidenceHash = hash('wrong')
    if (kind === 'top-id') revision.rawRecordId = revision.evidenceRefs[1]!.rawRecordId
    if (kind === 'duplicate') revision.evidenceRefs.push(revision.evidenceRefs[1]!)
    if (kind === 'url') revision.sourceUrl += '?wrong'
    if (kind === 'role') revision.evidenceRefs[1]!.fieldKinds = ['actual']
    h.repository.appendIfNew(revision)
    await expect(h.collect()).rejects.toMatchObject({ code: 'evidence-invalid' })
  })
  it('reports unresolved official IDs instead of locating records by hash', async () => {
    const h = harness(); h.repository.appendIfNew(schedule())
    await expect(h.collect()).rejects.toMatchObject({ code: 'evidence-unresolved' })
  })
  it.each(['missing-size', 'wrong-size', 'missing-body', 'wrong-source', 'wrong-owner', 'wrong-metadata'] as const)('strictly rejects %s', async kind => {
    const h = harness(); const revision = bea(h); h.repository.appendIfNew(revision)
    const record = h.archive.getRecord(revision.rawRecordId!)!
    const damaged = { ...record }
    if (kind === 'missing-size') delete damaged.payloadSizeBytes
    if (kind === 'wrong-size') damaged.payloadSizeBytes = 999
    if (kind === 'wrong-source') damaged.sourceId = 'unrelated'
    if (kind === 'wrong-owner') damaged.processingOwner = 'generic-intelligence'
    if (kind === 'wrong-metadata') damaged.payloadMetaJson = '{}'
    const archive = { getRecord: (id: string) => id === record.rawRecordId ? damaged : h.archive.getRecord(id),
      readBody: kind === 'missing-body' ? () => undefined : h.archive.readBody }
    await expect(collectSnapshotEvidence(h.storage.database, archive, async () => {})).rejects.toMatchObject({ code: 'evidence-invalid' })
  })
  it('rejects a partial market schema', async () => {
    const h = harness(); h.storage.database.exec('create table mi_macro_calendar_market_event_collections (collection_id text)')
    await expect(h.collect()).rejects.toMatchObject({ code: 'schema-invalid' })
  })
  it.each(['missing-record', 'oversized-metadata', 'fractional-size', 'malformed-refs', 'future-schema'] as const)('rejects %s without leaking input', async kind => {
    const h = harness(); const revision = bea(h); h.repository.appendIfNew(revision)
    if (kind === 'malformed-refs') h.storage.database.exec("update mi_macro_calendar_revisions set evidence_refs_json='not-json'")
    if (kind === 'future-schema') h.storage.database.exec('update mi_macro_calendar_revisions set schema_version=999')
    const archive = { ...h.archive, getRecord: (id: string) => {
      const record = h.archive.getRecord(id)
      if (kind === 'missing-record') return undefined
      if (record && kind === 'oversized-metadata') return { ...record, errorMessage: 'derived'.repeat(5000) }
      if (record && kind === 'fractional-size') return { ...record, payloadSizeBytes: 1.5 }
      return record
    } }
    await expect(collectSnapshotEvidence(h.storage.database, archive, async () => {})).rejects.toMatchObject({
      code: kind === 'future-schema' ? 'schema-invalid' : kind === 'oversized-metadata' ? 'capacity' : 'evidence-invalid'
    })
  })
})
