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
 *    than a row that is briefly quiet.
 * 3. **能不能答只看库里有没有这一腿的收盘**（2026-11-11 用户红线：「没有」和「拿不到」必须分开）：
 *    实时流的 `unavailable` / `connecting` / `stale` / `limited`，以及真实指数这条腿的
 *    `feedState === 'unavailable'`，只影响「实时报价未连接 / 休市 / 截至某时」这类状态词，
 *    **不再决定这一行能不能拿出收盘价**。只有读者明确关掉某一腿（`disabled`）或库里两腿都没有
 *    收盘时，才轮到下一腿 / 未接入。一次失败的 tick 曾能让这一行在 15 分钟里写「未接入」，
 *    而库里 289/289 根都在——那是在说假话。
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
  // 读者明确关掉的腿不答（那是「确实不要」）；其余运行状态一律只影响状态词，不影响可用性。
  const proxyUsable = input.proxyAvailable && input.liveState !== 'disabled'
  if (proxyUsable) return 'proxy'
  // `feedState` 同理只描述「这一轮取数顺不顺」，不决定库里那根收盘能不能答。
  if (input.realAvailable) return 'real'
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
