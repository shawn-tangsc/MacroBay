import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { createJsonFileStorage } from './jsonFileStorage'

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
})
