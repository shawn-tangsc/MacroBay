import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { MarketCalendarRefreshNowResult } from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * 日报的「补跑一次日历」：**排上作业，然后等它的结果**（Chief 2026-11-14 定 A）。
 *
 * 为什么不能排完就回「完成」：`{state:'completed'}` 只说明作业排进了队列，说明不了采到没有。
 * 日报只认 `collected / unchanged / failed / timeout` 四个结果，认不出的就按「采集失败」写——
 * 于是**每一版都会写「采集失败」，与真实结果无关**。这里等作业到终态，再按终态回答。
 *
 * 三条边界：
 * 1. **等待有上限**：最多 20 秒（即使调用方给得更宽）。超时按「超时」回答，不按「失败」——
 *    读者对这两句的反应不同：一个是「还没跑完」，一个是「跑了但没成」。
 * 2. **`collected` 与 `unchanged` 分开**：判据是**数据有没有真的变**（标准表最近写入时刻），
 *    不是作业有没有跑。源一直回同一批内容时，作业每分钟「成功」，但那天没有新数据。
 * 3. **抛错是失败，不是超时**：这条与日报那条判据保持一致。
 *
 * **名字不再带 Narwhal**（Chief 2026-11-24）：这里的派发早就是按 `sourceIds` 一源一作业，
 * 眼下下发的是 0xRouter 三路；旧名字会让人以为它只服务一家，改源时又去别处找入口。
 * 定义 id 仍由调用方给（`definitionForSourceId`），这个模块不认识任何一家来源。
 */
export const MARKET_CALENDAR_BRIEFING_CATCH_UP_CEILING_MS = 20_000

/** 只有这两件事需要作业运行时；传整个 `JobRuntime` 会把「等结果」变成一句口头承诺。 */
export type BriefingCatchUpJobRuntime = Readonly<{
  enqueueManual: (definitionId: string) => Promise<{ id: string }>
  waitForRunTerminal: (runId: string, options?: { timeoutMs?: number }) => Promise<
    | { state: 'terminal'; run: Readonly<{ status: string; lastError?: string }> }
    | { state: 'timeout' }
    | { state: 'interrupted' }>
}>

/**
 * 比日报端口多一个可选的 `sourceIds`（日报那条链运行时会传，类型里没写）；返回的就是契约里
 * 那四种结果，不自己造词。这个形状可以直接当 `BriefingCalendarRefresh` 用。
 */
export type MarketCalendarBriefingRefresh = (
  input: Readonly<{ timeoutMs: number; sourceIds?: readonly string[] }>
) => Promise<MarketCalendarRefreshNowResult>

export function createMarketCalendarBriefingRefresh(input: Readonly<{
  jobRuntime: BriefingCatchUpJobRuntime
  /**
   * 单条源 → 要排的作业定义。**必须真的用起来**：以前这里只排一个写死的定义，而下发的
   * `sourceIds` 名单只被拿去填返回值——「名单对、命令旧」，比全旧更难查（2026-11-16）。
   * 不传时退回 `definitionId`（单源场景，例如测试或只剩一条采集作业的构建）。
   */
  definitionForSourceId?: (sourceId: string) => string | undefined
  definitionId: string
  /** 数据有没有真的写进来：标准表最近写入时刻。 */
  readLastWrittenAt: () => string | null
}>): MarketCalendarBriefingRefresh {
  return async (request) => {
    const budget = Math.max(1, Math.min(
      typeof request?.timeoutMs === 'number' ? request.timeoutMs : MARKET_CALENDAR_BRIEFING_CATCH_UP_CEILING_MS,
      MARKET_CALENDAR_BRIEFING_CATCH_UP_CEILING_MS))
    const sources = request?.sourceIds ?? marketCalendarPublicPolicy.collectionFeeds
    const before = input.readLastWrittenAt()
    const startedAt = Date.now()
    const started = Date.now()
    // **按名单逐个排**：名单里有几路就排几路（缺席的源直接跳过，不编定义 id）。
    const definitions = [...new Set(sources.map((sourceId) =>
      input.definitionForSourceId?.(sourceId) ?? input.definitionId).filter((id): id is string => typeof id === 'string' && id !== ''))]
    const runIds: string[] = []
    for (const definitionId of definitions) {
      try {
        runIds.push((await input.jobRuntime.enqueueManual(definitionId)).id)
      } catch (error) {
        return { state: 'failed' as const, failureCode: shortFailureCode(error, 'enqueue-failed') }
      }
    }
    for (const runId of runIds) {
      const remaining = Math.max(1, budget - (Date.now() - started))
      let settled: Awaited<ReturnType<BriefingCatchUpJobRuntime['waitForRunTerminal']>>
      try {
        settled = await input.jobRuntime.waitForRunTerminal(runId, { timeoutMs: remaining })
      } catch (error) {
        return { state: 'failed' as const, failureCode: shortFailureCode(error, 'wait-failed') }
      }
      if (settled.state === 'timeout') return { state: 'timeout' as const, timeoutMs: budget }
      if (settled.state === 'interrupted') return { state: 'failed' as const, failureCode: 'run-interrupted' }
      if (settled.run.status !== 'completed') {
        return { state: 'failed' as const, failureCode: shortFailureCode(settled.run.lastError, `run-${settled.run.status}`) }
      }
    }
    // 作业成功 ≠ 数据变了：源重复回同一批内容时，这一天没有新数据，回答「未变化」。
    const after = input.readLastWrittenAt()
    const verdict = after === null || after === before ? 'unchanged' as const : 'collected' as const
    // **埋点：补采现场一行**（发给哪几路、结果、耗时），与判定那行同名可串。
    logCatchUp({ definitions: definitions.length, sources: sources.length, verdict, elapsedMs: Date.now() - startedAt })
    return verdict === 'unchanged' ? { state: 'unchanged' } : { state: 'collected', sources: [...sources] }
  }
}

/** 补采埋点：字段固定，不打印 URL/凭据。失败与超时也各打一行（结果码不同）。 */
function logCatchUp(input: Readonly<{ definitions: number; sources: number; verdict: string; elapsedMs: number }>): void {
  try {
    console.warn(JSON.stringify({ marker: 'macro-calendar.catch-up', ...input }))
  } catch { /* 埋点不许影响补采 */ }
}

function shortFailureCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const trimmed = message.trim().slice(0, 64)
  return trimmed === '' ? fallback : trimmed
}
