import { describe, expect, it } from 'vitest'

import {
  buildSignalDedupeKey,
  isCanonicalSignalTime,
  isCoverageComplete,
  isModuleSignal,
  moduleSignalPolicy,
  signalCooldown,
  signalTriggerKey,
  signalWindow,
  type ModuleSignal,
  type SignalCadence
} from './moduleSignal'

const at = '2026-10-31T14:30:00.000Z'
const intraday: SignalCadence = { kind: 'intraday', bucketMs: 15 * 60_000 }
const daily: SignalCadence = { kind: 'trading-day' }

const signal = (overrides: Partial<ModuleSignal> = {}): ModuleSignal => ({
  version: moduleSignalPolicy.version,
  moduleId: 'open-interest',
  ruleId: 'oi-liquidation-proxy',
  asset: 'btc',
  severity: 'medium',
  observedAt: at,
  cadence: intraday,
  values: { dropPct: -1.8, pricePct: -0.9, volumeMultiple: 2.4 },
  dedupeKey: 'open-interest:oi-liquidation-proxy:btc:2026-10-31T14:30:00.000Z',
  readiness: 'available',
  triggerOwner: 'module-signal',
  ...overrides
})

describe('module signal contract', () => {
  it('accepts a signal a rule would publish', () => {
    expect(isModuleSignal(signal())).toBe(true)
    expect(isModuleSignal(signal({ asset: null, moduleId: 'macro-calendar', cadence: daily, ruleId: 'macro-surprise' }))).toBe(true)
    expect(isModuleSignal(signal({ moduleId: 'etf-flows', ruleId: 'etf-outflow-3d', cadence: daily, values: { netFlowUsd: -4.8e8, coveredDays: 3, requiredDays: 3 } }))).toBe(true)
  })

  it('refuses a shape the reader could not interpret', () => {
    const rejected = [
      signal({ version: '0' }),
      signal({ moduleId: 'unknown' as never }),
      signal({ ruleId: 'OI Liquidation' }),
      signal({ ruleId: 'x'.repeat(moduleSignalPolicy.maximumRuleIdLength + 1) }),
      signal({ severity: 'critical' as never }),
      signal({ observedAt: '2026-10-31T14:30:00Z' }),
      signal({ observedAt: '2026-10-31 14:30:00.000Z' }),
      signal({ cadence: { kind: 'intraday' } as never }),
      signal({ cadence: { kind: 'intraday', bucketMs: 0 } }),
      // Longer than a day is a daily rule wearing an intraday shape.
      signal({ cadence: { kind: 'intraday', bucketMs: 25 * 60 * 60_000 } }),
      signal({ cadence: { kind: 'trading-day', bucketMs: 60_000 } as never }),
      signal({ readiness: 'partial' as never }),
      signal({ triggerOwner: '' }),
      signal({ dedupeKey: '' })
    ]
    for (const value of rejected) expect(isModuleSignal(value), JSON.stringify(value)).toBe(false)
  })

  it('refuses a per-asset rule that cannot name its asset', () => {
    // `null` is unreachable for a single-asset rule: it is not "the whole market", it is a question.
    expect(isModuleSignal(signal({ asset: null }))).toBe(false)
    expect(isModuleSignal(signal({ moduleId: 'etf-flows', ruleId: 'etf-outflow-3d', asset: null, cadence: daily }))).toBe(false)
  })

  it('refuses a windowed rule that does not say how much it covered', () => {
    // The failure this prevents: a two-day window passing for a three-day one with every test green.
    const windowed = signal({ moduleId: 'etf-flows', ruleId: 'etf-outflow-3d', cadence: daily, values: { netFlowUsd: -4.8e8 } })
    expect(isModuleSignal(windowed)).toBe(false)
    expect(isModuleSignal({ ...windowed, values: { netFlowUsd: -4.8e8, coveredDays: 2 } })).toBe(false)
    expect(isModuleSignal({ ...windowed, values: { netFlowUsd: -4.8e8, coveredDays: 2, requiredDays: 0 } })).toBe(false)
    expect(isModuleSignal({ ...windowed, values: { netFlowUsd: -4.8e8, coveredDays: 2.5, requiredDays: 3 } })).toBe(false)
    // A point event has no window, so it is not asked for one.
    expect(isModuleSignal(signal({ moduleId: 'macro-calendar', ruleId: 'macro-surprise', asset: null, cadence: daily }))).toBe(true)
  })

  it('checks coverage numbers even when the module was never registered as windowed', () => {
    // Collecting the keys is what subjects a rule to the check: half a coverage figure, or day
    // coverage on an intraday bucket, is not a shape any rule may publish.
    const calendar = signal({ moduleId: 'macro-calendar', ruleId: 'macro-surprise', asset: null, cadence: daily })
    expect(isModuleSignal({ ...calendar, values: { coveredDays: 2, requiredDays: 3 } })).toBe(true)
    expect(isModuleSignal({ ...calendar, values: { coveredDays: 2 } })).toBe(false)
    expect(isModuleSignal({ ...calendar, values: { requiredDays: 3 } })).toBe(false)
    expect(isModuleSignal({ ...calendar, values: { coveredDays: 2, requiredDays: 3 }, cadence: intraday })).toBe(false)
    expect(isModuleSignal({ ...calendar, values: { coveredDays: -1, requiredDays: 3 } })).toBe(false)
    expect(isModuleSignal({ ...calendar, values: { coveredDays: 2, requiredDays: 0 } })).toBe(false)
  })

  it('keeps values numeric: completeness is two numbers, not a boolean', () => {
    expect(isModuleSignal(signal({ moduleId: 'macro-calendar', ruleId: 'macro-surprise', asset: null, cadence: daily, values: { coveredDays: 2, requiredDays: 3 } }))).toBe(true)
    expect(isModuleSignal(signal({ values: { complete: 1 } }))).toBe(true)
    expect(isModuleSignal(signal({ values: { complete: true } as never }))).toBe(false)
    expect(isModuleSignal(signal({ values: { dropPct: '2' } as never }))).toBe(false)
    expect(isModuleSignal(signal({ values: { dropPct: Number.NaN } }))).toBe(false)
    expect(isModuleSignal(signal({ values: { dropPct: Number.POSITIVE_INFINITY } }))).toBe(false)
  })

  it('rejects a time that is not canonical UTC with milliseconds', () => {
    expect(isCanonicalSignalTime(at)).toBe(true)
    expect(isCanonicalSignalTime('2026-10-31T14:30:00Z')).toBe(false)
    expect(isCanonicalSignalTime('2026-13-31T14:30:00.000Z')).toBe(false)
    expect(isCanonicalSignalTime(undefined)).toBe(false)
  })
})

