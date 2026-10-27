import { describe, expect, it } from 'vitest'

import { DEFAULT_ENABLED_SOURCE_IDS, seedDefaultEnabledSources } from './defaultEnabledSources'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'

describe('default enabled sources', () => {
  it('opens no sources on a fresh install; demo mode supplies the first screen', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())

    await seedDefaultEnabledSources(store)

    expect(DEFAULT_ENABLED_SOURCE_IDS).toEqual([])
    expect(await store.listProfiles()).toEqual([])
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

    expect(await store.listProfiles()).toHaveLength(0)
  })
})
