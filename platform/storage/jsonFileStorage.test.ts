import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import {
  createJsonFileStorage,
  quarantineCorruptFile,
  recoverJsonArray,
  writeJsonFileAtomically
} from './jsonFileStorage'

describe('json file storage', () => {
  it('returns fallback data when the file does not exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-storage-'))
    const storage = createJsonFileStorage(join(directory, 'missing.json'), { value: 'fallback' })

    await expect(storage.read()).resolves.toEqual({ value: 'fallback' })

    await rm(directory, { recursive: true, force: true })
  })

  it('creates parent directories and reads back written data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-storage-'))
    const storage = createJsonFileStorage(join(directory, 'nested', 'settings.json'), {})

    await storage.write({ value: 'saved' })
    await expect(storage.read()).resolves.toEqual({ value: 'saved' })

    await rm(directory, { recursive: true, force: true })
  })

  it('replaces a longer file without leaving the previous tail behind', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-storage-'))
    const file = join(directory, 'state.json')
    await writeFile(file, JSON.stringify({ values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }), 'utf8')

    await writeJsonFileAtomically(file, { values: [1] })

    await expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ values: [1] })
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])

    await rm(directory, { recursive: true, force: true })
  })

  it('recovers the array from a file that has a second fragment after it', async () => {
    const raw = '[\n  {\n    "id": 1\n  }\n]\n\n  }\n]\n'

    expect(recoverJsonArray(raw)).toEqual([{ id: 1 }])
    expect(recoverJsonArray('{ not json')).toBeNull()
  })

  it('keeps a timestamped copy of a corrupt file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-storage-'))
    const file = join(directory, 'state.json')

    await quarantineCorruptFile(file, '{ broken')

    const copies = (await readdir(directory)).filter((name) => name.startsWith('state.json.corrupt-'))
    expect(copies).toHaveLength(1)
    await expect(readFile(join(directory, copies[0]), 'utf8')).resolves.toBe('{ broken')

    await rm(directory, { recursive: true, force: true })
  })
})