describe('signal window', () => {
  it('turns an intraday rule into buckets of its own size', () => {
    expect(signalWindow(intraday, 96)).toEqual({ unit: 'buckets', amount: 96, bucketMs: 900_000, upperBoundMs: 86_400_000 })
  })

  it('never turns a trading-day window into milliseconds', () => {
    const window = signalWindow(daily, 3)
    expect(window).toEqual({ unit: 'trading-days', amount: 3, upperBoundMs: null })
    // The number this function exists to prevent: three calendar days is not three trading days,
    // because a Friday-to-Monday window would silently cover a weekend.
    expect(window?.upperBoundMs).not.toBe(3 * 86_400_000)
  })

  it('refuses a window no rule could mean', () => {
    expect(signalWindow(intraday, 0)).toBeUndefined()
    expect(signalWindow(intraday, -1)).toBeUndefined()
    expect(signalWindow(intraday, Number.NaN)).toBeUndefined()
    expect(signalWindow({ kind: 'intraday', bucketMs: 0 }, 4)).toBeUndefined()
  })
})

describe('signal cooldown', () => {
  it('cools an intraday rule for two hours', () => {
    expect(signalCooldown(intraday)).toEqual({ kind: 'duration', ms: moduleSignalPolicy.intradayCooldownMs })
  })

  it('cools a daily rule by trading day, which cannot be expressed as zero hours', () => {
    const cooldown = signalCooldown(daily)
    expect(cooldown).toEqual({ kind: 'trading-days', days: 1 })
    // Zero means "no cooling"; "once a trading day" is a different promise.
    expect(cooldown).not.toEqual({ kind: 'duration', ms: 0 })
  })
})

