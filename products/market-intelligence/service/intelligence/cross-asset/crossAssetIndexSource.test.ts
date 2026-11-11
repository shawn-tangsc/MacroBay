import { describe, expect, it } from 'vitest'

import { crossAssetIndexHasLiveQuote, crossAssetIndexSymbol, selectCrossAssetIndexSource } from './crossAssetIndexSource'

describe('cross-asset index source selection', () => {
  it('answers from the tokenised perpetual by default, because it streams and never closes', () => {
    expect(selectCrossAssetIndexSource({ liveState: 'live', proxyAvailable: true, realAvailable: true, feedState: 'ready' })).toBe('proxy')
    // A socket that is connecting, briefly stale or rate limited is not a reason to change instrument:
    // the stored bars are still the perpetual's, and flipping on every reconnect would be worse.
    expect(selectCrossAssetIndexSource({ liveState: 'connecting', proxyAvailable: true, realAvailable: true, feedState: 'ready' })).toBe('proxy')
    expect(selectCrossAssetIndexSource({ liveState: 'stale', proxyAvailable: true, realAvailable: true, feedState: 'ready' })).toBe('proxy')
    expect(selectCrossAssetIndexSource({ liveState: 'limited', proxyAvailable: true, realAvailable: true, feedState: 'ready' })).toBe('proxy')
  })

  it('hands the row to the licensed index when the proxy leg cannot answer', () => {
    // The reader switched the source off, or the contract has no stored bar.
    expect(selectCrossAssetIndexSource({ liveState: 'disabled', proxyAvailable: true, realAvailable: true, feedState: 'ready' })).toBe('real')
    expect(selectCrossAssetIndexSource({ liveState: 'live', proxyAvailable: false, realAvailable: true, feedState: 'ready' })).toBe('real')
    // A restart has not attempted a licensed tick yet; its stored history is still the real index.
    expect(selectCrossAssetIndexSource({ liveState: 'disabled', proxyAvailable: false, realAvailable: true, feedState: 'pending' })).toBe('real')
  })

  it('keeps answering from the stored bars while the runtime is reconnecting or a tick failed', () => {
    // Chief 2026-11-11：一次失败的 tick / 一次断线，不许把有库存的腿判死。
    // 代理腿有收盘、运行时正 unavailable → 仍然由代理腿答（不是切到真实指数，更不是未接入）。
    expect(selectCrossAssetIndexSource({ liveState: 'unavailable', proxyAvailable: true, realAvailable: true, feedState: 'ready' })).toBe('proxy')
    // 真实指数有收盘、这一轮 feed 失败 → 仍然由真实指数答。
    expect(selectCrossAssetIndexSource({ liveState: 'unavailable', proxyAvailable: false, realAvailable: true, feedState: 'unavailable' })).toBe('real')
    // 两腿都有收盘、都报失败 → 仍由默认的代理腿答（运行状态只影响状态词）。
    expect(selectCrossAssetIndexSource({ liveState: 'unavailable', proxyAvailable: true, realAvailable: true, feedState: 'unavailable' })).toBe('proxy')
  })

  it('admits no source at all when neither leg can answer', () => {
    expect(selectCrossAssetIndexSource({ liveState: 'unavailable', proxyAvailable: false, realAvailable: false, feedState: 'ready' })).toBe('unavailable')
    expect(selectCrossAssetIndexSource({ liveState: 'live', proxyAvailable: false, realAvailable: false, feedState: 'ready' })).toBe('unavailable')
    // 未接入 只留给「两腿库里都没有收盘」；feed 这一轮失败不再把它算进来（见下一条用例）。
    expect(selectCrossAssetIndexSource({ liveState: 'disabled', proxyAvailable: false, realAvailable: true, feedState: 'unavailable' })).toBe('real')
  })

  it('is decided without a clock, so a closed session can never move the row', () => {
    // The rule takes no instant: the only ways the row changes instrument are the proxy leg's own
    // health and the stored history — never the hour of the day.
    expect(selectCrossAssetIndexSource.length).toBe(1)
    expect(crossAssetIndexSymbol('real')).toBe('USTEC')
    expect(crossAssetIndexSymbol('proxy')).toBe('QQQUSDT')
    expect(crossAssetIndexSymbol('unavailable')).toBeUndefined()
    // Only the proxy trades continuously, so only it may carry a live quote into the row.
    expect(crossAssetIndexHasLiveQuote('proxy')).toBe(true)
    expect(crossAssetIndexHasLiveQuote('real')).toBe(false)
    expect(crossAssetIndexHasLiveQuote('unavailable')).toBe(false)
  })
})
