import { describe, expect, it } from 'vitest'

import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'

describe('source profile store calendar feeds', () => {
  it('persists an official calendar switch even though it has no collector definition', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())
    await store.saveProfile({ sourceId: 'macro-calendar-fed', enabled: true })
    const profiles = await store.listProfiles()
    expect(profiles.find((profile) => profile.sourceId === 'macro-calendar-fed')?.enabled).toBe(true)
  })
})
