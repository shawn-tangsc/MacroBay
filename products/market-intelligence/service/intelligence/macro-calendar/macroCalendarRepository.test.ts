import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'
import { createMacroCalendarSqlite } from './macroCalendarSqlite'

import type { MacroCalendarRevision } from './macroCalendarContracts'
import { macroCalendarStoragePolicy } from './macroCalendarPolicy'
import { createMacroCalendarRepository, macroCalendarSnapshotHash } from './macroCalendarRepository'

describe('macroCalendarRepository', () => {
  it('closes its standalone owner only once', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const close = vi.spyOn(DatabaseSync.prototype, 'close')
    try {
      repository.close()
      expect(() => repository.close()).not.toThrow()
      expect(close).toHaveBeenCalledOnce()
    } finally { close.mockRestore() }
  })

  it('borrows the owner connection without closing or checkpointing it', () => {
    const storage = createMacroCalendarSqlite(':memory:')
    try {
      const repository = createMacroCalendarRepository({ storage })
      repository.appendIfNew(revision({}))
      storage.database.exec('create table derived_market (value text); begin; insert into derived_market values (\'same-connection\')')
      expect(repository.inspectStorage().rowCount).toBe(1)
      const exec = vi.spyOn(storage.database, 'exec')
      repository.close()
      expect(exec).not.toHaveBeenCalled()
      expect(storage.database.prepare('select value from derived_market').get()?.value).toBe('same-connection')
      storage.database.exec('rollback')
      exec.mockRestore()
    } finally { storage.close() }
  })

  it.each(['migration', 'prepare'] as const)('cleans owned but not borrowed connections after %s failure', failure => {
    const storage = createMacroCalendarSqlite(':memory:')
    const close = vi.spyOn(DatabaseSync.prototype, 'close')
    const prepare = failure === 'prepare' ? vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(() => { throw new Error('derived-prepare') }) : undefined
    const migrationExecutor = failure === 'migration' ? () => { throw new Error('derived-migration') } : undefined
    try {
      expect(() => createMacroCalendarRepository({ filePath: ':memory:', migrationExecutor })).toThrow(`derived-${failure}`)
      expect(close).toHaveBeenCalledOnce()
      expect(() => createMacroCalendarRepository({ storage, migrationExecutor })).toThrow(`derived-${failure}`)
      expect(close).toHaveBeenCalledOnce()
      prepare?.mockRestore()
      expect(storage.database.prepare('select 1 as n').get()?.n).toBe(1)
    } finally { prepare?.mockRestore(); close.mockRestore(); storage.close() }
  })

  it('persists BEA pending observation cadence and replaces stale schedule fingerprints', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const first = { releaseGroupKey: 'US.BEA.PCE.2026-07', scheduleFingerprint: 'fp-1', now: '2026-08-26T12:45:00.000Z', minimumIntervalMs: 900_000 }
    expect(repository.recordBeaObservationAttemptIfDue(first)).toBe(true)
    expect(repository.getBeaObservation(first.releaseGroupKey)).toEqual({ scheduleFingerprint: 'fp-1', lastAttemptAt: first.now })
    expect(repository.recordBeaObservationAttemptIfDue({ ...first, now: '2026-08-26T12:50:00.000Z' })).toBe(false)
    expect(repository.recordBeaObservationAttemptIfDue({ ...first, scheduleFingerprint: 'fp-2', now: '2026-08-26T12:50:00.000Z' })).toBe(true)
    expect(repository.getBeaObservation(first.releaseGroupKey)).toEqual({ scheduleFingerprint: 'fp-2', lastAttemptAt: '2026-08-26T12:50:00.000Z' })
    expect(repository.clearBeaObservation(first.releaseGroupKey)).toBe(true)
    expect(repository.getBeaObservation(first.releaseGroupKey)).toBeUndefined()
    repository.close()
  })

  it('fails closed for malformed BEA observation inputs without creating state', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    expect(repository.recordBeaObservationAttemptIfDue({ releaseGroupKey: '', scheduleFingerprint: 'fp', now: '2026-08-26T12:45:00.000Z', minimumIntervalMs: 1 })).toBe(false)
    expect(repository.recordBeaObservationAttemptIfDue({ releaseGroupKey: 'group', scheduleFingerprint: 'fp', now: '2026-08-26', minimumIntervalMs: 1 })).toBe(false)
    expect(repository.recordBeaObservationAttemptIfDue({ releaseGroupKey: 'group', scheduleFingerprint: 'fp', now: '2026-08-26T12:45:00.000Z', minimumIntervalMs: -1 })).toBe(false)
    expect(repository.getBeaObservation('group')).toBeUndefined()
    repository.close()
  })

  it('appends FOMC official revisions and replays the effective value by as-of', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mi-macro-calendar-'))
    const filePath = join(directory, 'calendar.sqlite')
    try {
      const repository = createMacroCalendarRepository({ filePath })
      const schedule = revision({
        revisionId: 'fomc-schedule-1', eventKey: 'US.FOMC.2026-07-29', releaseGroupKey: 'US.FOMC.2026-07-29',
        eventFamily: 'fomc', eventNameKey: 'fomc', periodKey: '2026-07-29', scheduledDate: '2026-07-29',
        providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule', snapshotHash: 'schedule-hash'
      })
      expect(repository.appendIfNew(schedule).inserted).toBe(true)
      const firstValue = revision({
        revisionId: 'fomc-release-1', eventKey: schedule.eventKey, releaseGroupKey: schedule.releaseGroupKey,
        eventFamily: 'fomc', eventNameKey: 'fomc', periodKey: schedule.periodKey, scheduledDate: schedule.scheduledDate,
        providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-statement', revisionKind: 'official-release', lifecycleState: 'released',
        actual: { displayValue: '3.50%–3.75%', numericLowerBound: 3.5, numericUpperBound: 3.75, unit: 'percent' },
        detectedAt: '2026-08-02T12:30:00.000Z', recordedAt: '2026-08-02T12:30:00.000Z', replacesRevisionId: schedule.revisionId
      })
      expect(repository.appendIfNew(firstValue).inserted).toBe(true)
      expect(repository.appendIfNew({ ...firstValue, revisionId: 'fomc-release-replay', snapshotHash: firstValue.snapshotHash }).inserted).toBe(false)
      const persistedFirst = repository.getEffectiveEventAsOf({ eventKey: schedule.eventKey, asOf: firstValue.detectedAt })!
      expect(repository.appendIfNew({ ...persistedFirst, revisionId: 'same-content-later', detectedAt: '2026-08-02T13:00:00.000Z' }).inserted).toBe(false)

      const correction = revision({
        revisionId: 'fomc-revision-1',
        eventKey: schedule.eventKey, releaseGroupKey: schedule.releaseGroupKey,
        eventFamily: 'fomc', eventNameKey: 'fomc', periodKey: schedule.periodKey, scheduledDate: schedule.scheduledDate,
        providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-statement',
        snapshotHash: 'actual-hash',
        revisionKind: 'official-release',
        lifecycleState: 'released',
        actual: { displayValue: '3.25%–3.50%', numericLowerBound: 3.25, numericUpperBound: 3.5, unit: 'percent' },
        detectedAt: '2026-08-03T12:31:00.000Z', recordedAt: '2026-08-03T12:31:00.000Z',
        replacesRevisionId: firstValue.revisionId
      })
      expect(repository.appendIfNew(correction).inserted).toBe(true)
      expect(repository.getEffectiveEventAsOf({ eventKey: schedule.eventKey, asOf: '2026-08-02T23:59:59.999Z' })?.actual?.displayValue).toBe('3.50%–3.75%')
      expect(repository.getEffectiveEventAsOf({ eventKey: schedule.eventKey, asOf: correction.detectedAt })?.actual?.displayValue).toBe('3.25%–3.50%')
      const returnToFirst = { ...persistedFirst, revisionId: 'fomc-revision-2', detectedAt: '2026-08-04T12:31:00.000Z', recordedAt: '2026-08-04T12:31:00.000Z', replacesRevisionId: correction.revisionId }
      expect(repository.appendIfNew(returnToFirst).inserted).toBe(true)
      expect(repository.getEffectiveEventAsOf({ eventKey: schedule.eventKey, asOf: returnToFirst.detectedAt })?.actual?.displayValue).toBe('3.50%–3.75%')
      expect(repository.inspectStorage().rowCount).toBe(4)
      const laterSchedule = { ...schedule, revisionId: 'fomc-schedule-later', detectedAt: '2026-08-05T12:31:00.000Z', recordedAt: '2026-08-05T12:31:00.000Z' }
      expect(repository.appendIfNew(laterSchedule).inserted).toBe(false)
      expect(repository.getEffectiveEventAsOf({ eventKey: schedule.eventKey, asOf: laterSchedule.detectedAt })?.actual?.displayValue).toBe('3.50%–3.75%')
      repository.close()

      const reloaded = createMacroCalendarRepository({ filePath })
      expect(reloaded.inspectStorage().rowCount).toBe(4)
      expect(reloaded.getEffectiveEventAsOf({ eventKey: schedule.eventKey, asOf: '2026-08-02T23:59:59.999Z' })?.actual?.displayValue).toBe('3.50%–3.75%')
      expect(reloaded.getEffectiveEventAsOf({ eventKey: schedule.eventKey, asOf: correction.detectedAt })?.actual?.displayValue).toBe('3.25%–3.50%')
      reloaded.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('retains replacement semantics for non-Fed current-state rows', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const first = revision({ eventKey: 'US.CPI.2026-07', revisionId: 'cpi-schedule' })
    const next = revision({ eventKey: first.eventKey, revisionId: 'cpi-value', lifecycleState: 'released', revisionKind: 'official-release', actual: { displayValue: '2.8%', numericValue: 2.8, unit: 'percent' } })
    expect(repository.appendIfNew(first).inserted).toBe(true)
    expect(repository.appendIfNew(next).inserted).toBe(true)
    expect(repository.inspectStorage().rowCount).toBe(1)
    expect(repository.getEffectiveEventAsOf({ eventKey: first.eventKey, asOf: next.detectedAt })?.revisionId).toBe(next.revisionId)
    repository.close()
  })

  it('selects the appended Fed chain tail when two verified values share a receipt instant', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const first = revision({ revisionId: 'z-release', providerId: 'macro-calendar-fed', revisionKind: 'official-release', actual: { displayValue: '3.5%' } })
    const next = { ...first, revisionId: 'a-revision', revisionKind: 'official-revision' as const, previous: { displayValue: '3.75%' }, replacesRevisionId: first.revisionId }
    repository.appendIfNew(first)
    repository.appendIfNew(next)
    expect(repository.getEffectiveEventAsOf({ eventKey: first.eventKey, asOf: first.detectedAt })?.revisionId).toBe('a-revision')
    expect(repository.listEffectiveMonthAsOf({ monthStart: '2026-08-01', monthEndExclusive: '2026-09-01', asOf: first.detectedAt, limit: 10 })[0]?.revisionId).toBe('a-revision')
    repository.close()
  })

  it('bounds the effective month query without loading evidence bodies', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    for (let index = 0; index < 5_000; index += 1) {
      repository.appendIfNew(revision({ revisionId: `revision-${index}`, eventKey: `US.CPI.2026-08-${index}`, snapshotHash: `hash-${index}` }))
    }
    const results = repository.listEffectiveMonthAsOf({ monthStart: '2026-08-01', monthEndExclusive: '2026-09-01', asOf: '2026-08-03T00:00:00.000Z', limit: macroCalendarStoragePolicy.monthQueryFixtureRows })
    expect(results).toHaveLength(macroCalendarStoragePolicy.monthQueryMaxEvents)
    expect(JSON.stringify(results)).not.toContain('payloadBody')
    repository.close()
  })

  it('treats raw record ids as runtime-only when deduplicating a semantic snapshot', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const first = revision({
      rawRecordId: 'raw-1',
      evidenceRefs: [{ ...evidence('schedule-evidence', 'schedule'), rawRecordId: 'raw-1' }]
    })
    const sameSnapshot = {
      ...first,
      revisionId: 'revision-2',
      rawRecordId: 'raw-2',
      evidenceRefs: [{ ...first.evidenceRefs[0]!, rawRecordId: 'raw-2' }]
    }

    expect(macroCalendarSnapshotHash(sameSnapshot)).toBe(macroCalendarSnapshotHash(first))
    expect(repository.appendIfNew(first).inserted).toBe(true)
    expect(repository.appendIfNew(sameSnapshot).inserted).toBe(false)
    expect(repository.appendIfNew({ ...sameSnapshot, evidenceHash: 'changed-evidence', evidenceRefs: [{ ...sameSnapshot.evidenceRefs[0]!, evidenceHash: 'changed-evidence' }] }).inserted).toBe(false)
    expect(repository.appendIfNew({ ...sameSnapshot, revisionId: 'revision-3', scheduledDate: '2026-08-03' }).inserted).toBe(true)
    repository.close()
  })

  it('appends a schedule batch atomically and reports inserted and deduped rows', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const first = revision({ revisionId: 'batch-1', eventKey: 'US.CPI.RELEASE.first' })
    const second = revision({ revisionId: 'batch-2', eventKey: 'US.CORE_CPI.RELEASE.first', eventFamily: 'core-cpi', eventNameKey: 'core-cpi' })

    expect(repository.appendManyIfNew([first, second])).toEqual({ insertedCount: 2, dedupedCount: 0 })
    expect(repository.appendManyIfNew([
      { ...first, revisionId: 'batch-1-repeat', detectedAt: '2026-08-02T12:00:00.000Z', recordedAt: '2026-08-02T12:00:00.000Z' },
      revision({ revisionId: 'batch-3', eventKey: 'US.CPI.RELEASE.second' })
    ])).toEqual({ insertedCount: 1, dedupedCount: 1 })
    expect(repository.inspectStorage().rowCount).toBe(3)
    repository.close()
  })

  it('replaces a same-day manual BLS metric with the automatic annual metric', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const manual = revision({
      revisionId: 'manual', eventKey: 'US.NONFARM_PAYROLLS.RELEASE.manual-uid', releaseGroupKey: 'US.BLS.RELEASE.manual-uid',
      eventFamily: 'employment-situation', eventNameKey: 'nonfarm-payrolls', periodKey: 'release-2026-07-02', scheduledDate: '2026-07-02',
      scheduledAt: '2026-07-02T12:30:00.000Z', descriptorId: 'macro-calendar-bls-ics-manual', caveats: ['manual-ics-import']
    })
    const automatic = revision({
      revisionId: 'automatic', eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M06', releaseGroupKey: 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M06',
      eventFamily: 'employment-situation', eventNameKey: 'nonfarm-payrolls', periodKey: '2026-M06', scheduledDate: '2026-07-02',
      descriptorId: 'macro-calendar-bls-calendar-family-refresh-api-v2', revisionKind: 'official-release', lifecycleState: 'released',
      actual: { numericValue: 147, displayValue: '+147K', unit: 'thousands' }, previous: { numericValue: 139, displayValue: '+139K', unit: 'thousands' },
      caveats: ['bls-python-schedule'], detectedAt: '2026-08-02T12:30:00.000Z', recordedAt: '2026-08-02T12:30:00.000Z'
    })

    expect(repository.appendIfNew(manual).inserted).toBe(true)
    expect(repository.appendIfNew(automatic).inserted).toBe(true)
    expect(repository.inspectStorage().rowCount).toBe(1)
    expect(repository.listEffectiveMonthAsOf({ monthStart: '2026-07-01', monthEndExclusive: '2026-08-01', asOf: automatic.detectedAt, limit: 10 }))
      .toEqual([expect.objectContaining({ eventKey: automatic.eventKey })])
    repository.close()
  })

  it('keeps an automatic official value when a later schedule sync repeats its event key', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const officialValue = revision({
      revisionId: 'automatic-value', eventKey: 'US.CPI.RELEASE.2026-M06', releaseGroupKey: 'US.CPI.RELEASE.2026-M06',
      eventFamily: 'consumer-price-index', eventNameKey: 'cpi', periodKey: '2026-M06', scheduledDate: '2026-07-14',
      descriptorId: 'macro-calendar-bls-calendar-family-refresh-api-v2', revisionKind: 'official-release', lifecycleState: 'released',
      actual: { numericValue: 2.7, displayValue: '2.7%', unit: 'percent' }, previous: { numericValue: 2.8, displayValue: '2.8%', unit: 'percent' },
      caveats: ['bls-python-schedule']
    })
    const laterSchedule = revision({
      revisionId: 'later-schedule', eventKey: officialValue.eventKey, releaseGroupKey: officialValue.releaseGroupKey,
      eventFamily: 'consumer-price-index', eventNameKey: 'cpi', periodKey: '2026-M06', scheduledDate: '2026-07-14',
      descriptorId: 'macro-calendar-bls-python-schedule', caveats: ['bls-python-schedule'],
      detectedAt: '2026-08-02T12:30:00.000Z', recordedAt: '2026-08-02T12:30:00.000Z'
    })

    expect(repository.appendIfNew(officialValue).inserted).toBe(true)
    expect(repository.appendIfNew(laterSchedule).inserted).toBe(false)
    expect(repository.getEffectiveEventAsOf({ eventKey: officialValue.eventKey, asOf: laterSchedule.detectedAt }))
      .toEqual(expect.objectContaining({ revisionId: officialValue.revisionId, actual: officialValue.actual }))
    repository.close()
  })

  it('keeps an automatic official value during current-state migration even when an old schedule was recorded later', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mi-macro-calendar-migration-'))
    const filePath = join(directory, 'calendar.sqlite')
    try {
      const legacy = createLegacyDatabase(filePath)
      const officialValue = revision({
        revisionId: 'automatic-value', eventKey: 'US.CPI.RELEASE.2026-M06', releaseGroupKey: 'US.CPI.RELEASE.2026-M06',
        eventFamily: 'consumer-price-index', eventNameKey: 'cpi', periodKey: '2026-M06', scheduledDate: '2026-07-14',
        descriptorId: 'macro-calendar-bls-calendar-family-refresh-api-v2', revisionKind: 'official-release', lifecycleState: 'released',
        actual: { numericValue: 2.7, displayValue: '2.7%', unit: 'percent' }, previous: { numericValue: 2.8, displayValue: '2.8%', unit: 'percent' },
        caveats: ['bls-python-schedule'], snapshotHash: 'automatic-value-snapshot'
      })
      const laterSchedule = revision({
        revisionId: 'later-schedule', eventKey: officialValue.eventKey, releaseGroupKey: officialValue.releaseGroupKey,
        eventFamily: 'consumer-price-index', eventNameKey: 'cpi', periodKey: '2026-M06', scheduledDate: '2026-07-14',
        descriptorId: 'macro-calendar-bls-python-schedule', caveats: ['bls-python-schedule'],
        detectedAt: '2026-08-02T12:30:00.000Z', recordedAt: '2026-08-02T12:30:00.000Z', snapshotHash: 'later-schedule-snapshot'
      })
      const insert = legacy.prepare('insert into mi_macro_calendar_revisions (revision_id,event_key,release_group_key,event_family,event_name_key,country_code,importance,period_key,lifecycle_state,revision_kind,scheduled_date,scheduled_at,published_at,detected_at,detected_at_ms,recorded_at,actual_json,previous_json,consensus_json,provider_id,descriptor_id,source_url,raw_record_id,evidence_hash,evidence_refs_json,snapshot_hash,replaces_revision_id,parser_version,caveats_json,schema_version) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      insert.run(...storedValues(officialValue))
      insert.run(...storedValues(laterSchedule))
      legacy.close()

      const repository = createMacroCalendarRepository({ filePath })
      expect(repository.inspectStorage().rowCount).toBe(1)
      expect(repository.getEffectiveEventAsOf({ eventKey: officialValue.eventKey, asOf: laterSchedule.detectedAt }))
        .toEqual(expect.objectContaining({ revisionId: officialValue.revisionId, actual: officialValue.actual }))
      repository.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rolls back every inserted row when a later batch revision fails', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const first = revision({ revisionId: 'rollback-1', eventKey: 'US.CPI.RELEASE.rollback' })
    const invalid = revision({
      revisionId: 'rollback-2',
      eventKey: { unsupported: true } as unknown as string
    })

    expect(() => repository.appendManyIfNew([first, invalid])).toThrow(/cannot be bound|unknown named parameter/i)
    expect(repository.inspectStorage().rowCount).toBe(0)
    repository.close()
  })

  it('rolls back a failed migration before surfacing the failure', () => {
    const calls: string[] = []
    expect(() => createMacroCalendarRepository({
      filePath: ':memory:',
      migrationExecutor: (sql) => {
        calls.push(sql)
        if (sql.includes('create table')) throw new Error('fixture migration failure')
      }
    })).toThrow('fixture migration failure')
    expect(calls).toEqual(['begin', expect.stringContaining('create table'), 'rollback'])
  })

  it('uses parsed detectedAt instants consistently for every as-of query', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const stored = revision({ detectedAt: '2026-08-01T08:00:00.000Z', recordedAt: '2026-08-01T08:00:00.000Z' })
    repository.appendIfNew(stored)
    const beforeDetectedAt = '2026-08-01T09:00:00+02:00'
    const atDetectedAt = '2026-08-01T10:00:00+02:00'

    expect(repository.getEffectiveEventAsOf({ eventKey: stored.eventKey, asOf: beforeDetectedAt })).toBeUndefined()
    expect(repository.listEffectiveMonthAsOf({ monthStart: '2026-08-01', monthEndExclusive: '2026-09-01', asOf: beforeDetectedAt, limit: 10 })).toEqual([])
    expect(repository.listVisibleProviderFactsAsOf({ providerIds: [stored.providerId], asOf: beforeDetectedAt })).toEqual([])
    expect(repository.getEffectiveEventAsOf({ eventKey: stored.eventKey, asOf: atDetectedAt })?.revisionId).toBe(stored.revisionId)
    expect(repository.listEffectiveMonthAsOf({ monthStart: '2026-08-01', monthEndExclusive: '2026-09-01', asOf: atDetectedAt, limit: 10 })).toHaveLength(1)
    expect(repository.listVisibleProviderFactsAsOf({ providerIds: [stored.providerId], asOf: atDetectedAt })).toHaveLength(1)
    expect(repository.getEffectiveEventAsOf({ eventKey: stored.eventKey, asOf: 'not-a-date' })).toBeUndefined()
    expect(repository.listEffectiveMonthAsOf({ monthStart: '2026-08-01', monthEndExclusive: '2026-09-01', asOf: 'not-a-date', limit: 10 })).toEqual([])
    expect(repository.listVisibleProviderFactsAsOf({ providerIds: [stored.providerId], asOf: 'not-a-date' })).toEqual([])
    repository.close()
  })

  it('rejects non-canonical detectedAt values before they can enter any as-of query', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const invalid = ['not-a-date', '2026-08-01', '08/01/2026', '2026-02-29T12:00:00.000Z'].map((detectedAt, index) =>
      revision({ revisionId: `bad-${index}`, eventKey: `US.BAD.2026-08-${index}`, detectedAt })
    )

    for (const revision of invalid) {
      expect(() => repository.appendIfNew(revision)).toThrow('invalid detectedAt')
      expectAsOfInvisible(repository, revision)
    }
    repository.close()
  })

  it('accepts a real leap-day detectedAt timestamp', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const leapDay = revision({ revisionId: 'leap-day', eventKey: 'US.LEAP.2028-02', detectedAt: '2028-02-29T12:00:00.000Z' })

    expect(repository.appendIfNew(leapDay).inserted).toBe(true)
    expect(repository.getEffectiveEventAsOf({ eventKey: leapDay.eventKey, asOf: leapDay.detectedAt })?.revisionId).toBe('leap-day')
    repository.close()
  })

})

