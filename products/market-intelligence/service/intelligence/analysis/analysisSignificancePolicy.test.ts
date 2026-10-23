import { describe, expect, it } from 'vitest'
import type { MacroEconomicCalendarEventView } from '../../../contracts/macro/economicCalendarQueryContracts'
import {
  analysisSignificancePolicy, evaluateSignificance, significanceChangeHash, type SignificanceEvaluationInput
} from './analysisSignificancePolicy'
import type { MacroCalendarProviderObservation } from '../macro-calendar/marketCalendarObservationNormalization'
import { providerSurpriseBaselineKey } from './providerReleaseSurprisePolicy'
import { semanticKeyOf, type SignificanceBaseline, type SignificanceSignal } from './significanceChangeMatcher'

const eventKey = 'US.CPI.RELEASE.2026-M09'
const previousAsOf = '2026-10-09T00:00:00.000Z'
const now = '2026-10-09T12:00:00.000Z'

function official(overrides: Partial<MacroEconomicCalendarEventView> = {}): MacroEconomicCalendarEventView {
  return {
    eventKey, releaseGroupKey: 'US.BLS.RELEASE.1', eventFamily: 'consumer-price-index', titleKey: 'cpi', countryCode: 'US',
    importance: 'high', periodKey: 'release-2026-10-13', lifecycleState: 'released', coverage: 'available',
    scheduledDate: '2026-10-13', scheduledAt: '2026-10-13T12:30:00.000Z', detectedAt: '2026-10-09T06:00:00.000Z',
    actual: { displayValue: '3.2%' }, ...overrides
  } as MacroEconomicCalendarEventView
}

const baseline = (official_: readonly MacroEconomicCalendarEventView[]): SignificanceBaseline =>
  ({ official: official_, provider: [], months: ['2026-09', '2026-10'], asOf: now })

const key = (metric: string) => semanticKeyOf('macro', 'consumer-price-index', metric, eventKey)
const roomy = { now, lastAutoRunAt: null, hourRuns: 0, dayRuns: 0, eventRunsToday: 0, scheduledRunsToday: 0 }
const evaluate = (overrides: Partial<SignificanceEvaluationInput> = {}) => evaluateSignificance({
  triggerKey: 'calendar.refresh', previousAsOf, current: baseline([official()]), previous: new Map([[key('actual'), '3.1%']]), ...roomy, ...overrides
})

it('states its version and the one importance it can trigger on', () => {
  expect(analysisSignificancePolicy.version).toBe('marketAnalysisSignificancePolicy.v2')
  expect(analysisSignificancePolicy.triggerableImportance).toBe('high')
  expect(Object.isFrozen(analysisSignificancePolicy)).toBe(true)
})

it('queues a high-importance value change and carries the signals for the prompt', () => {
  const decision = evaluate()
  expect(decision.decision).toBe('queued')
  expect(decision.reasonCode).toBe('significance-confirmed')
  expect(decision.phase).toBe('correction')
  expect(decision.signals).toEqual([
    { kind: 'actual-changed', eventKey, titleKey: 'cpi', metric: 'actual', importance: 'high', previousValue: '3.1%', value: '3.2%' }
  ])
})

it('stays quiet when the snapshot already carried the same values', () => {
  const decision = evaluate({ previous: new Map([[key('actual'), '3.2%']]) })
  expect(decision).toMatchObject({ decision: 'skipped', reasonCode: 'significance-below-threshold', phase: null, signals: [] })
})

it('ignores medium and low importance even when the value really changed', () => {
  for (const importance of ['medium', 'low'] as const) {
    const decision = evaluate({ current: baseline([official({ importance } as never)]) })
    expect(decision).toMatchObject({ decision: 'skipped', reasonCode: 'significance-below-threshold' })
  }
})

