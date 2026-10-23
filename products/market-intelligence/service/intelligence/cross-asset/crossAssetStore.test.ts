import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { createCrossAssetStore, crossAssetStoragePolicy } from './crossAssetStore'

const open = Date.parse('2026-09-14T08:00:00.000Z')
const nine = Date.parse('2026-09-14T09:00:00.000Z')
const ten = nine + 3_600_000
const bar = (close = '100', offset = 0) => ({ symbol: 'QQQUSDT' as const, barOpenMs: open + offset,
  barEndMs: open + offset + 300_000, open: '100', high: '110', low: '90', close, volume: '1' })
const setup = () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ca1-store-')), crossAssetStoragePolicy.fileName)
  return { path, store: createCrossAssetStore(path) }
}
const query = (asOfMs: number) => ({ symbol: 'QQQUSDT' as const, fromMs: open, toMs: open + 600_000, asOfMs })

describe('cross-asset append-only closed bar store', () => {
  it('stops at 500k versions without discarding history and still allows a same-value no-op', () => {
    const { store: initial, path } = setup()
    initial.close()
    const db = new DatabaseSync(path)
    db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<499999)
      INSERT INTO cross_asset_bar_versions(symbol,bar_open_ms,observed_at_ms,open,high,low,close,volume,origin)
      SELECT 'BTCUSDT',${open},${nine},'100','110','90','100','1','rest' FROM n;
      INSERT INTO cross_asset_bar_current VALUES('BTCUSDT',${open},499999);`)
    db.close()
    const store = createCrossAssetStore(path)
    try {
      expect(store.append({ bars: [bar()], observedAtMs: nine, origin: 'rest' }).state).toBe('updated')
      expect(store.append({ bars: [bar('101')], observedAtMs: ten, origin: 'rest' }).state).toBe('limited')
      expect(store.append({ bars: [bar()], observedAtMs: ten, origin: 'ws' }).state).toBe('unchanged')
      expect(store.diagnostics().versionRows).toBe(500_000)
      expect(store.queryAt(query(ten))[0].close).toBe('100')
      expect(store.diagnostics().databaseBytes).toBeLessThanOrEqual(256 * 1024 ** 2)
      const started = performance.now()
      expect(store.queryAt({ ...query(ten), symbol: 'BTCUSDT' })[0].close).toBe('100')
      expect(performance.now() - started).toBeLessThan(100)
    } finally { store.close() }
  })
  it('retains A→B→A, no-ops consecutive equal values, and selects the version known at asOf', () => {
    const { store, path } = setup()
    try {
      expect(store.append({ bars: [bar()], observedAtMs: nine, origin: 'rest' })).toMatchObject({ state: 'updated', added: 1 })
      expect(store.append({ bars: [bar()], observedAtMs: nine + 1, origin: 'ws' })).toMatchObject({ state: 'unchanged', added: 0 })
      expect(store.append({ bars: [bar('101')], observedAtMs: ten, origin: 'rest' })).toMatchObject({ state: 'updated' })
      expect(store.queryAt(query(nine + 1_800_000))).toEqual([expect.objectContaining({ close: '100' })])
      expect(store.queryAt(query(ten + 1_800_000))).toEqual([expect.objectContaining({ close: '101' })])
      expect(store.append({ bars: [bar()], observedAtMs: ten + 3_600_000, origin: 'ws' })).toMatchObject({ state: 'updated' })
      expect(store.diagnostics().versionRows).toBe(3)
      expect(store.queryAt(query(nine - 1))).toEqual([])
    } finally { store.close() }
    const reloaded = createCrossAssetStore(path)
    try { expect(reloaded.queryAt(query(ten + 3_600_000))).toEqual([expect.objectContaining({ close: '100' })]) }
    finally { reloaded.close() }
  })

  it('compares canonical decimals without losing the original stored precision', () => {
    const { store } = setup()
    try {
      store.append({ bars: [bar('100.00')], observedAtMs: nine, origin: 'rest' })
      expect(store.append({ bars: [bar('100')], observedAtMs: ten, origin: 'rest' }).state).toBe('unchanged')
      expect(store.queryAt(query(ten))[0].close).toBe('100.00')
    } finally { store.close() }
  })

  it('rolls back a partial batch when current projection fails', () => {
    const { store, path } = setup()
    const db = new DatabaseSync(path)
    try {
      store.append({ bars: [bar()], observedAtMs: nine, origin: 'rest' })
      db.exec(`CREATE TRIGGER refuse_second BEFORE INSERT ON cross_asset_bar_current
        WHEN NEW.bar_open_ms > ${open} BEGIN SELECT RAISE(ABORT, 'derived test failure'); END`)
      expect(store.append({ bars: [bar('101'), bar('102', 300_000)], observedAtMs: ten, origin: 'ws' }).state).toBe('unavailable')
      expect(store.diagnostics().versionRows).toBe(1)
      expect(store.queryAt(query(ten))[0].close).toBe('100')
    } finally { db.close(); store.close() }
  })

  it('rejects conflicting batch identities and invalid bars before altering history', () => {
    const { store } = setup()
    try {
      for (const bars of [[bar(), bar('101')], [{ ...bar(), symbol: 'DOGEUSDT' }], [bar('0')], [{ ...bar(), barEndMs: open }]]) {
        expect(store.append({ bars, observedAtMs: nine, origin: 'rest' } as never).state).toBe('invalid-input')
      }
      expect(store.diagnostics().versionRows).toBe(0)
    } finally { store.close() }
  })

  it('never makes a new version visible earlier after the local clock moves backwards', () => {
    const { store } = setup()
    try {
      store.append({ bars: [bar()], observedAtMs: ten, origin: 'rest' })
      store.append({ bars: [bar('101')], observedAtMs: nine, origin: 'rest' })
      expect(store.queryAt(query(ten - 1))).toEqual([])
      expect(store.queryAt(query(ten))[0].close).toBe('101')
    } finally { store.close() }
  })

  it('migrates a version-1 file to the widened symbol set without losing a stored row', () => {
    // A version-1 file admitted only the three Binance contracts. The real Nasdaq 100 index needs a
    // wider CHECK, and SQLite cannot drop one — so the tables are rebuilt around the new set, and this
    // test is the guard that the rebuild copies history rather than emptying it.
    const path = join(mkdtempSync(join(tmpdir(), 'ca1-migrate-')), crossAssetStoragePolicy.fileName)
    const legacy = new DatabaseSync(path)
    legacy.exec(`CREATE TABLE cross_asset_bar_versions (
        version_id INTEGER PRIMARY KEY, symbol TEXT NOT NULL CHECK(symbol IN ('QQQUSDT','BTCUSDT','ETHUSDT')),
        bar_open_ms INTEGER NOT NULL CHECK(bar_open_ms >= 0 AND bar_open_ms % 300000 = 0),
        observed_at_ms INTEGER NOT NULL, open TEXT NOT NULL, high TEXT NOT NULL, low TEXT NOT NULL,
        close TEXT NOT NULL, volume TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('rest','ws')));
      CREATE INDEX IF NOT EXISTS cross_asset_bar_lookup ON cross_asset_bar_versions(symbol,bar_open_ms,observed_at_ms DESC,version_id DESC);
      CREATE TABLE cross_asset_bar_current (symbol TEXT NOT NULL, bar_open_ms INTEGER NOT NULL,
        version_id INTEGER NOT NULL REFERENCES cross_asset_bar_versions(version_id), PRIMARY KEY(symbol,bar_open_ms));
      INSERT INTO cross_asset_bar_versions (version_id,symbol,bar_open_ms,observed_at_ms,open,high,low,close,volume,origin)
        VALUES (1, 'QQQUSDT', ${open}, ${nine}, '100', '110', '90', '100', '1', 'rest');
      INSERT INTO cross_asset_bar_current VALUES ('QQQUSDT', ${open}, 1);
      PRAGMA user_version=1;`)
    legacy.close()

    const store = createCrossAssetStore(path)
    try {
      expect(store.queryAt(query(ten))).toEqual([expect.objectContaining({ symbol: 'QQQUSDT', close: '100' })])
      // The widened set is what makes the new leg storable, and it is the real index's own symbol.
      const indexBar = { ...bar('25234.5'), symbol: 'USTEC' as const, open: '25230', high: '25250', low: '25220' }
      expect(store.append({ bars: [indexBar], observedAtMs: ten, origin: 'rest' }))
        .toMatchObject({ state: 'updated', added: 1 })
      expect(store.queryAt({ ...query(ten), symbol: 'USTEC' })[0].close).toBe('25234.5')
    } finally { store.close() }
    const reopened = new DatabaseSync(path)
    try {
      expect(Number(reopened.prepare('PRAGMA user_version').get()?.user_version)).toBe(crossAssetStoragePolicy.schemaVersion)
      expect(reopened.prepare("select sql from sqlite_master where name='cross_asset_bar_versions'").get()?.sql).toContain("'USTEC'")
    } finally { reopened.close() }
  })

  it('rejects unbounded queries and writes of not-yet-closed bars', () => {
    const { store } = setup()
    try {
      expect(store.append({ bars: [bar()], observedAtMs: open, origin: 'rest' }).state).toBe('invalid-input')
      expect(() => store.queryAt({ ...query(ten), fromMs: 0 })).toThrow('invalid-query')
      expect(store.diagnostics()).toMatchObject({ versionRows: 0, currentRows: 0, maxVersionRows: 500_000, maxDatabaseBytes: 256 * 1024 ** 2 })
    } finally { store.close() }
  })
})
