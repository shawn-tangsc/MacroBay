import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createInMemoryNewsSentimentSettingsStorage,
  createNewsSentimentSettingsJsonStorage,
  createNewsSentimentSettingsStore
} from './newsSentimentSettingsStore'

describe('newsSentimentSettingsStore', () => {
  it('persists a patch and keeps the half-bound guard', async () => {
    const store = createNewsSentimentSettingsStore(
      createInMemoryNewsSentimentSettingsStorage(),
      () => '2026-10-24T13:00:00.000Z'
    )
    await store.save({ providerId: 'p', modelId: 'm' })
    expect(await store.getSettings()).toMatchObject({ providerId: 'p', modelId: 'm' })
    await expect(store.save({ providerId: 'p2', modelId: '' })).rejects.toThrow()
  })

  it('falls back to defaults for a missing or corrupt file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'news-sentiment-settings-'))
    try {
      const file = join(dir, 'settings.json')
      const storage = createNewsSentimentSettingsJsonStorage(file)
      expect(await storage.read()).toBeUndefined()

      await writeFile(file, '{not json', 'utf8')
      expect(await storage.read()).toBeUndefined()

      await storage.write({
        modelScoringEnabled: false,
        providerId: '',
        modelId: '',
        updatedAt: '2026-10-24T13:00:00.000Z'
      })
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ modelScoringEnabled: false })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
