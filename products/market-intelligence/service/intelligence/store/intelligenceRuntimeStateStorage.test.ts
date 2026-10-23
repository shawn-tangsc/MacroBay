import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createIntelligencePipeline } from '../application/intelligencePipeline'
import { createInMemoryProfileStorage, createSourceProfileStore } from '../application/sourceProfileStore'
import {
  createIntelligenceRuntimeStateJsonStorage,
  readIntelligenceRuntimeStateSync
} from './intelligenceRuntimeStateStorage'
import {
  createIntelligenceRuntimeStateHistoryJsonStorage,
  readIntelligenceRuntimeStateHistorySync
} from './intelligenceRuntimeStateHistoryStorage'

describe('intelligenceRuntimeStateStorage', () => {
  it('persists collection health across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intelligence-runtime-state-'))
    const filePath = join(dir, 'intelligence-runtime-state.json')
    const historyPath = join(dir, 'intelligence-runtime-state-history.json')
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const runtimeStateStorage = createIntelligenceRuntimeStateJsonStorage(filePath)
    const runtimeStateHistoryStorage = createIntelligenceRuntimeStateHistoryJsonStorage(historyPath)

    try {
      const pipeline = createIntelligencePipeline({
        profileStore,
        runtimeStateStorage,
        runtimeStateHistoryStorage
      })

      await pipeline.collectSource({
        sourceId: 'coindesk-rss',
        runId: 'run-1',
        fixtureText: await readFile(join(__dirname, '../adapters/fixtures/rss-sample.xml'), 'utf8')
      })

      expect(pipeline.getHealth('coindesk-rss').lastSuccessAt).toBeTruthy()

      const historyAfterCollect = readIntelligenceRuntimeStateHistorySync(historyPath)
      expect(historyAfterCollect.some((entry) => entry.resourceId === 'coindesk-rss')).toBe(true)

      const reloaded = createIntelligencePipeline({
        profileStore,
        runtimeStateSnapshot: readIntelligenceRuntimeStateSync(filePath),
        runtimeStateStorage,
        runtimeStateHistorySnapshot: readIntelligenceRuntimeStateHistorySync(historyPath),
        runtimeStateHistoryStorage
      })

      expect(reloaded.getHealth('coindesk-rss').lastSuccessAt).toBeTruthy()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