describe('dedupe bucket', () => {
  it('floors an intraday signal into its own bucket', () => {
    const key = buildSignalDedupeKey({
      moduleId: 'open-interest', ruleId: 'oi-liquidation-proxy', asset: 'btc',
      observedAt: '2026-10-31T14:37:41.250Z', cadence: intraday
    })
    expect(key).toBe('open-interest:oi-liquidation-proxy:btc:2026-10-31T14:30:00.000Z')
  })

  it('keys a daily signal on the trading day it describes, not the day it arrived', () => {
    // An ETF row that lands on Saturday still belongs to Friday's session.
    const key = buildSignalDedupeKey({
      moduleId: 'etf-flows', ruleId: 'etf-outflow-3d', asset: 'btc',
      observedAt: '2026-10-30T21:00:00.000Z', cadence: daily
    })
    expect(key).toBe('etf-flows:etf-outflow-3d:btc:2026-10-30')
  })

  it('names a market-wide rule without inventing an asset', () => {
    expect(buildSignalDedupeKey({ moduleId: 'macro-calendar', ruleId: 'macro-surprise', asset: null, observedAt: at, cadence: daily }))
      .toBe('macro-calendar:macro-surprise:market:2026-10-31')
  })

  it('refuses to build a key from an instant it cannot read', () => {
    expect(buildSignalDedupeKey({ moduleId: 'open-interest', ruleId: 'oi-liquidation-proxy', asset: 'btc', observedAt: '2026-10-31', cadence: intraday })).toBeUndefined()
  })
})

describe('coverage', () => {
  it('reads completeness from the two numbers, never from a flag', () => {
    expect(isCoverageComplete({ coveredDays: 3, requiredDays: 3 })).toBe(true)
    expect(isCoverageComplete({ coveredDays: 4, requiredDays: 3 })).toBe(true)
    expect(isCoverageComplete({ coveredDays: 2, requiredDays: 3 })).toBe(false)
  })

  it('answers incomplete when it was not told how much was covered', () => {
    // Silence is not completeness: this is the same "absent is not true" rule as elsewhere.
    expect(isCoverageComplete({ dropPct: -1.8 })).toBe(false)
    expect(isCoverageComplete({ coveredDays: 3 })).toBe(false)
    expect(isCoverageComplete({ requiredDays: 3 })).toBe(false)
  })
})

describe('the analysis trigger key a signal asks for', () => {
  // 一条规则一个键：资产不进键，否则同一条规则会在预算里长成两个身份。
  it('builds one key per rule, with no asset in it', () => {
    expect(signalTriggerKey('etf-flows', 'etf-outflow-3d')).toBe('signal.etf-flows.etf-outflow-3d')
    expect(signalTriggerKey('open-interest', 'oi-liquidation-proxy')).toBe('signal.open-interest.oi-liquidation-proxy')
  })

  // 拼不出合规的键就不拼：让一个坏键漏进预算，等于匿名花掉一次事件线额度。
  it('refuses a rule id that is not a kebab token', () => {
    expect(signalTriggerKey('etf-flows', 'etf_outflow_3d')).toBeUndefined()
    expect(signalTriggerKey('etf-flows', 'etf.outflow')).toBeUndefined()
    expect(signalTriggerKey('etf-flows', '')).toBeUndefined()
  })
})
