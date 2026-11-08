import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { AnalysisConclusionDirection } from '../../../contracts/marketAnalysisContracts'

/**
 * AI 分析结论推送（N12）的**判定层**：只回答"这一条要不要推、推给谁、句子写成什么"。
 *
 * 它不提交、不读库、不判平台开关：提交点只有一个（`analysisOrchestrator` 写入记录之后），
 * 触发面只有信号唤起的那一次，句子与去重键都在这里一次算清——散到调用点就会出现两种说法。
 *
 * 三条写死的口径（`02` 通知表 N12）：
 * - **同向不推手机**：信号方向与结论方向相同 → 只进中心；反向、或结论引用了信号没带的事实才算"新信息"。
 * - **第二条带上下文**：标题沿用「资产 + 规则」，正文带结论摘要与证据引用条数。
 * - **句子只有一句**：结论 + 半句理由，中文 ≤40 字 / 英文 ≤90 字符；超了**截到句末**，绝不截半句。
 *
 * 事件 id 不在这里：它在提交点直接引 `MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.analysisConclusion`。
 * 这里写一份「策略对象的字段」，生产者门禁就证明不了这条通知有人在发（它只认能静态看见的形态），
 * 于是同一个事件会有第二个名字。
 */
export const analysisConclusionPushPolicy = Object.freeze({
  version: 'analysisConclusionPush.v1',
  /** 去重键：同一触发键 + 同一截止时刻一条；**不用 runId**（同一份证据重跑会换 runId）。 */
  dedupeKeyTemplate: 'analysis:{triggerKey}:{cutoff}',
  /** 同一触发键每天 1 条；模块每天 4 条（两条推送合计）；超出只进中心。 */
  perTriggerKeyDailyLimit: 1,
  moduleDailyLimit: 4,
  /** 正文上限：中文按字、英文按字符。 */
  maximumBodyLength: Object.freeze({ 'zh-CN': 40, 'en-US': 90 }) as Readonly<Record<'zh-CN' | 'en-US', number>>,
  /**
   * 成品句子里的标题与理由：这条通知的正文是运行时拼的（结论句），所以标题/理由也随成品一起给。
   * 与通知文案表里那两行**同字**——表里那两行只服务没有成品的老记录，两处一起改。
   */
  renderedCopy: Object.freeze({
    'zh-CN': { title: '分析结论', reason: '你订阅了信号触发的分析结论提醒。' },
    'en-US': { title: 'Analysis conclusion', reason: 'You subscribed to signal-triggered analysis conclusions.' }
  }),
  /** 结论方向里这五个是"有方向"的取值，其余按"没表态"处理。 */
  directionKeys: ['bullish', 'bearish', 'range', 'undecided', 'mixed'] as readonly AnalysisConclusionDirection[]
})

export type AnalysisPushLanguage = 'zh-CN' | 'en-US'

export type AnalysisConclusionPushInput = Readonly<{
  triggerKey: string
  cutoff: string
  /** 这一次的信号方向；没有信号（手动/定时）就没有这一项——调用方不应走到这里。 */
  signalDirection: 'bullish' | 'bearish'
  /**
   * 信号带的事实 id；`undefined` = 读不出来。读不出来就**不算**"新信息"——
   * 空数组会让每一条引用都像新事实，等于每次都能叫醒手机。
   */
  signalFactIds?: readonly string[]
  conclusion: Readonly<{ direction: AnalysisConclusionDirection; summary: string }>
  /** 结论引用的证据事实 id（至少一条；正文里的"证据 N 条"读它）。 */
  citedFactIds: readonly string[]
  /** 读者时区：日界按它算。 */
  timeZone: string
  /** 今天（读者时区）已经为这个触发键发过几条、模块一共发过几条。 */
  sentToday: Readonly<{ byTriggerKey: number; module: number }>
  now: string
}>

export type AnalysisConclusionPushDecision = Readonly<{
  /** 平台要提交的那条请求的原料；`undefined` 表示这次不提交（连中心也不进）。 */
  request?: Omit<NotificationSubmitRequest, 'rendered' | 'dedupeVars'> & {
    /** `true` = 只进中心（同向、或配额用尽）。 */
    centerOnly: boolean
    /** 正文那句（两种语言各一份，平台按读者语言挑）。 */
    body: Readonly<Record<AnalysisPushLanguage, string>>
    /** 去重键的三个分量：键字符串由平台按模板拼，调用点不自己拼。 */
    dedupeVars: Readonly<{ triggerKey: string; cutoff: string }>
  }
  /** 没提交时的原因，供日志与用例断言；`undefined` 表示提交了。 */
  skipped?: 'same-direction' | 'quota-day' | 'quota-module' | 'no-direction'
}>

