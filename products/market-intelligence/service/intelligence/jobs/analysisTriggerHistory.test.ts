import { expect, it } from 'vitest'
import { toTriggerHistory } from './registerMarketAnalysisRuntime'

const at = '2026-10-09T12:00:00.000Z'

it('keeps the automatic ledger rows out of the item path', () => {
  // The session slots replaced the 6-hour startup catch-up, so `startup.refresh` is no longer a key
  // the gate judges and its historical rows fall back to the item path's phase, exactly like any
  // other key this plan does not own.
  for (const triggerKey of ['calendar.refresh', 'schedule.asia.open', 'schedule.europe.open', 'schedule.us.open']) {
    expect(toTriggerHistory({ triggerKey, createdAt: at })).toEqual({ phase: 'correction', triggeredAt: at })
  }
  expect(toTriggerHistory({ triggerKey: 'startup.refresh', createdAt: at })).toEqual({ phase: 'initial', triggeredAt: at })
})

it('leaves every pre-existing key exactly as it was', () => {
  // `manual.*` rows genuinely reach the ledger through recovery; re-phasing them would let
  // item triggers fire earlier than the cooldown allows.
  expect(toTriggerHistory({ triggerKey: 'manual.refresh', createdAt: at }).phase).toBe('initial')
  expect(toTriggerHistory({ triggerKey: 'manual.initial', createdAt: at }).phase).toBe('initial')
  expect(toTriggerHistory({ triggerKey: 'macro.actual.first-confirmed', createdAt: at }).phase).toBe('initial')
  expect(toTriggerHistory({ triggerKey: 'market-reaction.15m', createdAt: at }).phase).toBe('review')
  for (const triggerKey of ['severity-confirmed', 'cooldown-active', 'restart-expired', 'anything.else']) {
    expect(toTriggerHistory({ triggerKey, createdAt: at }).phase).toBe('initial')
  }
})

it('carries the row time through unchanged', () => {
  expect(toTriggerHistory({ triggerKey: 'calendar.refresh', createdAt: at }).triggeredAt).toBe(at)
})
