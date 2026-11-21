import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createOptionSkewPointStore } from './optionSkewPointStore'
import type { OptionSkewPoint } from './optionSkewPolicy'

async function tempStore(): Promise<{ store: ReturnType<typeof createOptionSkewPointStore>; filePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'option-skew-'))
  const filePath = join(directory, 'option-skew-points.json')
  return { store: createOptionSkewPointStore({ filePath }), filePath }
}

function point(day: string, riskReversal: number, observedAt = `${day}T05:00:00.000Z`): OptionSkewPoint {
  return {
    day,
    observedAt,
    riskReversal,
    putIv25: 62.7,
    callIv25: 56,
    tenorDays: 30,
    expiries: ['2026-12-17T08:00:00.000Z', '2027-01-01T08:00:00.000Z'],
    underlyingPrice: 90_000
  }
}

describe('option skew point store', () => {
  it('keeps one row per UTC day, the latest one', async () => {
    const { store } = await tempStore()
    await store.load()
    await store.recordPoint(point('2026-11-20', 5.1))
    await store.recordPoint(point('2026-11-20', 6.7))
    const snapshot = store.readSnapshot()
    expect(snapshot.points).toHaveLength(1)
    expect(snapshot.points[0]?.riskReversal).toBe(6.7)
  })

  it('rounds the stored risk reversal to one decimal', async () => {
    const { store } = await tempStore()
    await store.load()
    await store.recordPoint(point('2026-11-20', 6.7499))
    expect(store.readSnapshot().points[0]?.riskReversal).toBe(6.7)
  })

  it('carries the points across a restart', async () => {
    const { store, filePath } = await tempStore()
    await store.load()
    await store.recordPoint(point('2026-11-20', 6.7))
    const reopened = createOptionSkewPointStore({ filePath })
    await reopened.load()
    expect(reopened.readSnapshot().points).toHaveLength(1)
  })

  it('trims to the retention window', async () => {
    const { store } = await tempStore()
    await store.load()
    const newest = Date.parse('2026-11-20T00:00:00.000Z')
    // One point per day for 401 days: the day outside the window is dropped on write.
    for (let offset = 400; offset >= 0; offset -= 1) {
      const day = new Date(newest - offset * 86_400_000).toISOString().slice(0, 10)
      await store.recordPoint(point(day, 1))
    }
    const days = store.readSnapshot().points.map((entry) => entry.day)
    expect(days.length).toBeLessThanOrEqual(400)
    expect(days[0]).toBe('2025-10-17')
    expect(days.at(-1)).toBe('2026-11-20')
  })

  it('leaves the stored days untouched when a round fails', async () => {
    const { store } = await tempStore()
    await store.load()
    await store.recordPoint(point('2026-11-20', 6.7))
    await store.recordFailure({ at: '2026-11-21T07:00:00.000Z', failureCode: 'connection-unavailable' })
    const snapshot = store.readSnapshot()
    expect(snapshot.points).toHaveLength(1)
    expect(snapshot.lastFailureCause).toBe('connection-unavailable')
    expect(store.readState().consecutiveFailures).toBe(1)
  })

  it('drops the failure cause once a round succeeds', async () => {
    const { store } = await tempStore()
    await store.load()
    await store.recordFailure({ at: '2026-11-21T07:00:00.000Z', failureCode: 'upstream-http-error' })
    await store.recordPoint(point('2026-11-22', 6.7))
    expect(store.readSnapshot().lastFailureCause).toBeUndefined()
    expect(store.readState().consecutiveFailures).toBe(0)
  })

  it('reports a corrupt file as unreadable instead of an empty store', async () => {
    const { store, filePath } = await tempStore()
    await writeFile(filePath, '{ not json', 'utf8')
    await store.load()
    expect(() => store.readSnapshot()).toThrow()
  })

  it('writes a document the card can read back', async () => {
    const { store, filePath } = await tempStore()
    await store.load()
    await store.recordPoint(point('2026-11-20', 6.7))
    const document = JSON.parse(await readFile(filePath, 'utf8')) as { schemaVersion: number; points: unknown[] }
    expect(document.schemaVersion).toBe(1)
    expect(document.points).toHaveLength(1)
  })
})