function expectAsOfInvisible(repository: ReturnType<typeof createMacroCalendarRepository>, revision: MacroCalendarRevision): void {
  const asOf = '2026-08-01T00:00:00.000Z'
  expect(repository.getEffectiveEventAsOf({ eventKey: revision.eventKey, asOf })).toBeUndefined()
  expect(repository.listEffectiveMonthAsOf({ monthStart: '2026-08-01', monthEndExclusive: '2026-09-01', asOf, limit: 10 })).toEqual([])
  expect(repository.listVisibleProviderFactsAsOf({ providerIds: [revision.providerId], asOf })).toEqual([])
}

function revision(overrides: Partial<MacroCalendarRevision> = {}): MacroCalendarRevision {
  return {
    revisionId: 'revision-1', eventKey: 'US.CPI.2026-07', releaseGroupKey: 'US.BLS.CPI.2026-07', eventFamily: 'cpi', eventNameKey: 'cpi', countryCode: 'US', importance: 'high', periodKey: '2026-07', lifecycleState: 'scheduled', revisionKind: 'schedule', scheduledDate: '2026-08-02', detectedAt: '2026-08-01T12:00:00.000Z', recordedAt: '2026-08-01T12:00:00.000Z', providerId: 'macro-calendar-bls', descriptorId: 'fixture-bls-schedule', sourceUrl: 'https://official.invalid/release', evidenceHash: 'schedule-evidence', evidenceRefs: [evidence('schedule-evidence', 'schedule')], snapshotHash: 'schedule-hash', parserVersion: 'fixture-v1', caveats: [], ...overrides
  }
}

