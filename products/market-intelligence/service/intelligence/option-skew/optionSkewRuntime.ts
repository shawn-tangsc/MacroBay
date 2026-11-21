import type { JobRuntime } from '@platform/jobs'

import { computeOptionSkew } from './optionSkewCalculator'
import type { DeribitOptionsClient } from './deribitOptionsClient'
import type { OptionSkewPointStore } from './optionSkewPointStore'
import { optionSkewPolicy, utcDayOf, type OptionSkewPoint } from './optionSkewPolicy'

export type OptionSkewRunResult =
  | Readonly<{ state: 'disabled' }>
  | Readonly<{ state: 'recorded'; day: string; riskReversal: number }>
  | Readonly<{ state: 'skipped'; failureCode: string }>

export type OptionSkewRuntime = Readonly<{
  run: (nowMs?: number) => Promise<OptionSkewRunResult>
  probe: () => Promise<Readonly<{ state: 'available' } | { state: 'unavailable'; failureCode: string }>>
  /** Arm or drop the schedule to match the switch; the handler itself re-checks as well. */
  sync: () => Promise<void>
  start: () => void
}>

/**
 * The one writer of the option-skew point store.
 *
 * Collection is product-owned (design §2.3), not the generic metric adapter: one round is two
 * requests, and only the computed 30-day point is stored — never the chain itself. A failed round
 * records its health and leaves the stored days alone, so "could not fetch" never turns into a
 * carried-forward value.
 */
export function createOptionSkewRuntime(deps: {
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule'>
  store: OptionSkewPointStore
  client: DeribitOptionsClient
  isEnabled: () => Promise<boolean>
  now?: () => string
  log?: (entry: Readonly<{ level: 'info' | 'warn'; message: string }>) => void
}): OptionSkewRuntime {
  const now = deps.now ?? (() => new Date().toISOString())
  const log = deps.log ?? (() => undefined)

  async function enabled(): Promise<boolean> {
    try {
      return await deps.isEnabled()
    } catch {
      return false
    }
  }

  async function run(nowMs?: number): Promise<OptionSkewRunResult> {
    if (!(await enabled())) return { state: 'disabled' }
    const at = nowMs === undefined ? now() : new Date(nowMs).toISOString()
    const snapshot = await deps.client.fetchChain(Date.parse(at))
    if (snapshot.state === 'unavailable') {
      await deps.store.recordFailure({ at, failureCode: snapshot.failureCode })
      log({ level: 'warn', message: `Option skew fetch failed: ${snapshot.failureCode}.` })
      return { state: 'skipped', failureCode: snapshot.failureCode }
    }

    const computed = computeOptionSkew({
      instruments: snapshot.instruments,
      quotes: snapshot.quotes,
      nowMs: Date.parse(at)
    })
    if (computed.state === 'failed') {
      // A day with no usable bracket is not written: interpolating between far expiries or across a
      // missing wing would invent a number the venue never quoted.
      await deps.store.recordFailure({ at, failureCode: computed.failureCode })
      log({ level: 'warn', message: `Option skew not computed: ${computed.failureCode}.` })
      return { state: 'skipped', failureCode: computed.failureCode }
    }

    const point: OptionSkewPoint = {
      day: utcDayOf(snapshot.observedAt),
      observedAt: snapshot.observedAt,
      ...computed.legs,
      tenorDays: 30
    }
    await deps.store.recordPoint(point)
    return { state: 'recorded', day: point.day, riskReversal: point.riskReversal }
  }

  async function sync(): Promise<void> {
    if (!(await enabled())) {
      deps.jobRuntime.removeSchedule?.(optionSkewPolicy.jobId)
      return
    }
    deps.jobRuntime.setSchedule({
      id: optionSkewPolicy.jobId,
      owner: 'product',
      productId: optionSkewPolicy.productId,
      handlerId: optionSkewPolicy.jobId,
      title: 'Collect the BTC option skew',
      audience: 'user',
      trigger: { kind: 'interval', intervalMs: optionSkewPolicy.intervalMs, anchor: 'lastComplete' },
      payload: {}
    } as never)
  }

  return Object.freeze({
    run,
    async probe() {
      return deps.client.probe()
    },
    sync,
    start() {
      deps.jobRuntime.registerHandler(optionSkewPolicy.jobId, async (_payload, context) => {
        const result = await run()
        await context.log({
          level: result.state === 'recorded' ? 'info' : 'warn',
          message: result.state === 'recorded'
            ? `Option skew recorded for ${result.day}: ${result.riskReversal}.`
            : `Option skew round ended ${result.state}${'failureCode' in result ? ` (${result.failureCode})` : ''}.`
        })
        await context.result?.({
          counts: result.state === 'recorded'
            ? { total: 1, succeeded: 1, failed: 0, skipped: 0 }
            : result.state === 'disabled'
              ? { total: 1, succeeded: 0, failed: 0, skipped: 1 }
              : { total: 1, succeeded: 0, failed: 1, skipped: 0 }
        })
      })
      void sync()
    }
  })
}