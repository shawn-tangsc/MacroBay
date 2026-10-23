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
    // The source is switched off, the runtime is unavailable, or the contract has no stored bar.
    expect(selectCrossAssetIndexSource({ liveState: 'disabled', proxyAvailable: true, realAvailable: true, feedState: 'ready' })).toBe('real')
    expect(selectCrossAssetIndexSource({ liveState: 'unavailable', proxyAvailable: true, realAvailable: true, feedState: 'ready' })).toBe('real')
    expect(selectCrossAssetIndexSource({ liveState: 'live', proxyAvailable: false, realAvailable: true, feedState: 'ready' })).toBe('real')
    // A restart has not attempted a licensed tick yet; its stored history is still the real index.
    expect(selectCrossAssetIndexSource({ liveState: 'disabled', proxyAvailable: false, realAvailable: true, feedState: 'pending' })).toBe('real')
  })

  it('admits no source at all when neither leg can answer', () => {
    expect(selectCrossAssetIndexSource({ liveState: 'unavailable', proxyAvailable: false, realAvailable: false, feedState: 'ready' })).toBe('unavailable')
    expect(selectCrossAssetIndexSource({ liveState: 'live', proxyAvailable: false, realAvailable: false, feedState: 'ready' })).toBe('unavailable')
    // A licensed feed that has failed cannot answer either: an unusable proxy plus a failed real leg is
    // 未接入, never a stale reading presented as a current one.
    expect(selectCrossAssetIndexSource({ liveState: 'disabled', proxyAvailable: false, realAvailable: true, feedState: 'unavailable' })).toBe('unavailable')
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
