/**
 * Wait for the market the brief is about to read, before a run is recorded.
 *
 * The 07:00 edition was generated seconds after the app started, before the cross-asset collector had
 * caught up: BTC, ETH and the index all came back unavailable, and the reader saw three dashes. The
 * data was fine — it arrived minutes later.
 *
 * The gate asks the same question the brief will ask (is the snapshot readable, with BTC and ETH
 * priced) rather than inferring readiness from another fact such as "a bar landed": an inference can
 * say ready while the real read still fails. The index is deliberately not part of readiness: it is
 * often late, and waiting for it would delay every morning's brief.
 *
 * Waiting happens before the attempt row is opened, so a wait leaves no half-run behind.
 */
export const dailyBriefReadinessPolicy = Object.freeze({
  pollMs: 30_000,
  budgetMs: 15 * 60_000
})

/** What the run can tell the reader while it waits: how long, and how many times it asked. */
export type DailyBriefReadinessProgress = Readonly<{ polls: number; waitedMs: number }>

export type DailyBriefReadinessGate = Readonly<{
  /**
   * `asOf` is the edition's own cutoff, never "now": the probe must ask the same question the
   * generation will ask, or it can report ready while the real read still fails.
   *
   * `onPoll` is called after every probe that came back not-ready, so a wait can be shown while it
   * is happening instead of only after it ends.
   */
  wait: (asOf: string, onPoll?: (progress: DailyBriefReadinessProgress) => void) => Promise<Readonly<{ ready: boolean; polls: number; waitedMs: number }>>
}>

/**
 * Whether the snapshot carries the two prices the brief must not be without.
 *
 * The index is excluded on purpose: it is routinely late, and making it a condition would hold every
 * morning's edition for a row that is not required to write one.
 */
export function crossAssetQuotesReady(snapshot: Readonly<{
  closedReturns: Readonly<Record<string, Readonly<Record<string, Readonly<{ state: string }>>>>>
}> | undefined): boolean {
  if (!snapshot) return false
  return snapshot.closedReturns.btc?.['24h']?.state === 'available' &&
    snapshot.closedReturns.eth?.['24h']?.state === 'available'
}

export function createDailyBriefReadinessGate(deps: Readonly<{
  /** Readiness is the consumer's own question, asked at the edition's own cutoff. */
  ready: (asOf: string) => Promise<boolean>
  /** Injected so tests do not sleep for real; production passes a setTimeout-based sleep. */
  sleep: (ms: number) => Promise<void>
  now?: () => number
  pollMs?: number
  budgetMs?: number
}>): DailyBriefReadinessGate {
  const now = deps.now ?? Date.now
  const pollMs = deps.pollMs ?? dailyBriefReadinessPolicy.pollMs
  const budgetMs = deps.budgetMs ?? dailyBriefReadinessPolicy.budgetMs
  return {
    async wait(asOf: string, onPoll?: (progress: DailyBriefReadinessProgress) => void) {
      const startedAt = now()
      let polls = 0
      for (;;) {
        polls += 1
        if (await deps.ready(asOf).catch(() => false)) {
          return { ready: true, polls, waitedMs: now() - startedAt }
        }
        const waitedMs = now() - startedAt
        onPoll?.({ polls, waitedMs })
        if (waitedMs + pollMs > budgetMs) {
          return { ready: false, polls, waitedMs }
        }
        await deps.sleep(pollMs)
      }
    }
  }
}

/**
 * The gate as the service sees it: ask, wait, and say when the wait ran out.
 *
 * Packaged here so the service carries one optional dependency and one call, and the polling policy
 * stays in this file rather than in the generation path.
 */
export type DailyBriefReadiness = Readonly<{
  wait: (asOf: string, onPoll?: (progress: DailyBriefReadinessProgress) => void) => Promise<Readonly<{ ready: boolean; polls: number; waitedMs: number }>>
  /** Called once when the wait expired; the edition is still produced, with its gaps named. */
  onTimeout?: (info: Readonly<{ polls: number; waitedMs: number }>) => void
}>

export function createDailyBriefReadiness(deps: Readonly<{
  /** The brief's own reader, asked the brief's own question at the edition's cutoff. */
  readSnapshot: (asOf: string) => Promise<Parameters<typeof crossAssetQuotesReady>[0]>
  onTimeout?: (info: Readonly<{ polls: number; waitedMs: number }>) => void
  sleep?: (ms: number) => Promise<void>
  /** Injected clock, so a test's sleeps and the budget agree without real waiting. */
  now?: () => number
  pollMs?: number
  budgetMs?: number
}>): DailyBriefReadiness {
  const gate = createDailyBriefReadinessGate({
    ready: async (asOf) => crossAssetQuotesReady(await deps.readSnapshot(asOf)),
    sleep: deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.pollMs === undefined ? {} : { pollMs: deps.pollMs }),
    ...(deps.budgetMs === undefined ? {} : { budgetMs: deps.budgetMs })
  })
  return {
    wait: (asOf: string, onPoll?: (progress: DailyBriefReadinessProgress) => void) => gate.wait(asOf, onPoll),
    ...(deps.onTimeout ? { onTimeout: deps.onTimeout } : {})
  }
}

/** Ask, wait, and report a timeout through the gate's own callback. Awaiting it is the whole call. */
export async function awaitDailyBriefReadiness(
  readiness: DailyBriefReadiness | undefined,
  asOf: string,
  onPoll?: (progress: DailyBriefReadinessProgress) => void
): Promise<Readonly<{ ready: boolean; polls: number; waitedMs: number }> | undefined> {
  if (!readiness) return undefined
  const waited = await readiness.wait(asOf, onPoll)
  if (!waited.ready) readiness.onTimeout?.({ polls: waited.polls, waitedMs: waited.waitedMs })
  return waited
}

/**
 * The wiring the module does not need to spell out: read through the product's own query, and log the
 * operational marker when the wait expired. A timeout is not an error — the edition is still produced
 * — but it is the one line an operator needs to find when a morning looks thin.
 */
export function createDailyBriefReadinessFor(reader: Readonly<{
  queryCrossAssetSnapshot: (input: { range: '24h'; asOf: string }) => Promise<Parameters<typeof crossAssetQuotesReady>[0]>
}>): DailyBriefReadiness {
  return createDailyBriefReadiness({
    // The cutoff is the caller's, never the clock's: same question, same instant as the generation.
    readSnapshot: (asOf) => reader.queryCrossAssetSnapshot({ range: '24h', asOf }),
    onTimeout: (info) => console.log(JSON.stringify({ marker: 'MI_DAILY_BRIEF_CORE_FACTS_NOT_READY', ...info }))
  })
}
