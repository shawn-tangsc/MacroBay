import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { createMarketAnalysisStorageSnapshot } from './marketAnalysisStorageSnapshot'

describe('marketAnalysisStorageSnapshot', () => {
  it('writes compressed immutable content and verifies its hash on read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mi-analysis-archive-'))
    try {
      const archive = createMarketAnalysisStorageSnapshot({ archiveDirectory: directory })
      const body = JSON.stringify({ schemaVersion: 1, facts: [{ id: 'fact-1', value: 3.2 }] })
      const result = archive.write({ body, schemaVersion: 1, createdAt: '2026-09-25T08:30:00.000Z' })
      expect(result.sha256).toBe(createHash('sha256').update(body).digest('hex'))
      expect(result.bytes).toBeGreaterThan(0)
      expect(archive.read(result.archiveRef)).toBe(body)
      expect(JSON.parse(gunzipSync(await readFile(join(directory, result.archiveRef))).toString('utf8'))).toMatchObject({ schemaVersion: 1, createdAt: '2026-09-25T08:30:00.000Z', sha256: result.sha256, body })
      await writeFile(join(directory, result.archiveRef), 'tampered')
      expect(archive.read(result.archiveRef)).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('cleans interrupted temporary archives and never exposes them as readable content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mi-analysis-archive-'))
    try {
      const archive = createMarketAnalysisStorageSnapshot({ archiveDirectory: directory, failBeforeRename: true })
      expect(() => archive.write({ body: '{"ok":true}', schemaVersion: 1, createdAt: '2026-09-25T08:30:00.000Z' })).toThrow()
      expect((await readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(true)
      const recovered = archive.recover()
      expect(recovered.orphanArchives).toBe(0)
      expect((await readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
