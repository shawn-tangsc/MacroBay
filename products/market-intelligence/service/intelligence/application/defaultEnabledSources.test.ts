import { describe, expect, it } from 'vitest'

import { sourceRequiresCredential } from '../schema/intelligenceSource'
import { DEFAULT_ENABLED_SOURCE_IDS, seedDefaultEnabledSources } from './defaultEnabledSources'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import { blocksProductionCollection } from './sourceRuntimeConfig'

describe('default enabled sources', () => {
  it('opens the two dashboard cards and the news feeds on a fresh install', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())

    await seedDefaultEnabledSources(store)

    const enabledIds = (await store.listProfiles())
      .filter((profile) => profile.enabled)
      .map((profile) => profile.sourceId)
      .sort()
    expect(enabledIds).toEqual([...DEFAULT_ENABLED_SOURCE_IDS].sort())
    for (const sourceId of ['alternative-fear-greed', 'defillama-stablecoins']) {
      await expect(store.resolveProfile(sourceId)).resolves.toMatchObject({ sourceId, enabled: true })
    }
  })

  it('keeps a source the reader switched off', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())
    await store.saveProfile({ sourceId: 'alternative-fear-greed', enabled: false })

    await seedDefaultEnabledSources(store)

    await expect(store.resolveProfile('alternative-fear-greed')).resolves.toMatchObject({ enabled: false })
  })

  it('is idempotent across restarts', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())

    await seedDefaultEnabledSources(store)
    await seedDefaultEnabledSources(store)

    expect(await store.listProfiles()).toHaveLength(DEFAULT_ENABLED_SOURCE_IDS.length)
  })

  it('names only live, credential-free sources the catalog knows', () => {
    for (const sourceId of DEFAULT_ENABLED_SOURCE_IDS) {
      const definition = getIntelligenceSourceDefinition(sourceId)
      if (!definition) throw new Error(`Unknown intelligence source "${sourceId}".`)
      expect(definition.readiness).toBe('live')
      expect(sourceRequiresCredential(definition.authMode)).toBe(false)
      expect(blocksProductionCollection(definition)).toBe(false)
    }
  })
})
