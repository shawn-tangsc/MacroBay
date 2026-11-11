// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 真链路：**主进程的采集终态 → 产品事件 → 渲染层订阅**。
 *
 * 只有一处接缝被替换：Electron 的 `webContents.send` / `ipcRenderer`（这里没有 Electron 进程），
 * 用一张内存管道接起来。其余全是生产代码：
 * - 终态由**真 `jobRuntime`**（默认内存 store）产生，不是手搓一份「看着像」的运行记录；
 * - 真 `fanOutRunTerminal` 扇出 → 真 `registerIntelligenceDataChangedEvents` 登记的那条发射器；
 * - 真 `emitProductIpcEvent` + 真 `registerProductIpcEventSender`（平台那个单例，不 mock），
 *   按 `app.ts:853-855` 的同一行形状注册，只把 `safeSendToMainWindow` 换成内存投递；
 * - 真 `platform/desktop/preload/index.ts` 构建的 api（`products.onEvent` 是生产实现）；
 * - 真渲染层订阅 `subscribeIntelligenceDataChanged`（不注入替身）；
 * - 两端用的契约是**同一个文件**：`contracts/intelligenceDataChangedEvent.ts`。
 */
const { exposeInMainWorld, ipcOn, ipcRemoveListener, ipcInvoke } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  ipcOn: vi.fn(),
  ipcRemoveListener: vi.fn(),
  ipcInvoke: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { on: ipcOn, removeListener: ipcRemoveListener, invoke: ipcInvoke }
}))

import type { JobContext, JobRunOutcome } from '@platform/jobs/contracts/jobTypes'
import { createJobRuntime, type JobRunTerminalHookInput } from '@platform/jobs/runtime/jobRuntime'
import { fanOutRunTerminal, resetProductRunTerminalListenersForTest } from '@platform/desktop/main/runTerminalFanOut'
import { IpcChannels } from '@platform/desktop/ipc/channels'
import { registerProductIpcEventSender } from '@platform/desktop/ipc/productIpcEventBridge'

import {
  INTELLIGENCE_DATA_CHANGED_EVENT,
  parseIntelligenceDataChanged,
  type IntelligenceDataChangedPayload
} from '../../../contracts/intelligenceDataChangedEvent'
import { INTELLIGENCE_COLLECT_SOURCE_JOB } from './intelligenceJobIds'
import { registerIntelligenceDataChangedEvents } from './registerIntelligenceDataChanged'
import { subscribeIntelligenceDataChanged } from '../../../desktop/shared/ipc/intelligenceDataChangedClient'

const PRODUCT_ID = 'market-intelligence'
/** 看板专用源（`purposes: ['dashboard']`）。 */
const DASHBOARD_SOURCE = 'alternative-fear-greed'
/** 看板 + 日历都供的源（`purposes: ['dashboard','calendar']`）。 */
const DASHBOARD_AND_CALENDAR_SOURCE = 'macro-calendar-0xrouter-economic-data'

type Delivered = Readonly<{ productId: string; event: string; data: unknown }>

let delivered: Delivered[] = []
let platformApi: unknown
/** ipcRenderer 侧真正挂着的监听器：`removeListener` 要能真的摘掉，否则上一个用例的订阅会串到下一个。 */
const channelListeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>()

beforeAll(async () => {
  // 一次导入：真 preload 模块在装配时把 api 交给 contextBridge，我们把它接到 window 上。
  await import('@platform/desktop/preload/index')
  platformApi = exposeInMainWorld.mock.calls.at(-1)?.[1]
})

beforeEach(() => {
  resetProductRunTerminalListenersForTest()
  delivered = []
  channelListeners.clear()
  ipcOn.mockReset().mockImplementation((channel: string, listener: (event: unknown, payload: unknown) => void) => {
    const set = channelListeners.get(channel) ?? new Set()
    set.add(listener)
    channelListeners.set(channel, set)
  })
  ipcRemoveListener.mockReset().mockImplementation((channel: string, listener: (event: unknown, payload: unknown) => void) => {
    channelListeners.get(channel)?.delete(listener)
  })
  ipcInvoke.mockReset()
  Object.defineProperty(window, 'platform', { configurable: true, value: platformApi })

  // 真平台桥的发送端：与 `app.ts:853-855` 同一行形状，只把「送给窗口」换成内存投递。
  registerProductIpcEventSender((productId, event, data) => {
    delivered.push({ productId, event, data })
    for (const listener of channelListeners.get(IpcChannels.productIpcEvent) ?? []) {
      listener(null, { productId, event, data })
    }
  })
  // 真产品登记：把发射器挂到运行终态的扇出上。
  registerIntelligenceDataChangedEvents(PRODUCT_ID)
})

afterEach(() => {
  Reflect.deleteProperty(window, 'platform')
})

