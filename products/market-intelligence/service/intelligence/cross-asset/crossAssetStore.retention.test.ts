import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

import { createCrossAssetStore } from './crossAssetStore'
import { barRetentionCutoffs } from '../retention/barRetention'

/**
 * The cross-asset store keeps two tables — a version row per observation and a current pointer per
 * symbol and instant — and a retention pass that touched one without the other would leave a pointer to
 * a bar that no longer exists. That is the failure this file is written against: the panel would not
 * report it, it would simply draw one bar fewer.
 */
const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

const STEP = 300_000
const hour = 3_600_000
const nowMs = Date.UTC(2026, 9, 15, 12, 0, 0)
const coldHourMs = nowMs - 10 * 24 * hour
const bar = (barOpenMs: number, close = '100') => ({
  symbol: 'BTCUSDT', barOpenMs, barEndMs: barOpenMs + STEP, open: close, high: close, low: close, close, volume: '1'
})

function open() {
  const directory = mkdtempSync(join(tmpdir(), 'cross-asset-retention-')); directories.push(directory)
  const filePath = join(directory, 'cross-asset-market.sqlite')
  return { filePath, store: createCrossAssetStore(filePath) }
}

const danglingPointers = (filePath: string): number => {
  const db = new DatabaseSync(filePath)
  try {
    const row = db.prepare(`SELECT count(*) AS n FROM cross_asset_bar_current c
      LEFT JOIN cross_asset_bar_versions v ON v.version_id = c.version_id WHERE v.version_id IS NULL`).get()
    return Number(row?.n ?? -1)
  } finally { db.close() }
}

describe('cross-asset bar retention', () => {
  it('folds the cold window to its hours and drops the far past, leaving no pointer behind', () => {
    const { filePath, store } = open()
    const hot = nowMs - STEP
    store.append({
      bars: [bar(hot), bar(coldHourMs, '103'), ...[1, 2, 3, 4, 5].map(n => bar(coldHourMs + n * STEP, `10${n}`)), bar(nowMs - 40 * 24 * hour, '90')],
      observedAtMs: nowMs, origin: 'rest'
    })

    const result = store.retention(barRetentionCutoffs(nowMs))

    expect(result).toEqual({ thinned: 5, deleted: 1, oldestKeptAtMs: coldHourMs })
    // Both tables moved together: the pointers that went are the ones whose version rows went.
    expect(danglingPointers(filePath)).toBe(0)
    // The hot window is untouched, and the cold hour keeps the bar that opened on the hour.
    expect(store.queryAt({ symbol: 'BTCUSDT', fromMs: hot, toMs: hot, asOfMs: nowMs })).toHaveLength(1)
    expect(store.queryAt({ symbol: 'BTCUSDT', fromMs: coldHourMs, toMs: coldHourMs + 25 * 60_000, asOfMs: nowMs }).map(entry => entry.barOpenMs))
      .toEqual([coldHourMs])
    // Idempotent: nothing left to fold, nothing left to drop, and still no dangling pointer.
    expect(store.retention(barRetentionCutoffs(nowMs))).toEqual({ thinned: 0, deleted: 0, oldestKeptAtMs: coldHourMs })
    expect(danglingPointers(filePath)).toBe(0)
    store.close()
  })

  it('reports the oldest surviving bar per series without touching the newest eight days', () => {
    const { store } = open()
    store.append({ bars: [bar(nowMs - STEP)], observedAtMs: nowMs, origin: 'ws' })
    expect(store.retention(barRetentionCutoffs(nowMs))).toEqual({ thinned: 0, deleted: 0, oldestKeptAtMs: nowMs - STEP })
    store.close()
  })
})
