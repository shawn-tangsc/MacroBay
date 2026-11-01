import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { createCrossAssetStore, crossAssetStoragePolicy } from './crossAssetStore'

/**
 * The version cap, measured at its real size.
 *
 * 上限是策略里的字面值（500,000 行），不是一个可以调小的旋钮，所以这条用例只能真的写满它：一次约两秒
 * 的批量插入，加上每次打开库都会跑的全量 `PRAGMA quick_check`。
 *
 * 它单独成文件、单独拿 60 秒预算，因为它**不是一条行为用例**：并行跑全量时邻座正在做真实文件容量
 * 探测（同类操作，几十秒量级的 I/O），同一条断言在空载 1.5 秒、抢 I/O 时 3 秒以上，撞上 5 秒默认超时
 * 就是红的。以前它还额外断言"这次查询小于 100ms"——那量的是机器负载而不是存储契约，已随之删掉；
 * 存储契约仍然逐条断：到顶后拒写、历史一根不丢、同值 no-op 仍放行、查询仍能穿过历史取到那一版。
 */
const open = Date.parse('2026-09-14T08:00:00.000Z')
const nine = Date.parse('2026-09-14T09:00:00.000Z')
const ten = nine + 3_600_000
const bar = (close = '100') => ({ symbol: 'QQQUSDT' as const, barOpenMs: open, barEndMs: open + 300_000,
  open: '100', high: '110', low: '90', close, volume: '1' })
const setup = () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ca1-store-capacity-')), crossAssetStoragePolicy.fileName)
  return { path, store: createCrossAssetStore(path) }
}
const query = (asOfMs: number) => ({ symbol: 'QQQUSDT' as const, fromMs: open, toMs: open + 600_000, asOfMs })

describe('cross-asset closed bar store at the version cap', () => {
  it('stops at 500k versions without discarding history and still allows a same-value no-op', { timeout: 60_000 }, () => {
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
      // 到达上限后：一次真实改动被拒（不是丢弃历史），同值写入仍然放行。
      expect(store.append({ bars: [bar()], observedAtMs: nine, origin: 'rest' }).state).toBe('updated')
      expect(store.append({ bars: [bar('101')], observedAtMs: ten, origin: 'rest' }).state).toBe('limited')
      expect(store.append({ bars: [bar()], observedAtMs: ten, origin: 'ws' }).state).toBe('unchanged')
      expect(store.diagnostics().versionRows).toBe(500_000)
      expect(store.queryAt(query(ten))[0].close).toBe('100')
      expect(store.diagnostics().databaseBytes).toBeLessThanOrEqual(256 * 1024 ** 2)
      // 穿过 50 万条历史取同一个版本：这是上面那条 `limited` 没有毁掉历史的证据。
      expect(store.queryAt({ ...query(ten), symbol: 'BTCUSDT' })[0].close).toBe('100')
    } finally { store.close() }
  })
})
