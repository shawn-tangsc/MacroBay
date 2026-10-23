import { describe, expect, it, vi } from 'vitest'

import { createInMemoryProfileStorage, createSourceProfileStore } from '../application/sourceProfileStore'
import { createUnifiedMacroCalendarProfileStore } from './macroCalendarUnifiedProfileStore'

describe('unified macro calendar profile store', () => {
  it('writes an official calendar switch into the shared source profile store', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())
    const unified = createUnifiedMacroCalendarProfileStore(store)
    await unified.save({ providerId: 'macro-calendar-fed', enabled: true })
    const saved = (await store.listProfiles()).find((profile) => profile.sourceId === 'macro-calendar-fed')
    expect(saved?.enabled).toBe(true)
  })

  it('reads the unified switch state over the legacy profile', async () => {
    const legacy = {
      list: vi.fn(async () => [{ providerId: 'macro-calendar-fed', enabled: false } as never]),
      saveCredentialRef: vi.fn(async () => ({ providerId: 'macro-calendar-fed' } as never))
    }
    const store = {
      listProfiles: vi.fn(async () => [{ sourceId: 'macro-calendar-fed', enabled: true } as never]),
      saveProfile: vi.fn(async () => ({ sourceId: 'macro-calendar-fed', enabled: true } as never))
    }
    const unified = createUnifiedMacroCalendarProfileStore(store, legacy)

    const profiles = await unified.list()
    expect(profiles.find((profile) => profile.providerId === 'macro-calendar-fed')?.enabled).toBe(true)
  })

  it('writes the switch to the source profile store', async () => {
    const store = {
      listProfiles: vi.fn(async () => []),
      saveProfile: vi.fn(async () => ({ sourceId: 'macro-calendar-bea', enabled: true, updatedAt: '2026-10-18T00:00:00.000Z' } as never))
    }
    const unified = createUnifiedMacroCalendarProfileStore(store)

    const saved = await unified.save({ providerId: 'macro-calendar-bea', enabled: true })
    expect(store.saveProfile).toHaveBeenCalledWith({ sourceId: 'macro-calendar-bea', enabled: true })
    expect(saved.enabled).toBe(true)
  })
})
