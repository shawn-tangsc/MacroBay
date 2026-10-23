import type { JobRuntime } from '@platform/jobs'
import { macroMarketPolicy } from './macroMarketPolicy'


export const MACRO_MARKET_COLLECT_JOB_ID = 'market-intelligence.collect-macro-market'
export const MACRO_MARKET_PRODUCT_ID = 'market-intelligence'

/** A five-minute clock: the plan decides which of those ticks actually spends a credit. */
export function macroMarketJobDefinitions(): readonly Readonly<Record<string, unknown>>[] {
  const definition = {
    id: MACRO_MARKET_COLLECT_JOB_ID, owner: 'product' as const, productId: MACRO_MARKET_PRODUCT_ID,
    handlerId: MACRO_MARKET_COLLECT_JOB_ID, title: 'Collect the macro market series',
    trigger: { kind: 'interval' as const, intervalMs: macroMarketPolicy.creditBudget.jobIntervalMinutes * 60_000, anchor: 'lastComplete' as const },
    payload: {}
  }
  // The startup tick carries a flag: it looks immediately instead of waiting for the cadence.
  return [definition, { ...definition, id: `${MACRO_MARKET_COLLECT_JOB_ID}:startup`, trigger: { kind: 'manual' as const }, payload: { startup: true } }]
}

/**
 * Registers the collector. The startup run matters: an interval anchored to the last complete
 * period would leave a reader who opens the app at 09:02 without a dollar level until 09:05, and
 * the level they see then would be the first one ever fetched rather than the latest.
 */
export function registerMacroMarketJob(jobRuntime: JobRuntime, run: (atMs?: number, options?: Readonly<{ force?: boolean }>) => Promise<unknown>): void {
  jobRuntime.registerHandler(MACRO_MARKET_COLLECT_JOB_ID, async (payload: unknown) => {
    const startup = Boolean(payload && typeof payload === 'object' && (payload as { startup?: unknown }).startup)
    await run(undefined, startup ? { force: true } : {})
  })
  const [definition, startup] = macroMarketJobDefinitions()
  if (typeof jobRuntime.setSchedule === 'function') {
    jobRuntime.setSchedule(definition as never)
    void jobRuntime.enqueueDefinition(startup as never).catch(() => undefined)
  }
}
