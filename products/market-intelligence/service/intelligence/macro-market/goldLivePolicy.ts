/**
 * The live leg of the macro-market source: one price stream, one symbol.
 *
 * The provider's free tier admits a single connection, at most eight symbols, and only symbols on
 * the trial list. Gold (XAU/USD) is on that list; the six currencies behind the synthetic dollar
 * index and USD/CNH are not, so a subscription to them would be rejected as surely as it would
 * spend a connection this budget cannot replace. The dollar index therefore keeps arriving through
 * REST only — the synthesis is unchanged — and this stream carries gold, and nothing else.
 *
 * The tick is presentation only: it refreshes the 最新 cell. It is never appended to the series
 * store, so no window return can be computed from an unclosed value.
 */
export const goldLivePolicy = Object.freeze({
  version: 'macro-market-gold-live.v1',
  sourceId: 'twelve-data-market',
  /** The provider names the query parameter `apikey`; the value is only ever read at connect time. */
  baseUrl: 'wss://ws.twelvedata.com/v1/quotes/price',
  /** The one symbol this product subscribes to, and the series the macro snapshot files it under. */
  symbol: 'XAU/USD',
  seriesId: 'xau-usd',
  action: 'subscribe' as const,
  /** Tick frames carry `event: 'price'`; the acknowledgement carries `event: 'subscribe-status'`. */
  priceEvent: 'price',
  /** Answer to the subscription: `{event, status, ...}`, where success is the only admitted status. */
  acknowledgeEvent: 'subscribe-status',
  successStatus: 'ok',
  /** Provider errors are `{code, message, status}`; the code is a string by name or an HTTP number. */
  errorCodeField: 'code',
  /** The one HTTP status that means "come back later": the socket must not treat it as garbage. */
  rateLimitedCode: 429,
  /** A price longer than this is not a price: it is a parse accident or a hostile frame. */
  maxPriceLength: 24,
  /**
   * The one decimal shape this product admits, and the same one the wire contract carries, so the
   * socket and the boundary cannot hold two opinions about what a price is.
   */
  pricePattern: /^(?:0|[1-9]\d*)(?:\.\d+)?$/,
  maxMessageBytes: 64 * 1024,
  /** A price older than this is stale no matter what the socket says; the badge must say so. */
  freshnessMs: 90_000,
  /**
   * The keepalive. Twelve Data closes a price socket that has been silent for about ten seconds, and
   * it closes it with code 1006 before a single tick has arrived: the subscription is accepted and
   * then the connection dies, which reads as a dead provider rather than as a missing keepalive.
   *
   * Eight seconds is the interval a real key was verified to sustain — two price frames inside twenty
   * seconds, with the subscription accepted — and it leaves roughly two seconds of margin under the
   * observed cutoff so a late timer cannot drift across it. The frame is frozen data, exactly like
   * the subscription: one shape, no credential, nothing computed at send time.
   */
  /**
   * Ninety seconds, not thirty: the provider pushes on change, so a quiet gold price can legitimately
   * sit for half a minute — and marking that 「延迟」 taught the reader to distrust a healthy stream.
   * Beyond this the badge is telling the truth: nothing has arrived for a minute and a half.
   */
  heartbeat: Object.freeze({
    intervalMs: 8_000,
    frame: Object.freeze({ action: 'heartbeat' as const })
  }),
  /** Two minutes between readiness reads: fast enough to honour an enable, cheap enough to ignore. */
  profileCheckMs: 120_000,
  reconnect: Object.freeze({
    /** Exponential, then flat: the provider's free tier punishes a reconnect storm with a ban. */
    delaysMs: Object.freeze([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]),
    jitterRatio: 0.2
  }),
  failureCodes: Object.freeze(['credential-missing', 'credential-rejected', 'plan-restricted', 'rate-limited', 'transport-unavailable', 'response-invalid'] as const)
})

export type GoldLiveFailureCode = typeof goldLivePolicy.failureCodes[number]

/**
 * The canonical decimal string for one price, or `undefined` when the value is not a price at all.
 *
 * Both shapes the provider really uses are admitted: a JSON **number**, which is what the price
 * socket sends (`"price":4144.04708`), and a string that already looks like a decimal, which is what
 * the REST endpoints answer. They are not two prices but one figure in two transport shapes, so the
 * number is normalised to its decimal string here and the renderer's contract keeps carrying a
 * string. Everything else is refused: a missing field, a boolean, an object, a non-finite number, a
 * zero or negative price, exponent notation, and anything longer than the bound. A value this
 * function cannot answer for is dropped rather than repaired.
 */
export function goldLivePriceOf(value: unknown): string | undefined {
  // A number is stringified only once it is known to be finite: `String(NaN)` and `String(Infinity)`
  // would otherwise be spellings this function has to recognise and refuse later.
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : undefined)
    : typeof value === 'string' ? value
      : undefined
  if (text === undefined || text.length === 0 || text.length > goldLivePolicy.maxPriceLength) return undefined
  if (!goldLivePolicy.pricePattern.test(text)) return undefined
  const price = Number(text)
  return Number.isFinite(price) && price > 0 ? text : undefined
}

/** The one shape this module is allowed to send. Kept a pure function so a test can pin it. */
export function goldLiveSubscription(): string {
  return JSON.stringify({ action: goldLivePolicy.action, params: { symbols: goldLivePolicy.symbol } })
}

/** The keepalive body, materialised once from the frozen frame: every beat is byte-identical. */
const heartbeatBody = JSON.stringify(goldLivePolicy.heartbeat.frame)

/**
 * The keepalive frame the socket sends on its interval. It carries an action and nothing else — no
 * symbol, no timestamp, and above all no key: the credential lives in the URL and never in a frame.
 */
export function goldLiveHeartbeat(): string {
  return heartbeatBody
}

/** The URL carries the key, so the key is only ever materialised here and passed straight to the socket. */
export function goldLiveUrl(apiKey: string): string {
  return `${goldLivePolicy.baseUrl}?apikey=${encodeURIComponent(apiKey)}`
}
