import { createHash, randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ARCHIVE_FILE_PATTERN = /^[a-f0-9]{64}\.json\.gz$/
const TEMP_FILE_PATTERN = /^\.[a-f0-9]{64}\.[a-f0-9-]+\.tmp$/

export type MarketAnalysisStorageSnapshot = Readonly<{
  write: (input: Readonly<{ body: string; schemaVersion: number; createdAt: string }>) => Readonly<{ archiveRef: string; sha256: string; bytes: number; schemaVersion: number }>
  read: (archiveRef: string) => string | undefined
  recover: () => Readonly<{ orphanArchives: number }>
}>

export function createMarketAnalysisStorageSnapshot(input: Readonly<{ archiveDirectory: string; failBeforeRename?: boolean }>): MarketAnalysisStorageSnapshot {
  mkdirSync(input.archiveDirectory, { recursive: true })
  return Object.freeze({
    write(value) {
      if (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1 || typeof value.body !== 'string' || typeof value.createdAt !== 'string') throw new Error('analysis-archive-invalid-input')
      const sha256 = createHash('sha256').update(value.body, 'utf8').digest('hex')
      const archiveRef = `${sha256}.json.gz`
      const finalPath = join(input.archiveDirectory, archiveRef)
      if (existsSync(finalPath)) {
        if (read(archiveRef) !== value.body) throw new Error('analysis-archive-hash-mismatch')
        return { archiveRef, sha256, bytes: readFileSync(finalPath).byteLength, schemaVersion: value.schemaVersion }
      }
      const temporaryPath = join(input.archiveDirectory, `.${sha256}.${randomUUID()}.tmp`)
      const envelope = JSON.stringify({ schemaVersion: value.schemaVersion, createdAt: value.createdAt, sha256, body: value.body })
      const compressed = gzipSync(Buffer.from(envelope, 'utf8'))
      try {
        writeFileSync(temporaryPath, compressed, { flag: 'wx', mode: 0o600 })
        const descriptor = openSync(temporaryPath, 'r')
        try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
        if (input.failBeforeRename) throw new Error('analysis-archive-interrupted')
        renameSync(temporaryPath, finalPath)
        return { archiveRef, sha256, bytes: compressed.byteLength, schemaVersion: value.schemaVersion }
      } catch (error) {
        if (!input.failBeforeRename) rmSync(temporaryPath, { force: true })
        throw error
      }
    },
    read(archiveRef) {
      if (!ARCHIVE_FILE_PATTERN.test(archiveRef)) return undefined
      try {
        const envelope = JSON.parse(gunzipSync(readFileSync(join(input.archiveDirectory, archiveRef))).toString('utf8')) as { schemaVersion?: unknown; createdAt?: unknown; sha256?: unknown; body?: unknown }
        if (!Number.isSafeInteger(envelope.schemaVersion) || typeof envelope.createdAt !== 'string' || typeof envelope.sha256 !== 'string' || typeof envelope.body !== 'string') return undefined
        const body = envelope.body
        const expected = archiveRef.slice(0, 64)
        return envelope.sha256 === expected && createHash('sha256').update(body, 'utf8').digest('hex') === expected ? body : undefined
      } catch {
        return undefined
      }
    },
    recover() {
      for (const name of readdirSync(input.archiveDirectory)) {
        if (!TEMP_FILE_PATTERN.test(name)) continue
        rmSync(join(input.archiveDirectory, name), { force: true })
      }
      return { orphanArchives: readdirSync(input.archiveDirectory).filter(name => TEMP_FILE_PATTERN.test(name)).length }
    }
  })
}
