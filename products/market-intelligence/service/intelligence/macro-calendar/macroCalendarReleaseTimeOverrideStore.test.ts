import { describe, expect, it, vi } from 'vitest'

import { createMacroCalendarReleaseTimeOverrideCache, createMacroCalendarReleaseTimeOverrideStore, type MacroCalendarReleaseTimeOverride } from './macroCalendarReleaseTimeOverrideStore'

function memoryStorage(seed: readonly MacroCalendarReleaseTimeOverride[] = []) {
  let rows = [...seed]
  return {
    readAll: vi.fn(async () => [...rows]),
    writeAll: vi.fn(async (next: MacroCalendarReleaseTimeOverride[]) => { rows = [...next] }),
    rows: () => rows
  }
}

const good = { eventKey: 'US.CORE_CPI.RELEASE.2026-M09', scheduledDate: '2026-10-14', scheduledAt: '2026-10-14T12:30:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z' }

describe('macro calendar release time override store', () => {
  it('keeps the reader edit as a canonical instant with the date they actually chose', async () => {
    const storage = memoryStorage()
    const store = createMacroCalendarReleaseTimeOverrideStore(storage)
    const saved = await store.set(good)
    expect(saved).toEqual(good)
    expect(await store.get(good.eventKey)).toEqual(good)
    expect(storage.writeAll).toHaveBeenCalledTimes(1)
    // The chosen date is stored, not recomputed from the instant: the reader's day is theirs.
    expect(storage.rows()[0]?.scheduledDate).toBe('2026-10-14')
  })

  it('refuses an edit whose text is not a real instant, or whose date contradicts it', async () => {
    const storage = memoryStorage()
    const store = createMacroCalendarReleaseTimeOverrideStore(storage)
    for (const bad of [
      { ...good, scheduledAt: '2026-10-14T12:30:00Z' },        // not canonical
      { ...good, scheduledAt: '2026-10-14 12:30' },            // not an instant at all
      { ...good, scheduledAt: '2026-02-30T12:30:00.000Z' },    // not a real date
      { ...good, scheduledDate: '2026-10-13' },                // date disagrees with the instant
      { ...good, scheduledDate: '14/10/2026' },                // not a date
      { ...good, updatedAt: 'yesterday' },
      { ...good, eventKey: '' },
      { ...good, eventKey: 'x'.repeat(200) }
    ]) {
      expect(await store.set(bad), JSON.stringify(bad)).toBeUndefined()
    }
    expect(storage.writeAll).not.toHaveBeenCalled()
    expect(await store.list()).toEqual([])
  })

  it('replaces an existing edit for the same event instead of stacking duplicates', async () => {
    const storage = memoryStorage()
    const store = createMacroCalendarReleaseTimeOverrideStore(storage)
    await store.set(good)
    const moved = { ...good, scheduledDate: '2026-10-15', scheduledAt: '2026-10-15T12:30:00.000Z', updatedAt: '2026-10-15T01:00:00.000Z' }
    await store.set(moved)
    expect(await store.list()).toEqual([moved])
  })

  it('lets an edit be dropped, so the official time or the convention shows again', async () => {
    const storage = memoryStorage()
    const store = createMacroCalendarReleaseTimeOverrideStore(storage)
    await store.set(good)
    expect(await store.clear(good.eventKey)).toBe(true)
    expect(await store.get(good.eventKey)).toBeUndefined()
    // Idempotent: clearing something nobody edited is not an error and writes nothing new.
    const writes = storage.writeAll.mock.calls.length
    expect(await store.clear(good.eventKey)).toBe(false)
    expect(storage.writeAll.mock.calls.length).toBe(writes)
  })

  it('drops rows already on disk that are not well formed, rather than trusting the file', async () => {
    const storage = memoryStorage([
      good,
      { ...good, eventKey: 'broken', scheduledAt: 'nonsense' } as MacroCalendarReleaseTimeOverride,
      { ...good, eventKey: 'contradictory', scheduledDate: '2026-10-13' } as MacroCalendarReleaseTimeOverride
    ])
    const store = createMacroCalendarReleaseTimeOverrideStore(storage)
    expect((await store.list()).map((entry) => entry.eventKey)).toEqual([good.eventKey])
  })
})

describe('the synchronous view a calendar query reads', () => {
  it('seeds from the store once, then answers without touching disk', async () => {
    const storage = memoryStorage([good])
    const store = createMacroCalendarReleaseTimeOverrideStore(storage)
    const cache = createMacroCalendarReleaseTimeOverrideCache(store)
    expect(cache.get(good.eventKey)).toBeUndefined()
    expect(await cache.refresh()).toBe(true)
    expect(cache.get(good.eventKey)).toEqual({ scheduledAt: good.scheduledAt, scheduledDate: good.scheduledDate })
    const reads = storage.readAll.mock.calls.length
    await cache.refresh()
    expect(storage.readAll.mock.calls.length).toBe(reads)
  })

  it('keeps the previous view when the read fails, rather than silently forgetting an edit', async () => {
    const storage = memoryStorage([good])
    storage.readAll.mockRejectedValueOnce(new Error('disk gone'))
    const cache = createMacroCalendarReleaseTimeOverrideCache(createMacroCalendarReleaseTimeOverrideStore(storage))
    expect(await cache.refresh()).toBe(false)
    expect(cache.get(good.eventKey)).toBeUndefined()
  })

  it('shows a write immediately and forgets a cleared edit', async () => {
    const storage = memoryStorage()
    const store = createMacroCalendarReleaseTimeOverrideStore(storage)
    const cache = createMacroCalendarReleaseTimeOverrideCache(store)
    const saved = await store.set(good)
    cache.apply(saved!)
    expect(cache.get(good.eventKey)?.scheduledDate).toBe('2026-10-14')
    cache.remove(good.eventKey)
    expect(cache.get(good.eventKey)).toBeUndefined()
  })
})
