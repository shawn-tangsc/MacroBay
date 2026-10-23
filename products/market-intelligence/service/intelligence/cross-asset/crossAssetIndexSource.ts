import { crossAssetPolicy } from './crossAssetPolicy'

/**
 * Which leg answers the index row, and in which order.
 *
 * The row **defaults to the tokenised perpetual** (`proxy`, Binance `QQQUSDT`) because it is the only
 * leg with a live stream and a 24/7 tape: the row ticks, and it ticks every day. The licensed Nasdaq
 * 100 cash index (`real`, `USTEC`) is the **fallback**, used when the proxy leg cannot answer at all —
 * the Binance contract is not admitted, there is no stored bar for it, or the cross-asset source is
 * switched off or unavailable.
 *
 * Two properties are deliberate:
 *
 * 1. **The perpetual is never shown as the standard index.** It is a synthetic, so the row carries the
 *    代理 label whenever this leg answers — which, being the default, is most of the time.
 * 2. **A closed session does not move the row.** While the real leg answers, its market being shut is
 *    reported as 休市 beside the last bar that actually closed; it never becomes a reason to change
 *    instrument. A transient Binance stream disconnect (`stale`) does not move the row either: the
 *    stored bars are still the proxy's, and flipping instruments on every reconnect would be worse
 *    than a row that is briefly quiet. Only a *hard* failure — switched off, or unavailable with an
 *    empty history — hands the row to the licensed index.
 */
export type CrossAssetIndexSource = 'real' | 'proxy' | 'unavailable'

/** What the licensed real feed last managed to do. `pending` is "not attempted yet in this process". */
export type CrossAssetIndexFeedState = 'ready' | 'unavailable' | 'pending'

/** The cross-asset runtime's own state, as the snapshot layer already receives it. */
export type CrossAssetLiveState = 'disabled' | 'connecting' | 'live' | 'stale' | 'limited' | 'unavailable'

export function selectCrossAssetIndexSource(input: Readonly<{
  /** Whether the stored horizon holds any bar from the tokenised proxy. */
  proxyAvailable: boolean
  /** The Binance cross-asset runtime's state. `disabled`/`unavailable` are the hard failures. */
  liveState: CrossAssetLiveState
  /** Whether the stored horizon holds any bar from the real index. */
  realAvailable: boolean
  feedState: CrossAssetIndexFeedState
}>): CrossAssetIndexSource {
  const proxyUsable = input.proxyAvailable && input.liveState !== 'disabled' && input.liveState !== 'unavailable'
  if (proxyUsable) return 'proxy'
  // `pending` counts as usable: after a restart the stored real history is still the real index, and
  // reporting 未接入 for the few seconds before the first tick would hide a reading we already hold.
  if (input.realAvailable && input.feedState !== 'unavailable') return 'real'
  return 'unavailable'
}

/** The symbol a source is stored under, or `undefined` when the row has no reading. */
export function crossAssetIndexSymbol(source: CrossAssetIndexSource): string | undefined {
  if (source === 'real') return crossAssetPolicy.index.symbol
  if (source === 'proxy') return crossAssetPolicy.index.proxySymbol
  return undefined
}

/** Only the proxy leg trades continuously, so only it can carry a live quote into the row. */
export function crossAssetIndexHasLiveQuote(source: CrossAssetIndexSource): boolean {
  return source === 'proxy'
}