function evidence(evidenceHash: string, fieldKind: 'schedule' | 'actual') {
  return { providerId: 'macro-calendar-bls', descriptorId: 'fixture-bls-schedule', sourceUrl: 'https://official.invalid/release', evidenceHash, detectedAt: '2026-08-01T12:00:00.000Z', fieldKinds: [fieldKind] }
}

function createLegacyDatabase(filePath: string): DatabaseSync {
  const database = new DatabaseSync(filePath)
  database.exec('create table mi_macro_calendar_revisions (revision_id text primary key, event_key text not null, release_group_key text not null, event_family text not null, event_name_key text not null, country_code text not null, importance text not null, period_key text not null, lifecycle_state text not null, revision_kind text not null, scheduled_date text not null, scheduled_at text, published_at text, detected_at text not null, detected_at_ms integer not null, recorded_at text not null, actual_json text, previous_json text, consensus_json text, provider_id text not null, descriptor_id text not null, source_url text not null, raw_record_id text, evidence_hash text not null, evidence_refs_json text not null, snapshot_hash text not null, replaces_revision_id text, parser_version text not null, caveats_json text not null, schema_version integer not null, unique(event_key, snapshot_hash)); create table mi_macro_calendar_migrations (version integer primary key)')
  return database
}

function storedValues(revision: MacroCalendarRevision): Array<string | number | null> {
  return [revision.revisionId, revision.eventKey, revision.releaseGroupKey, revision.eventFamily, revision.eventNameKey, revision.countryCode, revision.importance, revision.periodKey, revision.lifecycleState, revision.revisionKind, revision.scheduledDate, revision.scheduledAt ?? null, revision.publishedAt ?? null, revision.detectedAt, Date.parse(revision.detectedAt), revision.recordedAt, revision.actual ? JSON.stringify(revision.actual) : null, revision.previous ? JSON.stringify(revision.previous) : null, revision.consensus ? JSON.stringify(revision.consensus) : null, revision.providerId, revision.descriptorId, revision.sourceUrl, revision.rawRecordId ?? null, revision.evidenceHash, JSON.stringify(revision.evidenceRefs), revision.snapshotHash, revision.replacesRevisionId ?? null, revision.parserVersion, JSON.stringify(revision.caveats), 1]
}
