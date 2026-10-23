import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createIntelligenceTranslationJsonStorage } from './intelligenceTranslationStorage'

const dirs: string[] = []

async function storageWith(raw: string) {
  const dir = await mkdtemp(join(tmpdir(), 'mi-translation-'))
  dirs.push(dir)
  const recordsPath = join(dir, 'records.json')
  await writeFile(recordsPath, raw, 'utf8')
  return { recordsPath, storage: createIntelligenceTranslationJsonStorage({ settingsPath: join(dir, 'settings.json'), recordsPath }) }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('intelligence translation storage', () => {
  it('recovers the first complete array when a trailing fragment was written', async () => {
    const { recordsPath, storage } = await storageWith('[]\n"junk": true\n}\n')
    await expect(storage.readRecords()).resolves.toEqual([])
    expect(JSON.parse(await readFile(recordsPath, 'utf8'))).toEqual([])
  })

  it('writes records atomically', async () => {
    const { recordsPath, storage } = await storageWith('[]')
    await storage.writeRecords([])
    expect(JSON.parse(await readFile(recordsPath, 'utf8'))).toEqual([])
  })
})
