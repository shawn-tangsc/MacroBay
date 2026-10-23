import { createHash } from 'node:crypto'
import { constants, createReadStream, createWriteStream, lstatSync, mkdirSync, openSync, closeSync,
  fstatSync, readFileSync, realpathSync, statfsSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { backup, DatabaseSync } from 'node:sqlite'
import type { MacroCalendarSqlite } from './macroCalendarSqlite'
import { macroCalendarEvidenceArchivePolicy as limits, type MacroCalendarEvidenceArchive } from './macroCalendarEvidenceArchive'
import { zeroXRouterCalendarStoragePolicy as market } from './0xrouter-calendar/marketCalendarStorageValidation'
import { MACRO_CALENDAR_SCHEMA_VERSION } from './macroCalendarContracts'
import { CalendarSnapshotFailure, collectSnapshotEvidence, snapshotHash, snapshotReject,
  type SnapshotEvidence, type SnapshotFailureCode } from './macroCalendarStorageSnapshotEvidence'
import type { RawIntelligenceRecord } from '../schema/intelligenceRecord'

// CalendarBackupPolicy: product-owned design 121, unregistered main-only maintenance.
export const calendarBackupPolicy = Object.freeze({
  formatVersion: 1, backupPages: 100, directoryMode: 0o700, fileMode: 0o600,
  databaseName: 'calendar.sqlite', metadataName: 'records.json', manifestName: 'manifest.json', markerName: 'complete.json',
  targetNamePattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, markerBytes: 1024
})
type Location = { parent: string; name: string }
type FileEntry = { name: string; bytes: number; hash: string }
type Manifest = { formatVersion: number; officialSchemaVersion: number; marketSchemaVersion: number;
  database: FileEntry; metadata: FileEntry; bodies: FileEntry[]; recordIds: string[];
  referenceCount: number; bodyCount: number; bodyBytes: number }
type Result = { state: 'complete' | 'incomplete'; marketWritesAllowed: false; failureCode?: SnapshotFailureCode;
  recordCount: number; referenceCount: number; bodyBytes: number; elapsedMs: number }
type EvidenceReader = Pick<MacroCalendarEvidenceArchive, 'getRecord' | 'readBody'>

export function createCalendarStorageSnapshotService(options: { readFreeBytes?: (parent: string) => number } = {}) {
  const policy = calendarBackupPolicy
  const readFreeBytes = options.readFreeBytes ?? ((parent: string) => { const info = statfsSync(parent); return info.bavail * info.bsize })
  function capacity(parent: string, additional = 0) {
    const bytes = readFreeBytes(parent)
    if (!Number.isSafeInteger(bytes) || bytes < market.minimumFreeBytes + additional) snapshotReject('capacity')
  }
  async function result(operation: () => Promise<SnapshotEvidence>): Promise<Result> {
    const start = performance.now()
    try {
      const evidence = await operation()
      return { state: 'complete', marketWritesAllowed: false, recordCount: evidence.records.length,
        referenceCount: evidence.referenceCount, bodyBytes: evidence.bodyBytes, elapsedMs: performance.now() - start }
    } catch (error) {
      return { state: 'incomplete', marketWritesAllowed: false,
        failureCode: error instanceof CalendarSnapshotFailure ? error.code : 'io-failure',
        recordCount: 0, referenceCount: 0, bodyBytes: 0, elapsedMs: performance.now() - start }
    }
  }
  async function verify(location: Location, requireMarker: boolean) {
    const directory = safeDirectory(location)
    const manifestText = readBounded(join(directory, policy.manifestName), limits.maximumMetadataBytes)
    if (requireMarker) {
      const marker = JSON.parse(readBounded(join(directory, policy.markerName), policy.markerBytes))
      if (marker?.manifestHash !== snapshotHash(manifestText)) snapshotReject('bundle-invalid')
    }
    const manifest = JSON.parse(manifestText) as Manifest
    if (!manifest || manifest.formatVersion !== policy.formatVersion || manifest.officialSchemaVersion !== MACRO_CALENDAR_SCHEMA_VERSION ||
      manifest.marketSchemaVersion !== market.schemaVersion || !Array.isArray(manifest.bodies) || !Array.isArray(manifest.recordIds) ||
      manifest.recordIds.some(id => typeof id !== 'string' || !id) || new Set(manifest.recordIds).size !== manifest.recordIds.length ||
      ![manifest.referenceCount, manifest.bodyCount, manifest.bodyBytes].every(value => Number.isSafeInteger(value) && value >= 0)) snapshotReject('bundle-invalid')
    validateEntry(manifest.database, policy.databaseName)
    validateEntry(manifest.metadata, policy.metadataName)
    if (manifest.metadata.bytes + Buffer.byteLength(manifestText) > limits.maximumMetadataBytes ||
      manifest.bodyBytes > limits.maximumArchiveBytes) snapshotReject('capacity')
    const names = new Set<string>()
    let externalBytes = 0
    for (const entry of manifest.bodies) {
      validateEntry(entry, `${entry.hash}.bin`)
      if (names.has(entry.name)) snapshotReject('bundle-invalid')
      names.add(entry.name); externalBytes += entry.bytes
      if (externalBytes > limits.maximumArchiveBytes) snapshotReject('capacity')
    }
    for (const entry of [manifest.database, manifest.metadata, ...manifest.bodies]) {
      const actual = await fileEntry(directory, entry.name)
      if (actual.hash !== entry.hash || actual.bytes !== entry.bytes) snapshotReject('bundle-invalid')
    }
    const records: unknown = JSON.parse(readBounded(join(directory, policy.metadataName), limits.maximumMetadataBytes))
    if (!Array.isArray(records)) snapshotReject('bundle-invalid')
    const byId = new Map<string, RawIntelligenceRecord>()
    for (const record of records as RawIntelligenceRecord[]) {
      if (!record || typeof record.rawRecordId !== 'string' || byId.has(record.rawRecordId)) snapshotReject('bundle-invalid')
      byId.set(record.rawRecordId, record)
    }
    if (JSON.stringify([...byId.keys()]) !== JSON.stringify(manifest.recordIds)) snapshotReject('bundle-invalid')
    const reader: EvidenceReader = { getRecord: id => byId.get(id), readBody: record => {
      if (record.payloadRefType === 'inline') return record.payloadBody
      if (record.payloadRefType !== 'file' || record.payloadFileRef !== `${record.payloadHash}.bin` || !names.has(record.payloadFileRef)) return undefined
      return readBounded(join(directory, record.payloadFileRef), Math.min(record.payloadSizeBytes ?? 0, limits.maximumArchiveBytes))
    } }
    const usedBodies = new Set<string>()
    const evidence = await scan(directory, reader, async record => { if (record.payloadRefType === 'file') usedBodies.add(record.payloadFileRef!) })
    if (evidence.records.length !== byId.size || evidence.records.some(record => !byId.has(record.rawRecordId)) ||
      usedBodies.size !== names.size || [...names].some(name => !usedBodies.has(name)) || evidence.referenceCount !== manifest.referenceCount ||
      evidence.bodyCount !== manifest.bodyCount || evidence.bodyBytes !== manifest.bodyBytes) snapshotReject('bundle-invalid')
    return { evidence, manifest, manifestText }
  }
  return {
    createSnapshot(input: Location & { source: MacroCalendarSqlite; archive: EvidenceReader }): Promise<Result> {
      return result(async () => {
        safeParent(input)
        const physicalBytes = statSync(input.source.filePath).size
        const pageCount = Number(input.source.database.prepare('pragma page_count').get()?.page_count)
        const pageSize = Number(input.source.database.prepare('pragma page_size').get()?.page_size)
        capacity(input.parent, Math.max(physicalBytes, pageCount * pageSize) + limits.maximumArchiveBytes + limits.maximumMetadataBytes)
        const directory = exclusiveDirectory(input)
        await backup(input.source.database, join(directory, policy.databaseName), { rate: policy.backupPages })
        const copied = new DatabaseSync(join(directory, policy.databaseName))
        try { copied.exec('pragma wal_checkpoint(truncate)') } finally { copied.close() }
        rmSync(`${join(directory, policy.databaseName)}-wal`, { force: true })
        rmSync(`${join(directory, policy.databaseName)}-shm`, { force: true })
        capacity(input.parent)
        const bodies = new Map<string, FileEntry>()
        const evidence = await scan(directory, input.archive, async (record, body) => {
          capacity(input.parent, Buffer.byteLength(body))
          if (record.payloadRefType === 'file' && !bodies.has(record.payloadHash)) {
            const name = `${record.payloadHash}.bin`
            writeExclusive(join(directory, name), body)
            bodies.set(record.payloadHash, { name, bytes: Buffer.byteLength(body), hash: record.payloadHash })
          }
        })
        const metadata = JSON.stringify(evidence.records)
        capacity(input.parent, Buffer.byteLength(metadata))
        writeExclusive(join(directory, policy.metadataName), metadata)
        const manifest: Manifest = { formatVersion: policy.formatVersion, officialSchemaVersion: MACRO_CALENDAR_SCHEMA_VERSION,
          marketSchemaVersion: market.schemaVersion, database: await fileEntry(directory, policy.databaseName),
          metadata: await fileEntry(directory, policy.metadataName), bodies: [...bodies.values()], recordIds: evidence.records.map(record => record.rawRecordId),
          referenceCount: evidence.referenceCount, bodyCount: evidence.bodyCount, bodyBytes: evidence.bodyBytes }
        const text = JSON.stringify(manifest)
        if (Buffer.byteLength(text) + Buffer.byteLength(metadata) > limits.maximumMetadataBytes) snapshotReject('capacity')
        writeExclusive(join(directory, policy.manifestName), text)
        await verify(input, false)
        for (const record of evidence.records) {
          const current = input.archive.getRecord(record.rawRecordId)
          if (!current || JSON.stringify(current) !== JSON.stringify(record)) snapshotReject('evidence-invalid')
          const body = input.archive.readBody(current)
          if (typeof body !== 'string' || snapshotHash(body) !== record.payloadHash || Buffer.byteLength(body) !== record.payloadSizeBytes) snapshotReject('evidence-invalid')
        }
        capacity(input.parent, policy.markerBytes)
        writeExclusive(join(directory, policy.markerName), JSON.stringify({ manifestHash: snapshotHash(text) }))
        return evidence
      })
    },
    verifyBundle(input: Location): Promise<Result> { return result(async () => (await verify(input, true)).evidence) },
    restoreIsolated(input: Location & { bundle: Location }): Promise<Result> {
      return result(async () => {
        const verified = await verify(input.bundle, true)
        safeParent(input)
        const entries = [verified.manifest.database, verified.manifest.metadata, ...verified.manifest.bodies]
        capacity(input.parent, entries.reduce((sum, entry) => sum + entry.bytes, 0) + Buffer.byteLength(verified.manifestText) + policy.markerBytes)
        const directory = exclusiveDirectory(input)
        const origin = safeDirectory(input.bundle)
        for (const entry of entries) {
          capacity(input.parent, entry.bytes)
          const fd = openRegular(join(origin, entry.name))
          await pipeline(createReadStream('', { fd, autoClose: true }), createWriteStream(join(directory, entry.name), { flags: 'wx', mode: policy.fileMode }))
        }
        writeExclusive(join(directory, policy.manifestName), verified.manifestText)
        const restored = await verify(input, false)
        capacity(input.parent, policy.markerBytes)
        writeExclusive(join(directory, policy.markerName), JSON.stringify({ manifestHash: snapshotHash(verified.manifestText) }))
        return restored.evidence
      })
    }
  }
}

function safeParent(location: Location): string {
  if (!location || typeof location.parent !== 'string' || typeof location.name !== 'string' ||
    !calendarBackupPolicy.targetNamePattern.test(location.name) || resolve(location.parent) !== location.parent ||
    realpathSync(location.parent) !== location.parent || !lstatSync(location.parent).isDirectory()) snapshotReject('path-invalid')
  return join(location.parent, location.name)
}
function exclusiveDirectory(location: Location): string {
  const path = safeParent(location)
  try { mkdirSync(path, { mode: calendarBackupPolicy.directoryMode }) } catch { snapshotReject('path-invalid') }
  return path
}
function safeDirectory(location: Location): string {
  const path = safeParent(location)
  if (!lstatSync(path).isDirectory() || realpathSync(path) !== path) snapshotReject('path-invalid')
  if (exists(`${path}/${calendarBackupPolicy.databaseName}-wal`) || exists(`${path}/${calendarBackupPolicy.databaseName}-shm`)) snapshotReject('bundle-invalid')
  return path
}
function openRegular(path: string): number {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  if (!fstatSync(fd).isFile()) { closeSync(fd); snapshotReject('path-invalid') }
  return fd
}
function readBounded(path: string, limit: number): string {
  const fd = openRegular(path)
  try {
    if (fstatSync(fd).size > limit) snapshotReject('capacity')
    return readFileSync(fd, 'utf8')
  } finally { closeSync(fd) }
}
async function fileEntry(directory: string, name: string): Promise<FileEntry> {
  const fd = openRegular(join(directory, name)); const hash = createHash('sha256'); let bytes = 0
  for await (const chunk of createReadStream('', { fd, autoClose: true })) { hash.update(chunk); bytes += chunk.length }
  return { name, bytes, hash: hash.digest('hex') }
}
function validateEntry(entry: FileEntry, name: string) {
  if (!entry || entry.name !== name || !/^[a-f0-9]{64}$/.test(entry.hash) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) snapshotReject('bundle-invalid')
}
function writeExclusive(path: string, body: string) {
  writeFileSync(path, body, { encoding: 'utf8', flag: 'wx', mode: calendarBackupPolicy.fileMode })
}
async function scan(directory: string, reader: EvidenceReader, consume: (record: RawIntelligenceRecord, body: string) => Promise<void>): Promise<SnapshotEvidence> {
  const path = join(directory, calendarBackupPolicy.databaseName)
  const fd = openRegular(path); closeSync(fd)
  const database = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true })
  try { return await collectSnapshotEvidence(database, reader, consume) } finally { database.close() }
}
function exists(path: string): boolean {
  try { lstatSync(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    snapshotReject('path-invalid')
  }
}
