import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createRawRecordStore } from '../application/rawRecordStore'
import { createMacroCalendarEvidenceArchive } from './macroCalendarEvidenceArchive'
import { createMacroCalendarRepository } from './macroCalendarRepository'
import { createMacroCalendarSqlite } from './macroCalendarSqlite'
import { createMarketCalendarEventRepository } from './0xrouter-calendar/marketCalendarEventRepository'
import { getMacroCalendarEvidenceSourceDescriptor } from './macroCalendarOfficialSourceRegistry'
import { createCalendarStorageSnapshotService } from './macroCalendarStorageSnapshotService'

const cleanup: Array<() => void> = []
afterEach(() => cleanup.splice(0).reverse().forEach(dispose => dispose()))
function harness() {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'mc4d-snapshot-')))
  cleanup.push(() => rmSync(parent, { recursive: true, force: true }))
  const source = createMacroCalendarSqlite(join(parent, 'source.sqlite'))
  cleanup.push(() => source.close())
  createMacroCalendarRepository({ storage: source })
  createMarketCalendarEventRepository({ database: source.database })
  const archive = createMacroCalendarEvidenceArchive({ rawRecords: createRawRecordStore(), archiveDirectory: join(parent, 'archive') })
  const descriptorId = 'macro-calendar-0xrouter-economic-data'
  const body = '{"derived":true}'
  const evidenceHash = createHash('sha256').update(body).digest('hex')
  const record = archive.append(archive.reserve(1024)!, { sourceId: descriptorId, sourceUrl: getMacroCalendarEvidenceSourceDescriptor(descriptorId)!.sourceUrl, runId: 'derived', detectedAt: '2026-09-09T00:00:00.000Z', payloadFormat: 'json', payloadBody: body, payloadSizeBytes: Buffer.byteLength(body), payloadHash: evidenceHash, sourceDedupeKey: 'derived', parserVersion: 'derived' })!.record
  // Real schema/WAL with a derived collection; no production user data.
  source.database.prepare(`insert into mi_macro_calendar_market_event_collections
    (collection_id,provider_id,descriptor_id,locale,window_start,window_end,detected_at,recorded_at,raw_record_id,evidence_hash,parser_version,input_count,skipped_count,skip_reasons_json,status)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('collection-original', '0xrouter', descriptorId, 'zh', '2026-09-01', '2026-10-01', record.detectedAt, record.detectedAt, record.rawRecordId, evidenceHash, 'derived', 0, 0, '{}', 'success-empty')
  const service = createCalendarStorageSnapshotService()
  const target = { parent, name: 'snapshot' }
  return { parent, source, archive, record, service, target, snapshot: () => service.createSnapshot({ ...target, source, archive }) }
}

describe('calendar consistent snapshot and isolated restore', () => {
  it('includes committed WAL, remains immutable after source writes, restores original IDs/time', async () => {
    const h = harness()
    expect(statSync(`${h.source.filePath}-wal`).size).toBeGreaterThan(0)
    expect(await h.snapshot()).toMatchObject({ state: 'complete', marketWritesAllowed: false, recordCount: 1 })
    h.source.database.exec("update mi_macro_calendar_market_event_collections set recorded_at='later'")
    expect(await h.service.restoreIsolated({ bundle: h.target, parent: h.parent, name: 'restored' })).toMatchObject({ state: 'complete', marketWritesAllowed: false })
    const restored = new DatabaseSync(join(h.parent, 'restored', 'calendar.sqlite'), { readOnly: true })
    try {
      expect(restored.prepare('select collection_id,collection_sequence,recorded_at,raw_record_id from mi_macro_calendar_market_event_collections').get()).toEqual({ collection_id: 'collection-original', collection_sequence: 1, recorded_at: h.record.detectedAt, raw_record_id: h.record.rawRecordId })
    } finally { restored.close() }
    expect(JSON.parse(readFileSync(join(h.parent, 'restored', 'records.json'), 'utf8'))).toEqual([h.record])
    expect(await h.service.verifyBundle(h.target)).toMatchObject({ state: 'complete' })
  })
  it('reads the snapshot reference cut rather than later live collections', async () => {
    const h = harness(); let changed = false
    const archive = { ...h.archive, getRecord: (id: string) => {
      if (!changed) { changed = true; h.source.database.exec("update mi_macro_calendar_market_event_collections set raw_record_id='not-in-archive'") }
      return h.archive.getRecord(id)
    } }
    expect(await h.service.createSnapshot({ ...h.target, source: h.source, archive })).toMatchObject({ state: 'complete' })
  })
  it('refuses metadata which changes during copying instead of publishing a mixed bundle', async () => {
    const h = harness(); let reads = 0
    const archive = { ...h.archive, getRecord: (id: string) => {
      const record = h.archive.getRecord(id)
      return record && ++reads > 1 ? { ...record, parserVersion: 'changed-during-copy' } : record
    } }
    expect(await h.service.createSnapshot({ ...h.target, source: h.source, archive })).toMatchObject({ state: 'incomplete' })
    expect(existsSync(join(h.parent, 'snapshot', 'complete.json'))).toBe(false)
  })
  it('preserves inline representation without allocating new archive IDs', async () => {
    const h = harness(); const body = h.archive.readBody(h.record)!
    const record = { ...h.record, payloadRefType: 'inline' as const, payloadBody: body, payloadFileRef: undefined }
    const archive = { getRecord: (id: string) => id === record.rawRecordId ? record : undefined, readBody: () => body }
    expect(await h.service.createSnapshot({ ...h.target, source: h.source, archive })).toMatchObject({ state: 'complete', recordCount: 1 })
    expect(readdirSync(join(h.parent, 'snapshot')).filter(name => name.endsWith('.bin'))).toEqual([])
    expect(await h.service.restoreIsolated({ bundle: h.target, parent: h.parent, name: 'inline-restore' })).toMatchObject({ state: 'complete' })
    expect(JSON.parse(readFileSync(join(h.parent, 'inline-restore', 'records.json'), 'utf8'))).toEqual([JSON.parse(JSON.stringify(record))])
  })
  it('verifies without adding files or changing database contents', async () => {
    const h = harness(); h.source.database.prepare('insert into mi_bea_release_observation_state (release_group_key,schedule_fingerprint,last_attempt_at) values (?,?,?)').run('derived', 'original', '2026-09-09T00:00:00.000Z'); expect((await h.snapshot()).state).toBe('complete')
    const directory = join(h.parent, 'snapshot')
    const files = readdirSync(directory)
    expect(files.sort()).toEqual(['calendar.sqlite', 'complete.json', 'manifest.json', 'records.json', `${h.record.payloadHash}.bin`].sort())
    const before = new Map(readdirSync(directory).map(name => [name, readFileSync(join(directory, name))]))
    expect((await h.service.verifyBundle(h.target)).state).toBe('complete')
    expect(readdirSync(directory)).toEqual(files)
    for (const [name, bytes] of before) expect(readFileSync(join(directory, name)).equals(bytes)).toBe(true)
  })
  it('rejects WAL-only mutations and sidecars without mutating the bundle', async () => {
    const h = harness(); h.source.database.prepare('insert into mi_bea_release_observation_state (release_group_key,schedule_fingerprint,last_attempt_at) values (?,?,?)').run('derived', 'original', '2026-09-09T00:00:00.000Z'); expect((await h.snapshot()).state).toBe('complete')
    const directory = join(h.parent, 'snapshot')
    const before = createHash('sha256').update(readFileSync(join(directory, 'calendar.sqlite'))).digest('hex')
    const connection = new DatabaseSync(join(directory, 'calendar.sqlite'))
    try {
      connection.exec("pragma wal_autocheckpoint=0; update mi_bea_release_observation_state set schedule_fingerprint='wal-only-change';")
      expect(connection.prepare('select schedule_fingerprint from mi_bea_release_observation_state').get()?.schedule_fingerprint).toBe('wal-only-change')
      expect(createHash('sha256').update(readFileSync(join(directory, 'calendar.sqlite'))).digest('hex')).toBe(before)
      expect((await h.service.verifyBundle(h.target)).state).toBe('incomplete')
      expect((await h.service.restoreIsolated({ bundle: h.target, parent: h.parent, name: 'wal-restore' })).state).toBe('incomplete')
      expect(existsSync(join(h.parent, 'wal-restore'))).toBe(false)
    } finally { connection.close() }
  })
  it.each((['calendar.sqlite-wal', 'calendar.sqlite-shm'] as const).flatMap(name => (['regular', 'valid-symlink', 'dangling-symlink'] as const).map(kind => [name, kind] as const)))('rejects %s sidecar (%s)', async (name, kind) => {
    const h = harness(); expect((await h.snapshot()).state).toBe('complete')
    const path = join(h.parent, 'snapshot', name)
    if (kind === 'regular') writeFileSync(path, 'sidecar')
    else symlinkSync(kind === 'valid-symlink' ? join(h.parent, 'source.sqlite') : join(h.parent, 'missing-sidecar-target'), path)
    const before = readdirSync(join(h.parent, 'snapshot')).sort()
    expect((await h.service.verifyBundle(h.target)).state).toBe('incomplete')
    expect((await h.service.restoreIsolated({ bundle: h.target, parent: h.parent, name: `sidecar-${kind}` })).state).toBe('incomplete')
    expect(existsSync(join(h.parent, `sidecar-${kind}`))).toBe(false)
    expect(readdirSync(join(h.parent, 'snapshot')).sort()).toEqual(before)
    if (kind === 'valid-symlink' || kind === 'dangling-symlink') expect(lstatSync(path).isSymbolicLink()).toBe(true)
  })
  it('refuses insufficient space before touching source or publishing a directory', async () => {
    const h = harness(); const before = statSync(`${h.source.filePath}-wal`).size
    const service = createCalendarStorageSnapshotService({ readFreeBytes: () => 1 })
    expect(await service.createSnapshot({ ...h.target, source: h.source, archive: h.archive })).toMatchObject({ state: 'incomplete', failureCode: 'capacity', marketWritesAllowed: false })
    expect(existsSync(join(h.parent, h.target.name))).toBe(false)
    expect(statSync(`${h.source.filePath}-wal`).size).toBe(before)
  })
  it('rechecks reserve during copying and leaves no completion marker on failure', async () => {
    const h = harness(); let reads = 0
    const service = createCalendarStorageSnapshotService({ readFreeBytes: () => ++reads <= 2 ? 10 * 1024 ** 3 : 0 })
    expect(await service.createSnapshot({ ...h.target, source: h.source, archive: h.archive })).toMatchObject({ state: 'incomplete', failureCode: 'capacity' })
    expect(existsSync(join(h.parent, 'snapshot', 'complete.json'))).toBe(false)
    expect(h.source.database.prepare('select count(*) as n from mi_macro_calendar_market_event_collections').get()?.n).toBe(1)
  })
  it('refuses existing targets, traversal and symlink parents without overwriting', async () => {
    const h = harness(); expect((await h.snapshot()).state).toBe('complete')
    const before = readFileSync(join(h.parent, 'snapshot', 'complete.json'), 'utf8')
    expect((await h.snapshot()).state).toBe('incomplete')
    expect((await h.service.createSnapshot({ ...h.target, name: '../escape', source: h.source, archive: h.archive })).state).toBe('incomplete')
    symlinkSync(join(h.parent, 'snapshot'), join(h.parent, 'link'))
    expect((await h.service.verifyBundle({ parent: h.parent, name: 'link' })).state).toBe('incomplete')
    expect((await h.service.createSnapshot({ parent: join(h.parent, 'link'), name: 'escape', source: h.source, archive: h.archive })).state).toBe('incomplete')
    expect(readFileSync(join(h.parent, 'snapshot', 'complete.json'), 'utf8')).toBe(before)
  })
  it.each(['marker', 'body', 'database', 'version', 'duplicate-id', 'traversal', 'symlink'] as const)('rejects corrupt bundle %s and never restores it', async kind => {
    const h = harness(); expect((await h.snapshot()).state).toBe('complete')
    const dir = join(h.parent, 'snapshot')
    if (kind === 'marker') rmSync(join(dir, 'complete.json'))
    if (kind === 'body') writeFileSync(join(dir, `${h.record.payloadHash}.bin`), 'corrupt')
    if (kind === 'database') writeFileSync(join(dir, 'calendar.sqlite'), 'corrupt')
    if (kind === 'symlink') { rmSync(join(dir, 'records.json')); symlinkSync(join(h.parent, 'source.sqlite'), join(dir, 'records.json')) }
    if (['version', 'duplicate-id', 'traversal'].includes(kind)) {
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
      if (kind === 'version') manifest.formatVersion = 999
      if (kind === 'duplicate-id') manifest.recordIds.push(manifest.recordIds[0])
      if (kind === 'traversal') manifest.database.name = '../source.sqlite'
      const body = JSON.stringify(manifest); writeFileSync(join(dir, 'manifest.json'), body)
      writeFileSync(join(dir, 'complete.json'), JSON.stringify({ manifestHash: createHash('sha256').update(body).digest('hex') }))
    }
    expect(await h.service.verifyBundle(h.target)).toMatchObject({ state: 'incomplete', marketWritesAllowed: false })
    expect((await h.service.restoreIsolated({ bundle: h.target, parent: h.parent, name: 'bad-restore' })).state).toBe('incomplete')
    expect(existsSync(join(h.parent, 'bad-restore'))).toBe(false)
  })
})
