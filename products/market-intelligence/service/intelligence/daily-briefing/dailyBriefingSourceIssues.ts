import type { BriefingNewsSource } from '../../../contracts/dailyBriefing'
import type { RuntimeStateRecord } from '@platform/jobs'

import { getIntelligenceSourceDefinition } from '../application/sourceCatalog'
import { decideSourceIssue, silenceWindowFor } from '../application/sourceIssueNotifier'

/**
 * 今天哪些新闻源出了问题——**从来源的运行状态算，写进冻结的日报文档**（`02` v2.167）。
 *
 * 为什么不另开一张表：右列「数据缺口与限制」是读者看「今天拿不到什么」的唯一位置，另开一张
 * 等于让同一种事有两个出处。所以这里只算一次，结果是文档里的 `news.sources`。
 *
 * 判定**复用通知那条**（`decideSourceIssue` + `silenceWindowFor`）：静默窗口一个来源只有一条
 * 口径，新闻源 24 小时；连续失败的门槛也是同一个。这里不另写一套，否则通知说"25 小时没动静"、
 * 右列说"12 小时"，读者只能信更吓人的那个。
 *
 * 三条纪律：
 * - **正常的源不进来**：没有条目就是没有，不是"缺什么"。
 * - **静默与失败分开**：一个是"活着但没新东西"，一个是"根本读不到"，两句话，永不共用。
 * - **静默必须说得出最后一条新条目的时刻**：说不了就不报（宁可不说话，也不写一个猜的时刻）。
 *   注意用的是检查点里的 `lastPublishedAt`（真的带来新条目），不是 `lastSuccessAt`（每 15 分钟
 *   都成功、抓回来全是去重挡掉的旧条目时，后者永远是"刚才"）。
 */
export function readNewsSourceIssues(input: Readonly<{
  states: readonly RuntimeStateRecord[]
  /** 判定时刻：这一版的读取时刻（UTC）。 */
  now: string
  timeZone: string
  nameOf?: (sourceId: string) => string | undefined
}>): readonly BriefingNewsSource[] {
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(nowMs)) return Object.freeze([])
  const issues: BriefingNewsSource[] = []
  const seen = new Set<string>()
  for (const state of input.states) {
    const definition = getIntelligenceSourceDefinition(state.resourceId)
    // 只管新闻源：别的来源有各自的"读不到"通道（日历写进宏观那一栏的原因码）。
    if (definition?.category !== 'mainstream-news') continue
    // 同一个源出现两次时只算一次：状态表按资源 id 唯一，重复行是数据问题，不是两条缺口。
    if (seen.has(state.resourceId)) continue
    seen.add(state.resourceId)
    const checkpoint = state.checkpoint as { lastPublishedAt?: unknown } | undefined
    const lastNewItemAt = typeof checkpoint?.lastPublishedAt === 'string' ? checkpoint.lastPublishedAt : undefined
    const kind = decideSourceIssue({
      sourceId: state.resourceId,
      consecutiveFailures: state.consecutiveFailures,
      ...(state.lastSuccessAt === undefined ? {} : { lastSuccessAt: state.lastSuccessAt }),
      ...(lastNewItemAt === undefined ? {} : { lastNewItemAt }),
      now: input.now
    }, silenceWindowFor(state.resourceId, input.now, input.timeZone))
    if (kind === null) continue
    const name = input.nameOf?.(state.resourceId) ?? definition.displayName
    if (kind === 'consecutive-failed') {
      issues.push(Object.freeze({
        sourceId: state.resourceId,
        name,
        state: 'failed' as const,
        consecutiveFailures: state.consecutiveFailures
      }))
      continue
    }
    // 静默：说得出"最后一条新条目"才报，说不了就不报。
    if (lastNewItemAt === undefined) continue
    const hours = Math.round(((nowMs - Date.parse(lastNewItemAt)) / 3_600_000) * 10) / 10
    if (!Number.isFinite(hours)) continue
    issues.push(Object.freeze({
      sourceId: state.resourceId,
      name,
      state: 'silent' as const,
      lastNewItemAt,
      silentHours: hours
    }))
  }
  return Object.freeze(issues.sort((left, right) => left.sourceId.localeCompare(right.sourceId)))
}
