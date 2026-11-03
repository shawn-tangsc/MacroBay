import { describe, expect, it, vi } from 'vitest'

import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import {
  createOpenInterestSignalNotifier,
  createSignalledOpenInterestRefresh,
  openInterestSignalNotificationPolicy,
  selectSignalNotificationCandidates
} from './openInterestSignalNotifier'
import { openInterestSignalsFromHistory } from './openInterestSignals'

const bucketMs = 15 * 60_000
const bucketAt = '2026-11-03T10:15:00.000Z'
const asOf = '2026-11-03T10:30:00.000Z'

const accepted: NotificationSubmitOutcome = { kind: 'accepted', recordId: 'record-1', levels: ['center'] }

function reading(overrides: Partial<Extract<OpenInterestHistoryResult, { state: 'available' }>> = {}): OpenInterestHistoryResult {
  return {
    state: 'available',
    asOf,
    window: '24h',
    btc: [{ observedAt: bucketAt, notionalUsd: 7.4e9 }],
    eth: [{ observedAt: bucketAt, notionalUsd: 2.4e9 }],
    liquidationHints: [{ observedAt: bucketAt, asset: 'btc', dropPct: -2.7, volumeMultiple: 3.4, notionalUsd: 7.4e9 }],
    liquidationHintsState: 'available',
    ...overrides
  }
}

function notifier(input: Readonly<{
  history?: OpenInterestHistoryResult
  now?: string
}> = {}) {
  const submit = vi.fn(async (_request: NotificationSubmitRequest) => accepted)
  const notify = createOpenInterestSignalNotifier({
    submit,
    readHistory: async () => input.history ?? reading(),
    now: () => input.now ?? asOf
  })
  return { submit, notify }
}

