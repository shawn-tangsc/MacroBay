import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createMacroMarketStore, type MacroMarketStore } from './macroMarketStore'
import { barRetentionCutoffs } from '../retention/barRetention'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

const openStore = (): MacroMarketStore => {
  const directory = mkdtempSync(join(tmpdir(), 'macro-retention-')); directories.push(directory)
  return createMacroMarketStore(join(directory, 'macro-market.sqlite'))
}

const hour = 3_600_000
const fiveMinute = 5 * 60_000
const nowMs = Date.UTC(2026, 9, 15, 12, 0, 0)
/** Ten days back at noon: inside the cold window, on the hour, and framed by five finer bars. */
const coldHourMs = nowMs - 10 * 24 * hour

describe('macro-market bar retention', () => {
  it('folds five-minute bars into the hour, drops the far past, and never touches the newest eight days', () => {
    const store = openStore()
    store.append([
      { series: 'dxy-real', atMs: nowMs - 5 * fiveMinute, value: 102, observedAtMs: nowMs },
      { series: 'dxy-real', atMs: coldHourMs, value: 103, observedAtMs: nowMs },
      ...[1, 2, 3, 4, 5].map(n => ({ series: 'dxy-real', atMs: coldHourMs + n * fiveMinute, value: 103 + n, observedAtMs: nowMs })),
      { series: 'dxy-real', atMs: nowMs - 40 * 24 * hour, value: 90, observedAtMs: nowMs }
    ])

    const result = store.retention(barRetentionCutoffs(nowMs))

    // Five of the hour's bars fold away; its own close is what the cold tier promises it keeps.
    expect(result).toEqual({ thinned: 5, deleted: 1, oldestKeptAtMs: coldHourMs })
    expect(store.count('dxy-real')).toBe(2)
    // The hot window is untouched, which is the invariant the seven-day return depends on.
    expect(store.latest('dxy-real')).toEqual({ atMs: nowMs - 5 * fiveMinute, value: 102 })
    expect(store.earliest('dxy-real')).toEqual({ atMs: coldHourMs, value: 103 })
    // Idempotent: a second pass finds nothing to fold and nothing to drop.
    expect(store.retention(barRetentionCutoffs(nowMs))).toEqual({ thinned: 0, deleted: 0, oldestKeptAtMs: coldHourMs })
    store.close()
  })

  it('leaves a series with no old bars exactly as it found it', () => {
    const store = openStore()
    store.append([{ series: 'xau-usd', atMs: nowMs - fiveMinute, value: 4150, observedAtMs: nowMs }])
    expect(store.retention(barRetentionCutoffs(nowMs))).toEqual({ thinned: 0, deleted: 0, oldestKeptAtMs: nowMs - fiveMinute })
    store.close()
  })
})
