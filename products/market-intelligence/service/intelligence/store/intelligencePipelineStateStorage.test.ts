import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createIntelligencePipeline } from '../application/intelligencePipeline'
import { createInMemoryProfileStorage, createSourceProfileStore } from '../application/sourceProfileStore'
import {
  createInMemoryIntelligencePipelineStateStorage,
  createIntelligencePipelineJsonStorage
} from './intelligencePipelineStateStorage'

describe('intelligencePipelineStateStorage', () => {
  it('persists timeline entities across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intelligence-pipeline-state-'))
    const filePath = join(dir, 'intelligence-pipeline-state.json')
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const stateStorage = createIntelligencePipelineJsonStorage(filePath)

    try {
      const pipeline = createIntelligencePipeline({
        profileStore,
        stateStorage
      })

      await pipeline.collectSource({
        sourceId: 'coindesk-rss',
        runId: 'run-1',
        fixtureText: loadFixture()
      })
      await pipeline.normalizeRawRecords({ sourceId: 'coindesk-rss' })
      await pipeline.assessChangedItems({})

      expect(pipeline.listItems().length).toBeGreaterThan(0)

      const reloaded = createIntelligencePipeline({
        profileStore,
        snapshot: await stateStorage.read(),
        stateStorage
      })

      expect(reloaded.listItems()).toHaveLength(pipeline.listItems().length)
      expect(reloaded.listClusters().length).toBeGreaterThan(0)
      expect(reloaded.listAssessments().length).toBeGreaterThan(0)

      const persisted = await stateStorage.read()
      expect(persisted.items.length).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('supports in-memory storage for tests', async () => {
    const stateStorage = createInMemoryIntelligencePipelineStateStorage()
    const pipeline = createIntelligencePipeline({ stateStorage })
    await pipeline.assessChangedItems({ itemIds: [] })
    expect((await stateStorage.read()).items).toEqual([])
  })
})

function loadFixture(): string {
  return readFileSync(
    join(__dirname, '../adapters/fixtures/rss-sample.xml'),
    'utf8'
  )
}
