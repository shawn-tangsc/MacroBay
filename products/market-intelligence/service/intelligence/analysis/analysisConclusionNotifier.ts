import type { NotificationRequestedLevel } from '@platform/notifications/contracts/notificationEventCatalog'
import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import {
  analysisConclusionPushPolicy,
  analysisConclusionPushesPhone,
  buildAnalysisConclusionBody,
  type AnalysisPushLanguage
} from './analysisConclusionPush'

/**
 * AI 分析结论推送（N12）的**出站层**：判定层给的结论翻成一次提交。
 *
 * 只在这一个地方拼请求：提交点只有一个（`analysisOrchestrator` 写入记录之后），句子、去重分量、
 * 「只进中心」的收窄值都在这里一次算清。它不读库、不判平台开关、失败不影响这次运行。
 *
 * 手机那一档等平台加上按次收窄字段（architect 已判、排在频道线之后）：字段没到时这里**不传**，
 * 提交照常——收窄只是少叫醒一次，不是把通知吞掉。
 */

/**
 * 平台字段落地前的前向声明。
 *
 * `platform/notifications` 的提交契约里还没有这个字段（频道线在同一片文件里改，等它落完再单独一笔）。
 * 先把值按将来的形状传出去、用这里兜住类型：字段到了就只剩删掉这个类型、把 `as` 去掉。
 */
type NarrowableSubmitRequest = NotificationSubmitRequest & Readonly<{
  /**
   * 收窄后的落点集合。`center` 也在里面：architect 给的口径是「收窄后必须仍含 center」，
   * 而申请的档位集合本身不含 center——字段落地时以平台那侧的类型为准，这里先按口径写。
   */
  narrowedDisruptionLevels?: readonly (NotificationRequestedLevel | 'center')[]
}>

export type AnalysisConclusionNotice = Readonly<{
  runId: string
  triggerKey: string
  /** 这一版的统计截止（快照的 asOf）：去重键的第二个分量。 */
  cutoff: string
  summary: string
  conclusionDirection: 'bullish' | 'bearish' | 'range' | 'undecided' | 'mixed'
  /** 结论引用的事实 id；用了信号没带的就是"新信息"。 */
  citedFactIds: readonly string[]
  /** 触发这次运行的信号方向；读不出来就是 `undefined`。 */
  triggerDirection?: 'bullish' | 'bearish'
  /** 信号带的事实 id；读不出来就是空数组（此时只会算"没有新信息"）。 */
  triggerFactIds?: readonly string[]
  /** 证据引用条数：正文里的"证据 N 条"。 */
  citedCount: number
  occurredAt: string
}>

export type AnalysisConclusionNotifierDeps = Readonly<{
  submit: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  now: () => string
  /** 读者时区：日界按它算。 */
  timeZone: () => string
}>

/** 读者时区的「今天」：`YYYY-MM-DD`，只用来给计数分桶，不参与任何显示。 */
export function analysisPushDayOf(now: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
  } catch {
    return now.slice(0, 10)
  }
}

export function createAnalysisConclusionNotifier(deps: AnalysisConclusionNotifierDeps): (notice: AnalysisConclusionNotice) => Promise<void> {
  const counts = new Map<string, { day: string; module: number; byTriggerKey: Map<string, number> }>()
  const bucketOf = (now: string, timeZone: string) => {
    const day = analysisPushDayOf(now, timeZone)
    const existing = counts.get(day)
    if (existing !== undefined) return existing
    const fresh = { day, module: 0, byTriggerKey: new Map<string, number>() }
    counts.set(day, fresh)
    return fresh
  }
  return async (notice) => {
    try {
      const now = deps.now()
      const timeZone = deps.timeZone()
      const bucket = bucketOf(now, timeZone)
      const sentToday = { byTriggerKey: bucket.byTriggerKey.get(notice.triggerKey) ?? 0, module: bucket.module }
      const delivery = analysisConclusionPushesPhone({
        ...(notice.triggerDirection === undefined ? {} : { signalDirection: notice.triggerDirection }),
        conclusionDirection: notice.conclusionDirection,
        ...(notice.triggerFactIds === undefined ? {} : { signalFactIds: notice.triggerFactIds }),
        citedFactIds: notice.citedFactIds,
        sentToday
      })
      const centerOnly = delivery.centerOnly
      const body = buildAnalysisConclusionBody({
        summary: notice.summary,
        citedCount: notice.citedCount,
        withContext: !centerOnly
      })
      const rendered = {
        'zh-CN': { ...analysisConclusionPushPolicy.renderedCopy['zh-CN'], body: body.text },
        'en-US': { ...analysisConclusionPushPolicy.renderedCopy['en-US'], body: body.text }
      }
      const request: NarrowableSubmitRequest = {
        eventTypeId: analysisConclusionPushPolicy.eventTypeId,
        dedupeVars: { builder: 'template', vars: { triggerKey: notice.triggerKey, cutoff: notice.cutoff } },
        // 收窄只传 center：字段没到之前这一项会被平台忽略（未知键不是本次提交的校验项），
        // 到了之后就是"只进中心"。
        ...(centerOnly ? { narrowedDisruptionLevels: ['center'] as const } : {}),
        rendered,
        actions: [],
        occurredAt: notice.occurredAt
      }
      await deps.submit(request)
      bucket.module += 1
      bucket.byTriggerKey.set(notice.triggerKey, (bucket.byTriggerKey.get(notice.triggerKey) ?? 0) + 1)
    } catch {
      // 通知是记录的附加物：发不出去不许把一次成功的分析变成失败。
    }
  }
}
