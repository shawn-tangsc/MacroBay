import { describe, expect, it } from 'vitest'

import { settingsView } from './sourceProjection'

/**
 * 采集节奏归谁：官方日历源（`macro-calendar-fed` / `-bea` / `-bls`）在目录（`sourceCatalog`）里
 * **没有条目**（它们是 registry-only 的 feed），但节奏由产品自己的日历作业决定——投影必须给出
 * `collectionOwner: 'product'`，否则界面会画一个改完不生效的频率下拉
 * （用户 2026-11-12：「这个采集频率怎么还动不了」）。
 *
 * 反向：通用适配器采集的源（币安合约持仓）**不能**被误判成 product，否则它的下拉就消失了。
 */
function sourcesOf(): ReadonlyArray<{ sourceId: string; kind: string; collectionOwner?: string }> {
  const view = settingsView({ enabledById: {} })
  return view.groups.flatMap((group) => group.providers).flatMap((provider) => provider.sources)
}

describe('官方日历源的采集节奏归产品', () => {
  it('marks every official calendar feed as product-owned', () => {
    const byId = new Map(sourcesOf().map((source) => [source.sourceId, source]))
    for (const sourceId of ['macro-calendar-fed', 'macro-calendar-bea', 'macro-calendar-bls']) {
      expect(byId.get(sourceId)?.kind, sourceId).toBe('official-calendar')
      expect(byId.get(sourceId)?.collectionOwner, sourceId).toBe('product')
    }
  })

  it('leaves a generic adapter source writable', () => {
    const byId = new Map(sourcesOf().map((source) => [source.sourceId, source]))
    expect(byId.get('binance-futures-positioning')?.collectionOwner).toBeUndefined()
  })
})
