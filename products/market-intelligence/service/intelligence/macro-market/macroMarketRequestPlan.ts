import { macroMarketPolicy } from './macroMarketPolicy'

export type MacroMarketPlan =
  | Readonly<{ kind: 'dollar-basket'; symbols: readonly string[]; credits: number }>
  | Readonly<{ kind: 'extras'; symbols: readonly string[]; credits: number }>
  | Readonly<{ kind: 'idle'; symbols: readonly string[]; credits: 0 }>

/** What the last ticks collected, so the plan can measure elapsed time rather than wall-clock phase. */
export type MacroMarketPlanHistory = Readonly<{ basketAtMs?: number; extrasAtMs?: number }>

/**
 * What this tick should fetch.
 *
 * Decided by **elapsed time since the last collection of each kind**, not by the wall-clock minute.
 * An interval trigger fires on a phase set when the job was registered, so a plan that asked for
 * "minute % 15 === 0" would collect only when the registration minute happened to be a multiple of
 * five — and silently never otherwise. Elapsed time has no phase, and the first tick after a restart
 * sees no history and therefore fetches the basket immediately instead of waiting for a boundary.
 *
 * The budget is unchanged: the six-currency basket at most every fifteen minutes, the three extra
 * series at most every thirty, and each request stays under the provider's eight credits per minute.
 */
export function macroMarketRequestPlan(nowMs: number, history: MacroMarketPlanHistory = {}, options: Readonly<{ force?: boolean }> = {}): MacroMarketPlan {
  const budget = macroMarketPolicy.creditBudget
  if (options.force) {
    // A restart is a reason to look: the reader has just opened the app and would otherwise watch a
    // stale level until the cadence came round. One request, and the staler series is the one to take.
    const basketAge = history.basketAtMs === undefined ? Number.POSITIVE_INFINITY : nowMs - history.basketAtMs
    const extrasAge = history.extrasAtMs === undefined ? Number.POSITIVE_INFINITY : nowMs - history.extrasAtMs
    return marketplace(extrasAge > basketAge ? 'extras' : 'dollar-basket')
  }
  const basketDue = history.basketAtMs === undefined || nowMs - history.basketAtMs >= budget.tickMinutes * 60_000
  if (basketDue) return Object.freeze({ kind: 'dollar-basket', symbols: macroMarketPolicy.tickSymbols, credits: macroMarketPolicy.tickSymbols.length })
  const extrasDue = history.extrasAtMs === undefined || nowMs - history.extrasAtMs >= budget.halfCadenceMinutes * 60_000
  if (extrasDue) return Object.freeze({ kind: 'extras', symbols: macroMarketPolicy.halfCadenceSymbols, credits: macroMarketPolicy.halfCadenceSymbols.length })
  return Object.freeze({ kind: 'idle', symbols: Object.freeze([] as string[]), credits: 0 })
}

function marketplace(kind: 'dollar-basket' | 'extras'): MacroMarketPlan {
  return kind === 'dollar-basket'
    ? Object.freeze({ kind: 'dollar-basket', symbols: macroMarketPolicy.tickSymbols, credits: macroMarketPolicy.tickSymbols.length })
    : Object.freeze({ kind: 'extras', symbols: macroMarketPolicy.halfCadenceSymbols, credits: macroMarketPolicy.halfCadenceSymbols.length })
}

/** Credits a full day of ticks costs, so the budget can be asserted rather than assumed. */
export function macroMarketDailyCredits(): number {
  const policy = macroMarketPolicy
  const basketTicksPerDay = (60 / policy.creditBudget.tickMinutes) * 24
  const extraTicksPerDay = (60 / policy.creditBudget.halfCadenceMinutes) * 24
  return basketTicksPerDay * policy.tickSymbols.length + extraTicksPerDay * policy.halfCadenceSymbols.length
}
