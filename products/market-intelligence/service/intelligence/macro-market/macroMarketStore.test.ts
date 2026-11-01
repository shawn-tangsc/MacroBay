import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createMacroMarketStore, type MacroMarketStore } from './macroMarketStore'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

const openStore = (): MacroMarketStore => {
  const directory = mkdtempSync(join(tmpdir(), 'macro-store-')); directories.push(directory)
  return createMacroMarketStore(join(directory, 'macro-market.sqlite'))
}

const at = (iso: string): number => Date.parse(iso)
const cutoff = at('2026-10-30T00:00:00.000Z')

describe('macro-market store as-of read', () => {
  it('answers the newest point at or before the instant, per series', () => {
    const store = openStore()
    store.append([
      { series: 'dxy-real', atMs: at('2026-10-29T23:50:00.000Z'), value: 100.1, observedAtMs: at('2026-10-29T23:50:05.000Z') },
      { series: 'dxy-real', atMs: at('2026-10-29T23:55:00.000Z'), value: 100.2, observedAtMs: at('2026-10-29T23:55:05.000Z') },
      // Collected after the cutoff, so a projection at the cutoff must not see it.
      { series: 'dxy-real', atMs: at('2026-10-30T12:55:00.000Z'), value: 101.5, observedAtMs: at('2026-10-30T12:55:05.000Z') },
      { series: 'xau-usd', atMs: at('2026-10-29T23:50:00.000Z'), value: 4150.25, observedAtMs: at('2026-10-29T23:50:05.000Z') }
    ])

    expect(store.latestAt('dxy-real', cutoff)).toEqual({ atMs: at('2026-10-29T23:55:00.000Z'), value: 100.2 })
    // Inclusive: a bar stamped exactly on the instant is the bar a reader at that instant knows.
    expect(store.latestAt('dxy-real', at('2026-10-29T23:55:00.000Z'))).toEqual({ atMs: at('2026-10-29T23:55:00.000Z'), value: 100.2 })
    // The series is the boundary, not the store: one series' points never answer another's.
    expect(store.latestAt('xau-usd', cutoff)).toEqual({ atMs: at('2026-10-29T23:50:00.000Z'), value: 4150.25 })
    expect(store.latestAt('dxy-synthetic', cutoff)).toBeUndefined()
    store.close()
  })

  it('answers nothing before the series begins', () => {
    const store = openStore()
    store.append([{ series: 'dxy-real', atMs: at('2026-10-29T23:55:00.000Z'), value: 100.2, observedAtMs: at('2026-10-29T23:55:05.000Z') }])

    expect(store.latestAt('dxy-real', at('2026-10-29T23:54:59.999Z'))).toBeUndefined()
    expect(store.latest('dxy-real')).toEqual({ atMs: at('2026-10-29T23:55:00.000Z'), value: 100.2 })
    store.close()
  })
})
