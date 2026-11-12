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
function sourcesOf(): ReadonlyArray<{ sourceId: string; kind: string; collection?: string; collectionOwner?: string }> {
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

  /**
   * 2026-11-13 读者复报：0xRouter 那三条日历 feed 仍然画着三档下拉，点下去 `saveProfile`
   * 抛 `Unknown intelligence source`（它们不在目录里），屏上又是弹回原值——「选完什么都没发生」。
   *
   * 所以判据必须读**注册表的 `collection`**，不能只读目录的 `collectionOwner`：
   * `'job'`（产品作业采）与 `'none'`（通用适配器不采）同样没有读取点读 `collectionPreset`。
   */
  it('reads the registry collection too: job/none are product-owned even without a catalog entry', () => {
    const byId = new Map(sourcesOf().map((source) => [source.sourceId, source]))
    for (const sourceId of [
      'macro-calendar-narwhal-economic-data',
      'macro-calendar-narwhal-financial-events',
      'macro-calendar-narwhal-central-bank-activities'
    ]) {
      expect(byId.get(sourceId)?.collection, sourceId).toBe('job')
      expect(byId.get(sourceId)?.collectionOwner, sourceId).toBe('product')
    }
    // `collection: 'none'` 同理：十二数据的宏观市场由产品作业采，通用适配器不采。
    expect(byId.get('twelve-data-market')?.collection).toBe('none')
    expect(byId.get('twelve-data-market')?.collectionOwner).toBe('product')
  })
})
