import { describe, expect, it } from 'vitest'

import { isModuleSignal, signalCooldown, signalWindow } from '../../../contracts/moduleSignal'
import { etfFlowPolicy } from '../../../contracts/etfFlows'
import { buildEtfOutflowSignal, etfOutflowSignalPolicy } from './etfOutflowSignal'
import { isSignalTriggerKey } from '../analysis/analysisTriggerSourcePolicy'
import { signalTriggerKey } from '../../../contracts/moduleSignal'

const threshold = etfFlowPolicy.signalOutflowUsd

function flows(values: readonly number[], firstDate = '2026-10-26') {
  const start = Date.parse(`${firstDate}T00:00:00.000Z`)
  return values.map((netFlowUsd, index) => ({
    tradingDate: new Date(start + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10),
    netFlowUsd,
    observedAt: new Date(start + index * 24 * 60 * 60 * 1_000 + 20 * 60 * 60 * 1_000).toISOString()
  }))
}

const signalFor = (values: readonly number[], asset: 'btc' | 'eth' = 'btc') =>
  buildEtfOutflowSignal({ asset, rows: flows(values), asOf: '2026-10-29T12:00:00.000Z' })

describe('ETF outflow signal', () => {
  it('speaks when three trading days of outflow clear the threshold', () => {
    const signal = signalFor([threshold / 3, threshold / 3, threshold / 3])!
    expect(isModuleSignal(signal)).toBe(true)
    expect(signal).toMatchObject({
      moduleId: 'etf-flows', ruleId: 'etf-outflow-3d', asset: 'btc', severity: 'medium', readiness: 'available'
    })
  })

  it('says nothing about a quiet three days', () => {
    expect(signalFor([threshold / 4, threshold / 4, threshold / 4])).toBeUndefined()
  })

  it('escalates to high at three times the threshold, one number rather than a second judgement', () => {
    expect(signalFor([threshold, threshold, threshold])!.severity).toBe('high')
  })

  it('treats exactly the threshold as an outflow already', () => {
    expect(signalFor([threshold / 3, threshold / 3, threshold / 3])).toBeDefined()
  })

  it('answers unavailable — not a smaller sum — when only two days of flows exist', () => {
    const signal = signalFor([threshold, threshold])!
    expect(signal.readiness).toBe('unavailable')
    expect(signal.values).toMatchObject({ coveredDays: 2, requiredDays: 3 })
    expect(isModuleSignal(signal)).toBe(true)
  })

  it('says nothing at all without any rows', () => {
    expect(buildEtfOutflowSignal({ asset: 'btc', rows: [], asOf: '2026-10-29T12:00:00.000Z' })).toBeUndefined()
  })

  it('names the days it summed rather than the day it ran', () => {
    const signal = signalFor([threshold, threshold, threshold])!
    expect(signal.observedAt).toBe('2026-10-28T00:00:00.000Z')
  })

  it('deduplicates on the trading date, so a late-arriving flow lands on the day it describes', () => {
    const signal = signalFor([threshold, threshold, threshold])!
    expect(signal.dedupeKey).toBe('etf-flows:etf-outflow-3d:btc:2026-10-28')
  })

  it('buckets a flow that only arrived the next day on the day it describes, not the day it landed', () => {
    // The third day's flow reaches the store two days late. The card and the conclusion must still
    // date it as that trading day: the bucket is the data's own date, so the next day's arrival
    // does not invent a second bucket for the same three days.
    const rows = flows([threshold, threshold, threshold]).map((row, index) =>
      index === 2 ? { ...row, observedAt: '2026-10-30T03:00:00.000Z' } : row)
    const signal = buildEtfOutflowSignal({ asset: 'btc', rows, asOf: '2026-10-30T04:00:00.000Z' })!

    expect(signal.observedAt).toBe('2026-10-28T00:00:00.000Z')
    expect(signal.dedupeKey).toBe('etf-flows:etf-outflow-3d:btc:2026-10-28')
    expect(signal.dedupeKey).not.toContain('2026-10-30')
  })

  it('reads the same trading day however the caller ordered the rows', () => {
    // Nothing in the input promises an order, and nothing checks it: the rule has to find the
    // newest trading date itself. Sorted by arrival instead, a late flow would take the "newest"
    // slot and move the bucket to the day it landed — the chip would still draw, with a wrong date.
    const rows = flows([threshold, threshold, threshold])
    const arrivals = [rows[0]!, { ...rows[1]!, observedAt: '2026-10-30T03:00:00.000Z' }, rows[2]!]
    const ordered = buildEtfOutflowSignal({ asset: 'btc', rows, asOf: '2026-10-30T04:00:00.000Z' })!
    const shuffled = buildEtfOutflowSignal({ asset: 'btc', rows: arrivals, asOf: '2026-10-30T04:00:00.000Z' })!
    const reversed = buildEtfOutflowSignal({ asset: 'btc', rows: [...arrivals].reverse(), asOf: '2026-10-30T04:00:00.000Z' })!

    expect(shuffled.observedAt).toBe(ordered.observedAt)
    expect(shuffled.dedupeKey).toBe(ordered.dedupeKey)
    expect(reversed.dedupeKey).toBe(ordered.dedupeKey)
    expect(shuffled.values).toEqual(ordered.values)
    expect(shuffled.observedAt).toBe('2026-10-28T00:00:00.000Z')
  })

  it('keys each asset separately', () => {
    expect(signalFor([threshold, threshold, threshold], 'eth')!.dedupeKey).toContain(':eth:')
  })

  it('declares a trading-day cadence, which is what makes its window and cooldown a day', () => {
    const signal = signalFor([threshold, threshold, threshold])!
    expect(signal.cadence).toEqual({ kind: 'trading-day' })
    expect(signalCooldown(signal.cadence)).toEqual({ kind: 'trading-days', days: 1 })
    expect(signalWindow(signal.cadence, etfFlowPolicy.signalWindowDays)).toMatchObject({ unit: 'trading-days', amount: 3 })
  })

  it('owns its event rather than borrowing an existing trigger key', () => {
    expect(signalFor([threshold, threshold, threshold])!.triggerOwner).toBe('module-signal')
  })

  it('carries the coverage numbers rather than a completeness flag', () => {
    const signal = signalFor([threshold, threshold, threshold])!
    expect(signal.values).toEqual({
      cumulativeNetFlowUsd: threshold * 3,
      coveredDays: 3,
      requiredDays: etfFlowPolicy.signalWindowDays,
      thresholdUsd: threshold
    })
  })

  it('keeps the rule name independent of its module', () => {
    expect(etfOutflowSignalPolicy.ruleId).toBe('etf-outflow-3d')
    expect(etfOutflowSignalPolicy.moduleId).toBe('etf-flows')
  })
})
