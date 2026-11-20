/**
 * 「失败页」的读口（渲染侧）：按运行分页拿**全部**失败，而不是时间轴首页补的那 20 条。
 *
 * 单独成文件的两个理由：
 * 1. 它与 `listTimeline` 是**两条不同的读**（游标语义不同：已发布行按 `(occurred_at, id)`，失败行按
 *    运行的 `(queued_at, id)`），混进一个入口就会有人传一个游标给另一条链；
 * 2. 时间轴客户端文件已有体积上限，这一条自带类型、校验与失败归类，放进去就超。
 *
 * 校验仍用同一个 `sanitizePage`：失败行的形状就是时间轴条目（`safeTitle` 空、没有摘要），
 * 校验器早先已按这两档放行，所以这里不另写一套。
 */
import { MARKET_ANALYSIS_IPC_METHODS } from '../../../contracts/marketAnalysisIpcContracts'

import { listUnavailable, readFailureReason, type MarketAnalysisTimelineReadFailure } from './marketAnalysisTimelineReadFailure'
import type { MarketAnalysisTimelinePage } from './marketAnalysisTimelineClient'
import { sanitizePage } from './marketAnalysisTimelineSanitizers'

const PRODUCT_ID = 'market-intelligence'

/**
 * 读口返回的就是时间轴那一页的形状：`sanitizePage` 已经把 `triggerStatus`/`groupType`/`groupSubject`
 * 这些必填但可为空的字段补齐（失败行一律 null），所以这里不另声明一套窄类型——**一处形状**，
 * 否则渲染侧两份类型迟早对不上。
 */
export type MarketAnalysisFailedRunRead =
  | { state: 'available'; page: MarketAnalysisTimelinePage }
  | { state: 'unavailable'; reason: MarketAnalysisTimelineReadFailure }

/** 一页失败运行。`cursor` 为空即首页；`nextCursor` 为 null 表示翻到底。 */
export async function listFailedRuns(input: Readonly<{ cursor?: string }> = {}): Promise<MarketAnalysisFailedRunRead> {
  try {
    if (!window.platform?.products?.invoke) return listUnavailable('product-runtime-unavailable')
    const page = sanitizePage(await window.platform.products.invoke(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.listFailedRuns, input))
    return page === undefined ? listUnavailable('read-failed') : page
  } catch (error) {
    return listUnavailable(readFailureReason(error))
  }
}