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

export type DailyBriefReadinessGate = Readonly<{
  wait: () => Promise<Readonly<{ ready: boolean; polls: number; waitedMs: number }>>
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
  /** Readiness is the consumer's own question, not a proxy for it. */
  ready: () => Promise<boolean>
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
    async wait() {
      const startedAt = now()
      let polls = 0
      for (;;) {
        polls += 1
        if (await deps.ready().catch(() => false)) {
          return { ready: true, polls, waitedMs: now() - startedAt }
        }
        if (now() - startedAt + pollMs > budgetMs) {
          return { ready: false, polls, waitedMs: now() - startedAt }
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
  wait: () => ReturnType<DailyBriefReadinessGate['wait']>
  /** Called once when the wait expired; the edition is still produced, with its gaps named. */
  onTimeout?: (info: Readonly<{ polls: number; waitedMs: number }>) => void
}>

export function createDailyBriefReadiness(deps: Readonly<{
  /** The brief's own reader, asked the brief's own question. */
  readSnapshot: () => Promise<Parameters<typeof crossAssetQuotesReady>[0]>
  onTimeout?: (info: Readonly<{ polls: number; waitedMs: number }>) => void
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
  budgetMs?: number
}>): DailyBriefReadiness {
  const gate = createDailyBriefReadinessGate({
    ready: async () => crossAssetQuotesReady(await deps.readSnapshot()),
    sleep: deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    ...(deps.pollMs === undefined ? {} : { pollMs: deps.pollMs }),
    ...(deps.budgetMs === undefined ? {} : { budgetMs: deps.budgetMs })
  })
  return {
    wait: () => gate.wait(),
    ...(deps.onTimeout ? { onTimeout: deps.onTimeout } : {})
  }
}

/** Ask, wait, and report a timeout through the gate's own callback. Awaiting it is the whole call. */
export async function awaitDailyBriefReadiness(readiness: DailyBriefReadiness | undefined): Promise<void> {
  if (!readiness) return
  const waited = await readiness.wait()
  if (!waited.ready) readiness.onTimeout?.({ polls: waited.polls, waitedMs: waited.waitedMs })
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
    readSnapshot: () => reader.queryCrossAssetSnapshot({ range: '24h', asOf: new Date().toISOString() }),
    onTimeout: (info) => console.log(JSON.stringify({ marker: 'MI_DAILY_BRIEF_CORE_FACTS_NOT_READY', ...info }))
  })
}
