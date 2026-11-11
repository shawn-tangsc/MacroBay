// @vitest-environment happy-dom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import type { ModuleSignal, SignalWindow } from '../../../contracts/moduleSignal'
import type { ModuleSignalAnalysisRead } from '../../../service/intelligence/analysis/signalAnalysisRead'
import type { DashboardPositioningViewState } from './dashboardOpenInterestModel'
import { useDashboardOpenInterest } from './useDashboardOpenInterest'

const asOf = '2026-10-31T14:45:00.000Z'
/** A successful read that holds nothing: the rule had nothing to say. */
const emptyRead: ModuleSignalAnalysisRead = { state: 'available', signals: [], droppedInvalid: 0, analysis: {} }
const at = '2026-10-31T14:30:00.000Z'

const history: OpenInterestHistoryResult = {
  state: 'available', asOf, window: '24h',
  btc: [{ observedAt: at, notionalUsd: 7.4e9 }],
  eth: [{ observedAt: at, notionalUsd: 2.4e9 }],
  liquidationHintsState: 'available'
}

const signal: ModuleSignal = {
  version: '1', moduleId: 'open-interest', ruleId: 'oi-liquidation-proxy', asset: 'btc',
  severity: 'high', observedAt: at,
  cadence: { kind: 'intraday', bucketMs: 15 * 60_000 },
  values: { dropPct: -2.7, volumeMultiple: 3.4, notionalUsd: 7.4e9 },
  dedupeKey: 'open-interest:oi-liquidation-proxy:btc:2026-10-31T14:30:00.000Z',
  readiness: 'available', triggerOwner: 'module-signal'
}

let latest: DashboardPositioningViewState | undefined

function Probe(props: Readonly<{
  signalClient: { query: (input: { asOf: string }) => Promise<ModuleSignalAnalysisRead> }
  window?: '24h' | '7d'
  client?: { query: (input: { asOf: string; window: '24h' | '7d' }) => Promise<OpenInterestHistoryResult> }
  disabled?: boolean
  waiting?: boolean
}>) {
  latest = useDashboardOpenInterest({
    // 历史读按请求的窗口回，形状要与窗口一致（7 天视图不是 24 小时那份）。
    client: props.client ?? { query: async input => ({ ...history, window: input.window }) },
    signalClient: props.signalClient,
    now: () => new Date(asOf),
    window: props.window ?? '24h',
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    ...(props.waiting === undefined ? {} : { waiting: props.waiting })
  })
  return null
}

const roots: Array<ReturnType<typeof createRoot>> = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  latest = undefined
})

async function renderProbe(
  signalClient: { query: (input: { asOf: string }) => Promise<ModuleSignalAnalysisRead> },
  window?: '24h' | '7d',
  client?: { query: (input: { asOf: string; window: '24h' | '7d' }) => Promise<OpenInterestHistoryResult> }
) {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(createElement(Probe, { signalClient, ...(window === undefined ? {} : { window }), ...(client === undefined ? {} : { client }) }))
  })
  return latest
}

/** 规则这次没命中（24 小时判定为空）：牌子该是 `hidden`。 */
const emptyReadClient = { query: async (): Promise<ModuleSignalAnalysisRead> => emptyRead }

function ReadProbe(props: Readonly<{ client: { query: (input: { asOf: string; window: '24h' | '7d' }) => Promise<OpenInterestHistoryResult> } }>) {
  latest = useDashboardOpenInterest({
    client: props.client,
    signalClient: { query: async () => emptyRead },
    now: () => new Date(asOf),
    window: '24h'
  })
  return null
}

async function renderReadProbe(client: { query: (input: { asOf: string; window: '24h' | '7d' }) => Promise<OpenInterestHistoryResult> }) {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(createElement(ReadProbe, { client })) })
  return latest
}

describe('positioning hook first read', () => {
  it('stays loading while the read is in flight, before the card has anything to say', async () => {
    let settle: ((value: OpenInterestHistoryResult) => void) | undefined
    const client = { query: () => new Promise<OpenInterestHistoryResult>((resolve) => { settle = resolve }) }
    const state = await renderReadProbe(client)
    // Nothing has come back yet, so waiting is its own state. Drawing a failure or an empty card
    // here is what makes a card flash "could not read" before the first reading arrives.
    expect(state).toMatchObject({ state: 'loading' })
    await act(async () => { settle!(history) })
    expect(latest).toMatchObject({ state: 'available' })
  })

  it('becomes a failed read only when the read actually rejects, and the card can retry', async () => {
    const state = await renderReadProbe({ query: async () => { throw new Error('ipc down') } })
    expect(state).toMatchObject({ state: 'unavailable' })
    expect(typeof (state as { onReload?: unknown }).onReload).toBe('function')
  })
})

