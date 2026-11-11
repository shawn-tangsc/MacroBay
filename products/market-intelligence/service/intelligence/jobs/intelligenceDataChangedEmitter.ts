import type { JobRunRecord } from '@platform/jobs'

import type { IntelligenceDataChangedPayload } from '../../../contracts/intelligenceDataChangedEvent'
import { intelligenceDataChangedTarget } from './dataChangedJobMap'

const PRODUCT_ID = 'market-intelligence'
/** trailing：最后一次写入后静一会儿再发，把「一轮采集里的多次写库」并成一条。 */
const TRAILING_MS = 2_000
/** 连续写入时的上限：一直有写入也不许无限推迟，最长 5 秒必发一次。 */
const MAX_WAIT_MS = 5_000

/**
 * 采集写了库 → 发一条 `intelligence.dataChanged`（产品事件通道）。
 *
 * **发射条件只看运行记录**（`result.counts`），不看状态字、不看 runId：
 * `succeeded > 0` 才发；部分成功（`failed > 0 && succeeded > 0`）也发——库确实变了；
 * `succeeded === 0` 一条都不发（失败、空跑、没跑完都不算写入）。
 *
 * **载荷形状不许改**：只带 `panels` / `sources` 的并集，不带值、不带计数、不带 runId。
 * 未登记的 handler **抛错**（在测试里就是红），不许静默当成「没影响」。
 *
 * 去抖：trailing 2s；连续到达最长 5s 必发一次。窗口内没有任何面板/来源影响面时不发
 * （那是登记为「不影响这两个面板」的作业，显式声明，不是漏登记）。
 */
export function createIntelligenceDataChangedEmitter(deps: {
  emit: (payload: IntelligenceDataChangedPayload) => void
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
  trailingMs?: number
  maxWaitMs?: number
}): (input: Readonly<{ run: Pick<JobRunRecord, 'productId' | 'handlerId' | 'payload' | 'result'> }>) => void {
  const now = deps.now ?? (() => Date.now())
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle))
  const trailingMs = deps.trailingMs ?? TRAILING_MS
  const maxWaitMs = deps.maxWaitMs ?? MAX_WAIT_MS

  let panels = new Set<IntelligenceDataChangedPayload['panels'][number]>()
  let sources = new Set<string>()
  let windowStartedAt: number | undefined
  let trailing: ReturnType<typeof setTimeout> | undefined
  let hardStop: ReturnType<typeof setTimeout> | undefined

  const clearTimers = (): void => {
    if (trailing !== undefined) clearTimer(trailing)
    if (hardStop !== undefined) clearTimer(hardStop)
    trailing = undefined
    hardStop = undefined
  }

  const flush = (): void => {
    clearTimers()
    const payloadPanels = [...panels]
    const payloadSources = [...sources].sort()
    windowStartedAt = undefined
    panels = new Set()
    sources = new Set()
    if (payloadPanels.length === 0 && payloadSources.length === 0) return
    deps.emit(Object.freeze({ panels: Object.freeze(payloadPanels), sources: Object.freeze(payloadSources) }))
  }

  return (input): void => {
    const { run } = input
    if (run.productId !== PRODUCT_ID) return
    const succeeded = run.result?.counts.succeeded ?? 0
    // 只有「这次真的写进去了」才算：succeeded > 0（部分成功也发）。
    if (succeeded <= 0) return

    const target = intelligenceDataChangedTarget({ handlerId: run.handlerId, payload: run.payload })
    if (target === undefined) {
      // 不许静默跳过：新作业没登记映射时这里必须炸出来（用例里就是红）。
      throw new Error(`Unmapped intelligence job for data-changed event: ${run.handlerId}`)
    }
    for (const panel of target.panels) panels.add(panel)
    for (const source of target.sources) sources.add(source)

    const at = now()
    if (windowStartedAt === undefined) {
      windowStartedAt = at
      hardStop = setTimer(flush, maxWaitMs)
    } else if (at - windowStartedAt >= maxWaitMs) {
      // 连续写入已经顶到上限：立刻发，不再等 trailing。
      flush()
      return
    }
    if (trailing !== undefined) clearTimer(trailing)
    trailing = setTimer(flush, trailingMs)
  }
}