/**
 * 截到句末：只在句末标点之后结束；一个句末标点都在上限内找不到时，返回**整句**（`overLimit`），
 * 宁可略长也不截半句——半句话读起来像模型说漏了，比多几个字严重。
 */
export function cutAtSentenceEnd(text: string, limit: number): Readonly<{ text: string; overLimit: boolean }> {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return Object.freeze({ text: trimmed, overLimit: false })
  const ENDS = /[。！？!?]|\.(?=\s|$)/g
  let last = -1
  for (const match of trimmed.matchAll(ENDS)) {
    const end = (match.index ?? 0) + match[0].length
    if (end > limit) break
    last = end
  }
  if (last <= 0) return Object.freeze({ text: trimmed, overLimit: true })
  return Object.freeze({ text: trimmed.slice(0, last), overLimit: true })
}

/** 正文语言：含中日韩字符按中文算（40 字），否则按英文算（90 字符）。 */
export function bodyLanguageOf(text: string): AnalysisPushLanguage {
  return /[\u3400-\u9fff]/.test(text) ? 'zh-CN' : 'en-US'
}

/**
 * 正文：一句结论 + 半句理由；推手机时再带证据条数（第二条带上下文）。
 * 理由只取结论之后的半句——不另写句子，也不把三段正文塞进来。
 */
export function buildAnalysisConclusionBody(input: Readonly<{
  summary: string
  reason?: string
  citedCount: number
  withContext: boolean
}>): Readonly<{ text: string; language: AnalysisPushLanguage; overLimit: boolean }> {
  const summary = input.summary.trim()
  const reason = (input.reason ?? '').trim()
  const half = reason.length === 0 ? '' : `，${firstClause(reason)}`
  const context = input.withContext ? (containsCjk(summary) ? ` · 证据 ${input.citedCount} 条` : ` · ${input.citedCount} evidence refs`) : ''
  const language = bodyLanguageOf(summary)
  const limit = analysisConclusionPushPolicy.maximumBodyLength[language]
  const cut = cutAtSentenceEnd(`${summary}${half}`, limit)
  return Object.freeze({ text: `${cut.text}${context}`, language, overLimit: cut.overLimit })
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text)
}

/** 理由只留前半句：第一个逗号/分号/句号之前的那一截；没有标点就整句（会被上面的长度再截）。 */
function firstClause(text: string): string {
  const match = /^[^，,；;。.!?！？]*/.exec(text)
  const clause = (match?.[0] ?? '').trim()
  return clause.length > 0 ? clause : text
}

/**
 * 这一条要不要推手机。**同向不推**：方向相同且没有新事实 → 只进中心；
 * 反向、或结论引用了信号没带的事实 → 推手机。配额用尽也只进中心。
 */
export function analysisConclusionPushesPhone(input: Readonly<{
  /** 读不出来就是 `undefined`：没有证据说"反了"，就不叫醒读者。 */
  signalDirection?: 'bullish' | 'bearish'
  conclusionDirection: AnalysisConclusionDirection
  signalFactIds?: readonly string[]
  citedFactIds: readonly string[]
  sentToday: Readonly<{ byTriggerKey: number; module: number }>
}>): Readonly<{ phone: boolean; centerOnly: boolean; reason?: 'same-direction' | 'quota-trigger-key' | 'quota-module' }> {
  const directional = input.conclusionDirection === 'bullish' || input.conclusionDirection === 'bearish'
  const opposing = directional && input.signalDirection !== undefined && input.conclusionDirection !== input.signalDirection
  const newInformation = input.signalFactIds !== undefined && input.citedFactIds.some((id) => !input.signalFactIds!.includes(id))
  const quotaHit = input.sentToday.byTriggerKey >= analysisConclusionPushPolicy.perTriggerKeyDailyLimit
    ? 'quota-trigger-key' as const
    : input.sentToday.module >= analysisConclusionPushPolicy.moduleDailyLimit ? 'quota-module' as const : undefined
  const worthPhone = opposing || newInformation
  if (!worthPhone) return Object.freeze({ phone: false, centerOnly: true, reason: 'same-direction' })
  if (quotaHit !== undefined) return Object.freeze({ phone: false, centerOnly: true, reason: quotaHit })
  return Object.freeze({ phone: true, centerOnly: false })
}