function makeRuntime(handler: (payload: unknown, context: JobContext) => Promise<void>) {
  const terminal: JobRunTerminalHookInput[] = []
  const runtime = createJobRuntime({
    onRunTerminal: fanOutRunTerminal([(input: JobRunTerminalHookInput) => { terminal.push(input) }])
  })
  runtime.registerHandler(INTELLIGENCE_COLLECT_SOURCE_JOB, handler)
  let index = 0
  const runCollect = async (sourceId: string): Promise<void> => {
    index += 1
    runtime.setSchedule({
      audience: 'internal' as const,
      id: `collect-${index}-${sourceId}`,
      owner: 'product' as const,
      productId: PRODUCT_ID,
      handlerId: INTELLIGENCE_COLLECT_SOURCE_JOB,
      title: 'Collect source',
      trigger: { kind: 'manual' as const },
      payload: { sourceId }
    })
    await runtime.enqueueManual(`collect-${index}-${sourceId}`)
  }
  return { runtime, terminal, runCollect }
}

/** 采集真的写进去了：`succeeded > 0`。 */
const wrote = async (_payload: unknown, context: JobContext): Promise<void> => {
  const outcome: JobRunOutcome = { counts: { total: 1, succeeded: 1, failed: 0, skipped: 0 } }
  await context.result?.(outcome)
}

/** 空跑 / 全失败：一条都不许发。 */
const wroteNothing = async (_payload: unknown, context: JobContext): Promise<void> => {
  const outcome: JobRunOutcome = {
    counts: { total: 2, succeeded: 0, failed: 2, skipped: 0 },
    reasonCode: 'collector.failed',
    reasons: { 'collector.failed': 2 }
  }
  await context.result?.(outcome)
}

describe('collection terminal state reaches the renderer subscription (real chain)', () => {
  it('delivers exactly one event for one successful run, with the panel from the source registry', async () => {
    const { runCollect, terminal } = makeRuntime(wrote)
    const received: IntelligenceDataChangedPayload[] = []
    // 真渲染层订阅：不注入替身，走 window.platform.products.onEvent。
    const stop = subscribeIntelligenceDataChanged(payload => received.push(payload))

    await runCollect(DASHBOARD_SOURCE)
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 8_000 })

    // 终态确实来自真运行时，且这条 run 真的写了库。
    expect(terminal).toHaveLength(1)
    expect(terminal[0]!.run.status).toBe('completed')
    expect(terminal[0]!.run.result?.counts.succeeded).toBe(1)

    // 主进程发出的那一条：事件名来自契约，产物只有 panels / sources。
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ productId: PRODUCT_ID, event: INTELLIGENCE_DATA_CHANGED_EVENT })
    // 面板由真注册表换算：这个源 `purposes: ['dashboard']`。
    expect(received[0]!.panels).toEqual(['dashboard'])
    expect(received[0]!.sources).toEqual([DASHBOARD_SOURCE])

    // 两端同一份契约：渲染层拿到的载荷能过契约的解析，且与发射端冻结的那份逐字段相等。
    expect(parseIntelligenceDataChanged(delivered[0]!.data)).toEqual(received[0])
    expect(Object.isFrozen(received[0])).toBe(true)

    stop()
  })

  it('sends nothing when the run wrote nothing (succeeded === 0)', async () => {
    const { runCollect, terminal } = makeRuntime(wroteNothing)
    const received: IntelligenceDataChangedPayload[] = []
    const stop = subscribeIntelligenceDataChanged(payload => received.push(payload))

    await runCollect(DASHBOARD_SOURCE)
    await vi.waitFor(() => expect(terminal).toHaveLength(1), { timeout: 8_000 })
    expect(terminal[0]!.run.result?.counts.succeeded).toBe(0)

    // 等一个完整合并窗口：确认「不发」不是「还没发」。
    await new Promise(resolve => setTimeout(resolve, 2_600))
    expect(delivered).toHaveLength(0)
    expect(received).toHaveLength(0)

    stop()
  })

  it('merges two runs inside the same window into one event, unioned and sorted', async () => {
    const { runCollect } = makeRuntime(wrote)
    const received: IntelligenceDataChangedPayload[] = []
    const stop = subscribeIntelligenceDataChanged(payload => received.push(payload))

    // 一轮采集连着跑两个源：两个源都写进去了。
    await runCollect(DASHBOARD_SOURCE)
    await runCollect(DASHBOARD_AND_CALENDAR_SOURCE)
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 8_000 })

    expect(delivered).toHaveLength(1)
    // 并集去重 + 稳定顺序：面板按到达并集，来源排过序。
    expect([...received[0]!.panels].sort()).toEqual(['dashboard', 'economic-calendar'])
    expect(received[0]!.sources).toEqual([DASHBOARD_SOURCE, DASHBOARD_AND_CALENDAR_SOURCE].sort())

    stop()
  })

  it('stops delivering once the renderer unsubscribes', async () => {
    const { runCollect } = makeRuntime(wrote)
    const received: IntelligenceDataChangedPayload[] = []
    const stop = subscribeIntelligenceDataChanged(payload => received.push(payload))

    await runCollect(DASHBOARD_SOURCE)
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 8_000 })

    stop()
    // preload 那条 ipcRenderer 监听器在最后一个订阅者离开后被摘掉。
    expect(channelListeners.get(IpcChannels.productIpcEvent)?.size ?? 0).toBe(0)
  })
})
