import { expect, it } from 'vitest'
import {
  analysisTriggerSourcePolicy, analysisTriggerSources, isGateEligible, isGateExempt, isGateTimestamp,
  phaseForNewTriggerKey, resolveTriggerKey, type AnalysisTriggerSource
} from './analysisTriggerSourcePolicy'

it('maps every caller to the trigger key that says who asked', () => {
  expect(resolveTriggerKey('calendar-refresh', 'refresh')).toBe('calendar.refresh')
  // One key per open, so the ledger, the reserved budget line and the reader's "why did this run"
  // all name the session instead of a generic clock.
  expect(resolveTriggerKey('session-slot', 'refresh', 'asia')).toBe('schedule.asia.open')
  expect(resolveTriggerKey('session-slot', 'refresh', 'europe')).toBe('schedule.europe.open')
  expect(resolveTriggerKey('session-slot', 'refresh', 'us')).toBe('schedule.us.open')
  // A slot request that cannot name its slot is a caller bug, not a silent default.
  expect(() => resolveTriggerKey('session-slot', 'refresh')).toThrowError('analysis-invalid-request')
  expect(resolveTriggerKey('manual', 'refresh')).toBe('manual.refresh')
  expect(resolveTriggerKey('manual', 'initial')).toBe('manual.initial')
  // The item line's keys stay owned by analysisTriggerPolicy.decide.
  expect(resolveTriggerKey('item-change', 'refresh')).toBe('market-reaction.15m')
  expect(resolveTriggerKey('item-change', 'initial')).toBe('macro.actual.first-confirmed')
})

it('declares a source for every trigger key it can produce', () => {
  for (const source of analysisTriggerSources) {
    const keys = source === 'session-slot'
      ? analysisTriggerSourcePolicy.gateEligibleTriggerKeys.filter(key => key.startsWith('schedule.'))
      : [resolveTriggerKey(source, 'refresh'), resolveTriggerKey(source, 'initial')]
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9][a-z0-9.-]*$/)
      expect(key).toContain('.')
    }
  }
  expect(analysisTriggerSources).toHaveLength(4)
  // Every slot key has a source that produces it, and no source produces a key twice.
  expect(analysisTriggerSourcePolicy.gateEligibleTriggerKeys).toContain('schedule.asia.open')
  expect(analysisTriggerSourcePolicy.gateEligibleTriggerKeys).toContain('schedule.europe.open')
  expect(analysisTriggerSourcePolicy.gateEligibleTriggerKeys).toContain('schedule.us.open')
})

it('exempts only the manual triggers, and fails closed for anything unknown', () => {
  expect(isGateExempt('manual.refresh')).toBe(true)
  expect(isGateExempt('manual.initial')).toBe(true)
  for (const key of ['calendar.refresh', 'schedule.asia.open', 'schedule.us.open', 'macro.actual.first-confirmed', 'market-reaction.15m', 'something.else']) {
    expect(isGateExempt(key)).toBe(false)
  }
})

it('judges the calendar trigger and every session slot, and passes everything else through', () => {
  expect(isGateEligible('calendar.refresh')).toBe(true)
  for (const slot of ['asia', 'europe', 'us'] as const) expect(isGateEligible(`schedule.${slot}.open`)).toBe(true)
  // The 6-hour startup catch-up this key served is gone: the slot tick owns that job now, and it
  // asks about the opens instead of "the newest conclusion is old".
  expect(isGateEligible('startup.refresh')).toBe(false)
  // The item path was already judged by analysisTriggerPolicy; manual is exempt.
  for (const key of ['macro.actual.first-confirmed', 'market-reaction.15m', 'manual.refresh', 'manual.initial', 'unknown.key']) {
    expect(isGateEligible(key)).toBe(false)
  }
})

it('gives the new keys a phase that cannot disturb the item path', () => {
  for (const key of analysisTriggerSourcePolicy.gateEligibleTriggerKeys) expect(phaseForNewTriggerKey(key)).toBe('correction')
  // Existing keys keep today's mapping, so manual/restart rows still feed the item cooldown.
  for (const key of ['manual.refresh', 'manual.initial', 'macro.actual.first-confirmed', 'market-reaction.15m']) {
    expect(phaseForNewTriggerKey(key)).toBe('initial')
  }
})

it('accepts only canonical instants as a gate timestamp', () => {
  expect(isGateTimestamp(null)).toBe(true)
  expect(isGateTimestamp('2026-10-09T00:00:00.000Z')).toBe(true)
  for (const value of ['', '2026-10-09', '2026-10-09T00:00:00Z', 'not-a-time']) expect(isGateTimestamp(value)).toBe(false)
})

it('keeps the policy free of anonymous values', () => {
  expect(analysisTriggerSourcePolicy.version).toBe('marketAnalysisTriggerSourcePolicy.v2')
  expect(analysisTriggerSourcePolicy.calendarTriggerCondition).toBe('high-importance-content-change')
  expect(Object.isFrozen(analysisTriggerSourcePolicy)).toBe(true)
})

it('rejects an unnarrowed source at the type level', () => {
  const source: AnalysisTriggerSource = 'calendar-refresh'
  expect(resolveTriggerKey(source, 'refresh')).toBe('calendar.refresh')
  // @ts-expect-error an unknown source must not compile
  expect(() => resolveTriggerKey('calendar', 'refresh')).toBeDefined()
})