describe('positioning hook signal wiring', () => {
  it('puts the rule’s chip on the card from the same read the panel already makes', async () => {
    const query = vi.fn(async (): Promise<ModuleSignalAnalysisRead> => ({
      state: 'available',
      signals: [{ signal, window: { unit: 'buckets' as const, amount: 1, bucketMs: 15 * 60_000, upperBoundMs: 15 * 60_000 } }],
      droppedInvalid: 0,
      analysis: { [signal.dedupeKey]: { analysisOffByReader: false, analysisState: 'not-triggered' } }
    }))
    const state = await renderProbe({ query })
    // 牌子固定按 24 小时判，窗口不跟着页签走（用户 2026-11-08 10:4x 定）。
    expect(query).toHaveBeenCalledWith({ asOf })
    expect(state).toMatchObject({ state: 'available', signal: { state: 'alert', dropPct: -2.7 } })
  })

  it('keeps the chip on 24 hours in both views: history belongs to the chart, status to the title', async () => {
    // 同一份信号数据、两个页签：牌子都出现，而且在两种视图下读的都是同一份 24 小时判定。
    const query = vi.fn(async (_input: { asOf: string }): Promise<ModuleSignalAnalysisRead> => ({
      state: 'available',
      signals: [{ signal, window: { unit: 'buckets' as const, amount: 1, bucketMs: 15 * 60_000, upperBoundMs: 15 * 60_000 } }],
      droppedInvalid: 0,
      analysis: { [signal.dedupeKey]: { analysisOffByReader: false, analysisState: 'not-triggered' } }
    }))
    const week = await renderProbe({ query }, '7d')
    const day = await renderProbe({ query }, '24h')
    expect(week).toMatchObject({ state: 'available', signal: { state: 'alert' } })
    expect(day).toMatchObject({ state: 'available', signal: { state: 'alert' } })
    // 两次都只传 asOf：7 天视图也没有把窗口带给牌子的判定。
    for (const [input] of query.mock.calls) expect(input).toEqual({ asOf })
  })

  it('draws a 7-day-only hit on the chart and keeps it off the chip', async () => {
    // 用户 11-08 10:4x：历史归图，现状归标题。同一条命中，图上有、牌子上没有。
    const hint = {
      observedAt: '2026-10-28T14:30:00.000Z', asset: 'btc' as const, direction: 'long' as const,
      dropPct: -2.5, pricePct: -1.4, volumeMultiple: 3.1, notionalUsd: 8.9e9
    }
    const client = {
      query: async (input: Readonly<{ asOf: string; window: '24h' | '7d' }>): Promise<OpenInterestHistoryResult> => ({
        ...history,
        window: input.window,
        btc: [{ observedAt: at, notionalUsd: 7.4e9 }],
        liquidationHints: input.window === '7d' ? [hint] : [],
        liquidationHintsTotal: input.window === '7d' ? 1 : 0
      })
    }
    const week = await renderProbe(emptyReadClient, '7d', client)
    expect(week).toMatchObject({ state: 'available', signal: { state: 'hidden' } })
    if (week === undefined || week.state !== 'available') throw new Error('expected available')
    expect(week.hints).toHaveLength(1)

    // 同一份数据切到 24 小时：图上那条落在窗口外，只有 0 个点。
    const day = await renderProbe(emptyReadClient, '24h', client)
    if (day === undefined || day.state !== 'available') throw new Error('expected available')
    expect(day.hints).toHaveLength(0)
  })

  it('chips the same hit on the 24-hour view, because the chip is the 24-hour status', async () => {
    const query = vi.fn(async (): Promise<ModuleSignalAnalysisRead> => ({
      state: 'available',
      signals: [{ signal, window: { unit: 'buckets' as const, amount: 1, bucketMs: 15 * 60_000, upperBoundMs: 15 * 60_000 } }],
      droppedInvalid: 0,
      analysis: { [signal.dedupeKey]: { analysisOffByReader: false, analysisState: 'not-triggered' } }
    }))
    const day = await renderProbe({ query }, '24h')
    expect(day).toMatchObject({ state: 'available', signal: { state: 'alert' } })
  })

  it('draws no chip when the rule says nothing', async () => {
    const state = await renderProbe({ query: async () => emptyRead })
    expect(state).toMatchObject({ state: 'available', signal: { state: 'hidden' } })
  })

  it('keeps the series and says the read failed: a chip cannot claim "nothing happened"', async () => {
    const state = await renderProbe({ query: async () => { throw new Error('ipc down') } })
    // The series is intact; only the chip changes state, and it says the read failed rather than
    // disappearing into the same shape a quiet market produces.
    expect(state).toMatchObject({ state: 'available', signal: { state: 'unreadable', failureCode: 'query-failed' } })
  })
})
describe('a cell the host decided not to read is a terminal state, not a wait', () => {
  it('answers unavailable instead of staying on loading forever', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(createElement(Probe, { signalClient: { query: async () => emptyRead }, disabled: true })) })
    // 2026-11-11 用户现场：两格开着、源关着，卡片永远「正在加载…」——那是永远到不了的等待。
    expect(latest?.state).toBe('unavailable')
    expect(latest?.state).not.toBe('loading')
    // 客户端一次都不许被问（关掉就是关掉）。
  })

  it('still shows loading while the enable table has not been read yet', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(createElement(Probe, { signalClient: { query: async () => emptyRead }, waiting: true, disabled: true })) })
    // 首帧还没读完启用表：这时才是加载（与「已决定不读」是两件事）。
    expect(latest?.state).toBe('loading')
  })
})
