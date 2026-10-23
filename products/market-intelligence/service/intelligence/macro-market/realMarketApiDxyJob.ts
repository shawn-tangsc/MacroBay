import type { JobRuntime } from '@platform/jobs'
import { realMarketApiPolicy } from './realMarketApiPolicy'

export const REAL_MARKET_API_DXY_COLLECT_JOB_ID = 'market-intelligence.collect-realmarketapi-dxy'
const PRODUCT_ID = 'market-intelligence'

/**
 * A five-minute clock for the real dollar index. The tick itself costs one request (two on the tick
 * that backfills), which at this cadence is a few hundred a month against the provider's budget.
 */
export function realMarketApiDxyJobDefinitions(): readonly Readonly<Record<string, unknown>>[] {
  const definition = {
    id: REAL_MARKET_API_DXY_COLLECT_JOB_ID, owner: 'product' as const, productId: PRODUCT_ID,
    handlerId: REAL_MARKET_API_DXY_COLLECT_JOB_ID, title: 'Collect the real dollar index',
    trigger: { kind: 'interval' as const, intervalMs: realMarketApiPolicy.intervalMs, anchor: 'lastComplete' as const },
    payload: {}
  }
  // The startup tick looks immediately: the reader who opens the app at 09:02 must not wait for 09:05,
  // and the level the forced tick stores is the provider's latest rather than the first bar collected.
  return [definition, { ...definition, id: `${REAL_MARKET_API_DXY_COLLECT_JOB_ID}:startup`, trigger: { kind: 'manual' as const }, payload: { startup: true } }]
}

export function registerRealMarketApiDxyJob(
  jobRuntime: JobRuntime,
  run: (atMs?: number, options?: Readonly<{ force?: boolean }>) => Promise<unknown>
): void {
  jobRuntime.registerHandler(REAL_MARKET_API_DXY_COLLECT_JOB_ID, async (payload: unknown) => {
    const startup = Boolean(payload && typeof payload === 'object' && (payload as { startup?: unknown }).startup)
    await run(undefined, startup ? { force: true } : {})
  })
  const [definition, startup] = realMarketApiDxyJobDefinitions()
  if (typeof jobRuntime.setSchedule === 'function') {
    jobRuntime.setSchedule(definition as never)
    void jobRuntime.enqueueDefinition(startup as never).catch(() => undefined)
  }
}