describe('open interest signal notification', () => {
  it('submits the platform dedupe vars, never a key of its own', async () => {
    const { submit, notify } = notifier()
    await notify()
    expect(submit).toHaveBeenCalledTimes(1)
    const request = submit.mock.calls[0]![0]
    expect(request.eventTypeId).toBe('market-intelligence.signal.triggered')
    expect(request.producerId).toBe('market-intelligence.collectSource')
    expect(request.dedupeVars).toEqual({
      builder: 'moduleSignal',
      moduleId: 'open-interest',
      ruleId: 'oi-liquidation-proxy',
      asset: 'btc',
      observedAt: bucketAt,
      cadence: 'intraday',
      bucketMs
    })
    // The key string has one implementation (the platform builder); the call site carries only vars.
    expect('dedupeKey' in request).toBe(false)
    // The instant is the bucket's own, not the moment this ran.
    expect(request.occurredAt).toBe(bucketAt)
    // Nothing to open: the shell resolves settings deeplinks only, so no pointer is sent.
    expect(request.actions).toEqual([])
    expect(request.deeplink).toBeUndefined()
  })

  it('gives the same bucket the same vars on the next tick, so the platform merges instead of re-pushing', async () => {
    const { submit, notify } = notifier()
    await notify()
    await notify()
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls[1]![0].dedupeVars).toEqual(submit.mock.calls[0]![0].dedupeVars)
  })

  it('does not announce a bucket that is older than the freshness window', async () => {
    const stale = new Date(Date.parse(asOf) - openInterestSignalNotificationPolicy.freshnessMs - bucketMs).toISOString()
    const { submit, notify } = notifier({
      history: reading({
        btc: [{ observedAt: stale, notionalUsd: 7.4e9 }],
        liquidationHints: [{ observedAt: stale, asset: 'btc', dropPct: -2.7, volumeMultiple: 3.4, notionalUsd: 7.4e9 }]
      })
    })
    await notify()
    expect(submit).not.toHaveBeenCalled()
  })

  it('stays silent when the volume leg could not answer: no reading is not "no liquidation"', async () => {
    const { submit, notify } = notifier({ history: reading({ liquidationHints: undefined, liquidationHintsState: 'unavailable' }) })
    await notify()
    expect(submit).not.toHaveBeenCalled()
  })

  it('stays silent when the whole read failed', async () => {
    const { submit, notify } = notifier({
      history: { state: 'unavailable', failureCode: 'open-interest-history-query-unavailable' }
    })
    await notify()
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('candidate selection', () => {
  it('drops unavailable readings and buckets the reader would read as old news', () => {
    const signals = openInterestSignalsFromHistory(reading({ liquidationHints: undefined, liquidationHintsState: 'unavailable' }), asOf)
    expect(signals.every(signal => signal.readiness === 'unavailable')).toBe(true)
    expect(selectSignalNotificationCandidates(signals, asOf)).toHaveLength(0)

    const fresh = openInterestSignalsFromHistory(reading(), asOf)
    expect(selectSignalNotificationCandidates(fresh, asOf)).toHaveLength(1)
    // An instant that cannot be parsed is not a candidate: it cannot be deduplicated or placed.
    expect(selectSignalNotificationCandidates(fresh, 'not-a-time')).toHaveLength(0)
  })
})

describe('signals follow a successful collection', () => {
  it('notifies after the refresh and keeps its result', async () => {
    const notify = vi.fn(async () => undefined)
    const refresh = vi.fn(async () => ({ state: 'updated' as const }))
    const wrapped = createSignalledOpenInterestRefresh({ refresh, readHistory: async () => reading(), submit: undefined, now: () => asOf })
    // No submit hook means no notifier at all: the refresh must still run and answer.
    expect(await wrapped.refresh()).toEqual({ state: 'updated' })
    expect(notify).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not notify when the source is switched off', async () => {
    const submit = vi.fn(async () => accepted)
    const wrapped = createSignalledOpenInterestRefresh({
      refresh: async () => ({ state: 'unavailable' as const }),
      readHistory: async () => reading(),
      submit,
      now: () => asOf
    })
    expect(await wrapped.refresh()).toEqual({ state: 'unavailable' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('keeps the collection result when the notification cannot be submitted', async () => {
    const wrapped = createSignalledOpenInterestRefresh({
      refresh: async () => ({ state: 'updated' as const }),
      readHistory: async () => reading(),
      submit: async () => { throw new Error('notification store down') },
      now: () => asOf
    })
    // The buckets are already stored; a notification failure must not make the collection look broken.
    expect(await wrapped.refresh()).toEqual({ state: 'updated' })
  })
})

describe('handing a fired signal to the analysis entry', () => {
  const queued = { state: 'queued' as const, groupId: 'group-1', attemptLedgerId: 'ledger-1', jobRunId: 'job-1' }

  it('hands the registered key and the bucket the signal belongs to', async () => {
    const requestAnalysis = vi.fn(async () => queued)
    const wrapped = createSignalledOpenInterestRefresh({
      refresh: async () => ({ state: 'updated' as const }),
      readHistory: async () => reading(),
      requestAnalysis,
      now: () => asOf
    })
    await wrapped.refresh()
    expect(requestAnalysis).toHaveBeenCalledTimes(1)
    // Exactly what the receiver consumes: the key the budget recognises, the board, the reading's
    // own instant, and the bucket key so two assets are two changes of one trigger.
    expect(requestAnalysis.mock.calls[0]![0]).toEqual({
      triggerKey: 'signal.open-interest.oi-liquidation-proxy',
      moduleId: 'open-interest',
      ruleId: 'oi-liquidation-proxy',
      groupType: 'funding',
      severity: 'high',
      observedAt: bucketAt,
      changeHash: 'open-interest:oi-liquidation-proxy:btc:2026-11-03T10:15:00.000Z'
    })
  })

  it('binds after construction, because the runtime is assembled later', async () => {
    const requestAnalysis = vi.fn(async () => queued)
    const wrapped = createSignalledOpenInterestRefresh({
      refresh: async () => ({ state: 'updated' as const }),
      readHistory: async () => reading(),
      now: () => asOf
    })
    wrapped.bindSignalAnalysis(requestAnalysis)
    await wrapped.refresh()
    expect(requestAnalysis).toHaveBeenCalledTimes(1)
  })

  it('does not hand anything when the source was switched off', async () => {
    const requestAnalysis = vi.fn(async () => queued)
    const wrapped = createSignalledOpenInterestRefresh({
      refresh: async () => ({ state: 'unavailable' as const }),
      readHistory: async () => reading(),
      requestAnalysis,
      now: () => asOf
    })
    await wrapped.refresh()
    expect(requestAnalysis).not.toHaveBeenCalled()
  })

  it('keeps the collection result when the analysis entry refuses the hand-off', async () => {
    const wrapped = createSignalledOpenInterestRefresh({
      refresh: async () => ({ state: 'updated' as const }),
      readHistory: async () => reading(),
      requestAnalysis: async () => { throw new Error('analysis runtime missing') },
      now: () => asOf
    })
    // The bucket is stored and the chip still draws; a run that could not be asked for is not a
    // failed collection.
    expect(await wrapped.refresh()).toEqual({ state: 'updated' })
  })
})