it('drops a below-threshold change when a limit is already reached, and says which limit', () => {
  expect(evaluate({ hourRuns: 3 })).toMatchObject({ decision: 'skipped', reasonCode: 'hour-budget-exhausted' })
  expect(evaluate({ dayRuns: 12 })).toMatchObject({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
  expect(evaluate({ lastAutoRunAt: '2026-10-09T11:45:00.000Z' })).toMatchObject({ decision: 'skipped', reasonCode: 'interval-active' })
})

it('lets a session slot through without a signal but still respects its own reserve', () => {
  const unchanged = new Map([[key('actual'), '3.2%']])
  // The open is the trigger: no data change needed, and neither the hourly gate nor the
  // coalescing interval applies to it.
  expect(evaluate({ triggerKey: 'schedule.asia.open', previous: unchanged, hourRuns: 3, lastAutoRunAt: '2026-10-09T11:59:00.000Z' }))
    .toMatchObject({ decision: 'queued', reasonCode: 'session-slot-asia', signals: [] })
  expect(evaluate({ triggerKey: 'schedule.asia.open', previous: unchanged, scheduledRunsToday: 3 }))
    .toMatchObject({ decision: 'skipped', reasonCode: 'schedule-reserve-exhausted' })
  // Reserved, so the daily total does not reach it — only the line's own reserve can refuse an open.
  expect(evaluate({ triggerKey: 'schedule.asia.open', previous: unchanged, dayRuns: 12 }))
    .toMatchObject({ decision: 'queued', reasonCode: 'session-slot-asia' })
})

it('gives a slot run an identity the ledger cannot confuse with another day', () => {
  const at = (day: string) => evaluate({ triggerKey: 'schedule.asia.open', now: day })
  // Same group, same key, different day: a constant change hash would make the ledger upsert keep
  // the first `created_at`, so the second delivery would be invisible to the run counter and the
  // open would look undelivered forever.
  expect(at('2026-10-09T00:00:00.000Z').changeHash).not.toBe(at('2026-10-10T00:00:00.000Z').changeHash)
  expect(at('2026-10-09T00:00:00.000Z').changeHash).toContain('session-slot:asia:')
  // Each open names itself, so the panel can colour the three of them apart.
  expect(evaluate({ triggerKey: 'schedule.europe.open' }).reasonCode).toBe('session-slot-europe')
  expect(evaluate({ triggerKey: 'schedule.us.open' }).reasonCode).toBe('session-slot-us')
})

it('passes through the keys it does not judge without recording a decision', () => {
  for (const triggerKey of ['manual.refresh', 'manual.initial', 'macro.actual.first-confirmed', 'market-reaction.15m', 'unknown.key']) {
    // No phase either: the caller's freeze payload already decided it.
    expect(evaluate({ triggerKey })).toEqual({ decision: 'queued', reasonCode: null, phase: null, signals: [], changeHash: significanceChangeHash([]) })
  }
})

it('survives a missing predecessor without claiming a change', () => {
  const decision = evaluate({ previous: null, previousAsOf: null })
  expect(decision).toMatchObject({ decision: 'skipped', reasonCode: 'significance-below-threshold', signals: [] })
})

it('hashes content, not the moment it was evaluated', () => {
  const signals: readonly SignificanceSignal[] = [{ kind: 'actual-changed', eventKey, titleKey: 'cpi', metric: 'actual', importance: 'high', previousValue: '3.1%', value: '3.2%' }]
  expect(significanceChangeHash(signals)).toBe(significanceChangeHash([...signals]))
  expect(significanceChangeHash(signals)).not.toBe(significanceChangeHash([{ ...signals[0], value: '3.3%' }]))
  // The same movement evaluated at a later instant keeps its hash, so the ledger dedupes.
  expect(evaluate({ now: '2026-10-09T18:00:00.000Z' }).changeHash).toBe(evaluate().changeHash)
  expect(significanceChangeHash([])).toBe(significanceChangeHash([]))
})

/**
 * provider 日历的发布只在显著偏离预期时进这条流（设计 145 §8 A / 146 §2 选项 3）。
 *
 * 它与宏观序列的变化**共用同一次判定**：同一份预算、同一个 30 分钟合并窗口、同一张账本，所以同一条
 * 发布不会既走 provider 线又走官方线；只有原因码分开，读者问"这次为什么分析了"时答案才是那一条意外。
 */
describe('a provider release that surprised the market', () => {
  const released = (overrides: Record<string, unknown> = {}): MacroCalendarProviderObservation => ({
    eventKey: 'market-observation-1', releaseGroupKey: 'market-observation-1', eventFamily: 'economic-indicator',
    titleKey: '9月核心生产者物价指数(年率)', countryCode: 'US', importance: 'high', periodKey: '2026-M09',
    lifecycleState: 'released', coverage: 'partial', scheduledDate: '2026-10-09', scheduledAt: '2026-10-09T11:30:00.000Z',
    releaseTimeSource: 'date-only', detectedAt: '2026-10-09T11:35:00.000Z', actual: { displayValue: '5.0%' },
    consensus: { displayValue: '4.4%' }, consensusState: 'available', surprise: 'beat',
    providerIds: ['macro-calendar-0xrouter-economic-data'], caveats: ['observed-unverified', 'provider-title-is-display-name'],
    ...overrides
  } as MacroCalendarProviderObservation)
  /** 只带 provider 那一侧：官方事件默认不进来，否则"新事件"本身就会成为一个变化信号。 */
  const route = (provider: readonly MacroCalendarProviderObservation[], official_: readonly MacroEconomicCalendarEventView[] = []): SignificanceBaseline =>
    ({ official: official_, provider, months: ['2026-09', '2026-10'], asOf: now })

  it('queues the run and names the surprise as the reason', () => {
    const decision = evaluate({ current: route([released()]), previous: new Map() })
    expect(decision).toMatchObject({ decision: 'queued', reasonCode: 'provider-surprise-confirmed', phase: 'correction' })
    // 模型拿到的是那条发布本身：实际值 + 市场预期，名字是 provider 自己的那一串。
    expect(decision.signals).toEqual([{
      kind: 'provider-surprise', eventKey: 'market-observation-1', titleKey: '9月核心生产者物价指数(年率)',
      metric: 'actual', importance: 'high', previousValue: null, value: '5.0%', expectedValue: '4.4%'
    }])
  })

  it('stays quiet for a routine release, and says the threshold was the reason', () => {
    const decision = evaluate({ current: route([released({ actual: { displayValue: '199' }, consensus: { displayValue: '200' } })]), previous: new Map() })
    expect(decision).toMatchObject({ decision: 'skipped', reasonCode: 'significance-below-threshold', signals: [] })
  })

  it('counts one release once, so the same surprise cannot spend two runs', () => {
    const seen = new Map([[providerSurpriseBaselineKey(released()), '5.0%']])
    expect(evaluate({ current: route([released()]), previous: seen }))
      .toMatchObject({ decision: 'skipped', reasonCode: 'significance-below-threshold' })
  })

  it('spends one run when a macro change and a provider surprise arrive together', () => {
    const decision = evaluate({ current: route([released()], [official()]), previous: new Map([[key('actual'), '3.1%']]) })
    expect(decision).toMatchObject({ decision: 'queued', reasonCode: 'significance-confirmed' })
    expect(decision.signals.map(signal => signal.kind).sort()).toEqual(['actual-changed', 'provider-surprise'])
  })

  it('obeys the same budget as the official line', () => {
    // 与官方线共享冷却与额度：这是"同一条发布不产生两次运行"的一半（另一半是上一条的 freshness）。
    const input = { current: route([released()]), previous: new Map<string, string | null>() }
    expect(evaluate({ ...input, hourRuns: 3 })).toMatchObject({ decision: 'skipped', reasonCode: 'hour-budget-exhausted' })
    expect(evaluate({ ...input, lastAutoRunAt: '2026-10-09T11:45:00.000Z' })).toMatchObject({ decision: 'skipped', reasonCode: 'interval-active' })
    expect(evaluate(input)).toMatchObject({ decision: 'queued', reasonCode: 'provider-surprise-confirmed' })
  })
})
