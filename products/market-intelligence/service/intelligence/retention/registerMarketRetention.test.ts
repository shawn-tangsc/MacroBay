import { describe, expect, it, vi } from 'vitest'

import { MARKET_HISTORY_RETENTION_JOB_ID } from './marketHistoryRetentionJob'
import { logRetentionStoreSkip, registerMarketRetention, type RetentionStoreSkip } from './registerMarketRetention'

/**
 * 这一组钉的是「缺一站不等于整跑不注册」：跨资产库打不开时，宏观/舆情/分析/原始记录照剪，
 * 而且缺的那一站必须留一行「哪个没剪、为什么」——静默跳过等于回到 0.4.5「记录只增不减」那个病。
 */
function harness(options: { withCrossAsset?: boolean; withRawRecords?: boolean } = {}) {
  const handlers = new Map<string, () => Promise<unknown>>()
  const called: string[] = []
  const barStore = { retention: () => { called.push('bar'); return { thinned: 0, deleted: 0, oldestKeptAtMs: null } }, note: () => undefined }
  const newsStore = { purgeBefore: () => { called.push('news'); return { documents: 2, sentiments: 1, capped: false } } }
  const analysisRepository = {
    retention: () => { called.push('analysis'); return { deleted: 0, ledgerDeleted: 0, triggerLedgerDeleted: 0, oldestKeptAtMs: null } },
    note: () => undefined,
    analysisIo: { retention: () => ({ deleted: 0, oldestKeptAtMs: null }) }
  }
  const rawRecordStore = {
    pruneRawRecords: () => {
      called.push('raw')
      return { cutoff: 'c', removedRecords: 0, removedPayloadFiles: 0, removedOrphanFiles: 0, reclaimedPayloadBytes: 0, remainingRecords: 0 }
    }
  }
  const skips = registerMarketRetention({
    jobRuntime: {
      registerHandler: (id: string, handler: () => Promise<unknown>) => { handlers.set(id, handler) },
      setSchedule: () => undefined,
      enqueueDefinition: async () => ({ id: 'run-1' })
    } as never,
    macroStore: barStore,
    ...(options.withCrossAsset ? { crossAssetStore: barStore } : {}),
    analysisRepository: analysisRepository as never,
    newsStore,
    ...(options.withRawRecords === false ? {} : { rawRecordStore }),
    ...(options.withCrossAsset ? {} : { skipReasons: { crossAsset: 'cross-asset-store-unavailable' } })
  })
  return { handlers, called, skips, run: () => handlers.get(MARKET_HISTORY_RETENTION_JOB_ID)!() }
}

describe('registering the daily retention pass', () => {
  it('runs every other store when the cross-asset database never opened', async () => {
    const fixture = harness()

    await fixture.run()

    // 四站都跑到了：缺一站不是「整跑不注册」。
    expect([...new Set(fixture.called)].sort()).toEqual(['analysis', 'bar', 'news', 'raw'])
    // 缺的那一站有一行、带原因——不是静默少一个 store id。
    expect(fixture.skips).toEqual([{ store: 'crossAsset', reason: 'cross-asset-store-unavailable' }])
  })

  it('gives a missing store a default reason instead of passing it over', () => {
    const fixture = harness({ withCrossAsset: true, withRawRecords: false })
    expect(fixture.skips).toEqual([{ store: 'rawRecords', reason: 'store-unavailable' }])
  })

  it('reports each skip once, through the injected collector', () => {
    const reported: RetentionStoreSkip[] = []
    const barStore = { retention: () => ({ thinned: 0, deleted: 0, oldestKeptAtMs: null }), note: () => undefined }
    const skips = registerMarketRetention({
      jobRuntime: { registerHandler: () => undefined, setSchedule: () => undefined, enqueueDefinition: async () => ({ id: 'run-1' }) } as never,
      macroStore: barStore,
      analysisRepository: {
        retention: () => ({ deleted: 0, ledgerDeleted: 0, triggerLedgerDeleted: 0, oldestKeptAtMs: null }),
        note: () => undefined,
        analysisIo: { retention: () => ({ deleted: 0, oldestKeptAtMs: null }) }
      } as never,
      reportSkip: (skip) => reported.push(skip)
    })

    expect(reported).toEqual(skips)
    expect(skips.map((skip) => skip.store).sort()).toEqual(['crossAsset', 'news', 'rawRecords'])
  })

  it('writes the skip as one marker line with the store and the reason', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    logRetentionStoreSkip({ store: 'crossAsset', reason: 'cross-asset-store-unavailable' })
    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      marker: 'RETENTION_STORE_SKIPPED', store: 'crossAsset', reason: 'cross-asset-store-unavailable'
    })
    log.mockRestore()
  })
})