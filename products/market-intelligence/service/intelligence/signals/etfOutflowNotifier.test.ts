import { describe, expect, it, vi } from 'vitest'

import { notificationDedupeBuilders } from '@platform/notifications/contracts/notificationDedupeKeys'

import { etfOutflowOutletPolicy } from '../../../contracts/etfFlows'
import { buildEtfOutflowSignal } from './etfOutflowSignal'
import { buildEtfOutflowSignalRequest, etfOutflowSignalHandoff, notifyEtfOutflowSignals } from './etfOutflowNotifier'

const asOf = '2026-09-01T12:00:00.000Z'

/** 生产默认是同一张表；用例显式传一份「开着」的表，免得以后总闸一关把发送用例也一起关掉。 */
const OPEN = { panel: true, notification: true } as const

function rows(netFlows: readonly number[]) {
  return netFlows.map((netFlowUsd, index) => ({
    tradingDate: `2026-08-${String(25 + index).padStart(2, '0')}`,
    netFlowUsd,
    observedAt: `2026-08-${String(25 + index).padStart(2, '0')}T00:00:00.000Z`
  }))
}

function outflowSignal() {
  const signal = buildEtfOutflowSignal({ asset: 'btc', rows: rows([10, -40_000_000, -50_000_000, -60_000_000]), asOf })
  expect(signal?.readiness).toBe('available')
  expect(signal?.severity).toBeDefined()
  return signal!
}

describe('ETF outflow signal notification', () => {
  it('submits the same event id and lets the platform build the key from parameters', () => {
    const signal = outflowSignal()
    const request = buildEtfOutflowSignalRequest(signal)

    expect(request).toBeDefined()
    expect(request!.eventTypeId).toBe('market-intelligence.signal.triggered')
    expect(request!.producerId).toBe('market-intelligence.etf-flow-refresh')
    // The caller never carries a key of its own: the request holds the parameters only.
    expect('dedupeKey' in request!).toBe(false)
    expect(request!.dedupeVars).toMatchObject({ builder: 'moduleSignal', moduleId: 'etf-flows', ruleId: 'etf-outflow-3d', asset: 'btc', cadence: 'trading-day' })
    // The platform's builder turns those parameters into its own key; the caller never writes one.
    const platformKey = notificationDedupeBuilders.moduleSignal(request!.dedupeVars)
    expect(platformKey).toBe('module-signal:ETF:etf-outflow-3d:BTC:2026-08-28')
    // Same bucket, same key: a late-arriving flow for that day must not ring a second time.
    expect(notificationDedupeBuilders.moduleSignal({ ...request!.dedupeVars, observedAt: '2026-08-28T18:00:00.000Z' })).toBe(platformKey)
    // The notification describes the trading day, not the instant the refresh ran.
    expect(request!.occurredAt).toBe(signal.observedAt)
    // No deeplink and no action: the shell cannot open a product page today, so a button here
    // would be a pointer that goes nowhere. The notification records the fact, nothing more.
    expect(request!.deeplink).toBeUndefined()
    expect(request!.actions).toEqual([])
  })

  it('says nothing while the window is not complete: "not judged yet" is not an event', () => {
    const signal = buildEtfOutflowSignal({ asset: 'btc', rows: rows([10, -40_000_000]), asOf })
    expect(signal?.readiness).toBe('unavailable')
    expect(buildEtfOutflowSignalRequest(signal!)).toBeUndefined()
  })

  it('ignores signals from another rule: this notifier owns one event, not every signal', () => {
    const foreign = { ...outflowSignal(), ruleId: 'open-interest-spike' }
    expect(buildEtfOutflowSignalRequest(foreign)).toBeUndefined()
  })

  // The outlet table is pinned here, not borrowed from production: the switch says whether the
  // reader may be told, and that answer must not be decided by whoever last edited the refresh.
  it('stays shut when the panel outlet is closed, whatever the notification flag says', async () => {
    const submit = vi.fn(async () => ({ kind: 'recorded' } as never))
    await notifyEtfOutflowSignals(submit, [outflowSignal()], { panel: false, notification: true })
    expect(submit).not.toHaveBeenCalled()

    await notifyEtfOutflowSignals(submit, [outflowSignal()], { panel: true, notification: true })
    expect(submit).toHaveBeenCalledTimes(1)
  })

  // One case pins what ships: the chip and the notification open and close together.
  it('ships both outlets open together', () => {
    expect(etfOutflowOutletPolicy).toEqual({ panel: true, notification: true })
  })

  it('submits at most one request per signal and never lets a submit failure reach the refresh', async () => {
    const submit = vi.fn(async () => { throw new Error('notification store is down') })
    const signal = outflowSignal()

    await expect(notifyEtfOutflowSignals(submit, [signal], OPEN)).resolves.toBeUndefined()
    expect(submit).toHaveBeenCalledTimes(1)

    await expect(notifyEtfOutflowSignals(undefined, [signal], OPEN)).resolves.toBeUndefined()
  })

  // 一个事实一个开关：牌子还没上时，通知即使自己写着「开」也不许发。这是这次空档的直接教训——
  // 两条路各上了各的，读者收到一条打开看板找不到的通知。
  it('sends nothing while the panel outlet is closed, even when the notification outlet says open', async () => {
    const submit = vi.fn(async () => ({ kind: 'accepted' as const, recordId: 'record-1', levels: [] }))
    await notifyEtfOutflowSignals(submit, [outflowSignal()], { panel: false, notification: true })
    expect(submit).not.toHaveBeenCalled()
  })

  // 出厂状态：开关两个出口都开着。这条钉的是「别让总闸在没人注意时被关回去」。
  it('ships with the switch open, so the ordinary call submits', async () => {
    const submit = vi.fn(async () => ({ kind: 'accepted' as const, recordId: 'record-1', levels: [] }))
    await notifyEtfOutflowSignals(submit, [outflowSignal()])
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the notification outlet itself is closed', async () => {
    const submit = vi.fn(async () => ({ kind: 'accepted' as const, recordId: 'record-1', levels: [] }))
    await notifyEtfOutflowSignals(submit, [outflowSignal()], { panel: true, notification: false })
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('the refresh hand-off', () => {
  // 交接点只回答一个问题：有没有提交入口。开关在通知层，别在装配处再判一次。
  it('hands nothing out when the host has no notification entry', () => {
    expect(etfOutflowSignalHandoff(undefined)).toEqual({})
  })

  it('hands the signals out and awaits the submission', async () => {
    const submit = vi.fn(async () => ({ kind: 'accepted' as const, recordId: 'record-1', levels: [] }))
    const handoff = etfOutflowSignalHandoff(submit)

    await handoff.notifySignals!([outflowSignal()])

    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0]![0]).toMatchObject({ eventTypeId: 'market-intelligence.signal.triggered' })
  })
})
