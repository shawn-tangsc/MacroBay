import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { AnalysisConclusionDirection } from '../../../contracts/marketAnalysisContracts'
import { analysisTriggerSourcePolicy } from './analysisTriggerSourcePolicy'

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
 */
export const analysisConclusionPushPolicy = Object.freeze({
  version: 'analysisConclusionPush.v1',
  /**
   * 去重键：**同一桶（原因码 + 事件）+ 同一截止时刻**一条；**不用 runId**（同一份证据重跑会换）。
   *
   * 桶按事件算，不按触发键：初次运行的键全都叫 `macro.actual.first-confirmed`，按键会让一天
   * 只有第一条达门槛的能到手机（2026-11-09）。同一条事件重复触发仍是同一个桶，照样被去重。
   */
  dedupeKeyTemplate: 'analysis:{bucket}:{cutoff}',
  /** 同一个桶（原因码 + 事件）每天 1 条；模块每天 4 条；超出只进中心。 */
  perBucketDailyLimit: 1,
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
  directionKeys: ['bullish', 'bearish', 'range', 'undecided', 'mixed'] as readonly AnalysisConclusionDirection[],
  /**
   * 哪些**原因码**算「这次分析是达到门槛才跑的」——自动结论推送的入口只读这一处。
   *
   * 判据不读触发键：键记的是阶段（初次 = `macro.actual.first-confirmed`、复盘 =
   * `market-reaction.15m`），消息面达门槛的运行也长着宏观的样子，按前缀判会把它们全漏掉
   * （2026-11-09 用户报「分析结论不推手机」的根因）。原因码才说"为什么跑"。
   *
   * 不进这里的：`session-slot-*`（开盘例行）、`restart-*-compensated`（进程重启补跑）、
   * `manual-request`（读者手动，走发送按钮）、以及各种 `skipped` 原因——例行与补跑不是"达门槛"。
   */
  thresholdReasonCodes: [
    'severity-confirmed',
    'medium-score-confirmed',
    'provider-surprise-confirmed',
    'market-reaction-confirmed',
    'signal-high-triggered',
    'signal-medium-triggered'
  ] as readonly string[]
})

/**
 * 这次运行要不要进结论推送的判定：**达到门槛**就进。
 *
 * 原因码优先（唯一口径在 `thresholdReasonCodes`）；没有判定行时（老运行、信号触发那条不走
 * 意义闸门）回落到信号键：`signal.<模块>.<规则>` 的键本身带着来源，是仅剩的可信事实。
 */
export function analysisConclusionPushEligible(input: Readonly<{ triggerKey: string; reasonCode?: string }>): boolean {
  if (input.reasonCode !== undefined && input.reasonCode.length > 0) {
    return analysisConclusionPushPolicy.thresholdReasonCodes.includes(input.reasonCode)
  }
  return analysisTriggerSourcePolicy.signalTriggerKeyPattern.test(input.triggerKey)
}

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
  sentToday: Readonly<{ byBucket: number; module: number }>
  now: string
}>

export type AnalysisConclusionPushDecision = Readonly<{
  /** 平台要提交的那条请求的原料；`undefined` 表示这次不提交（连中心也不进）。 */
  request?: Omit<NotificationSubmitRequest, 'rendered' | 'dedupeVars'> & {
    /** `true` = 只进中心（同向、或配额用尽）。 */
    centerOnly: boolean
    /** 正文那句（两种语言各一份，平台按读者语言挑）。 */
    body: Readonly<Record<AnalysisPushLanguage, string>>
    /** 去重键的两个分量（桶 + 截止）：键字符串由平台按模板拼，调用点不自己拼。 */
    dedupeVars: Readonly<{ bucket: string; cutoff: string }>
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
  /**
   * 这次是不是信号唤起的。缺省按"有方向就算信号"推；调用方知道触发键时应显式给。
   * 非信号的（消息面/日历达门槛）没有同向可言，达门槛本身就值得叫醒一次。
   */
  signalDriven?: boolean
  conclusionDirection: AnalysisConclusionDirection
  signalFactIds?: readonly string[]
  citedFactIds: readonly string[]
  sentToday: Readonly<{ byBucket: number; module: number }>
}>): Readonly<{ phone: boolean; centerOnly: boolean; reason?: 'same-direction' | 'quota-trigger-key' | 'quota-module' }> {
  const directional = input.conclusionDirection === 'bullish' || input.conclusionDirection === 'bearish'
  const opposing = directional && input.signalDirection !== undefined && input.conclusionDirection !== input.signalDirection
  const newInformation = input.signalFactIds !== undefined && input.citedFactIds.some((id) => !input.signalFactIds!.includes(id))
  const quotaHit = input.sentToday.byBucket >= analysisConclusionPushPolicy.perBucketDailyLimit
    ? 'quota-trigger-key' as const
    : input.sentToday.module >= analysisConclusionPushPolicy.moduleDailyLimit ? 'quota-module' as const : undefined
  // 「同向只进中心」只对**信号唤起**的那次成立：没有信号就没有"同不同向"可谈，达门槛本身
  // 就是新信息（2026-11-09：消息面达门槛的运行曾被这条按成只进中心，手机永远不响）。
  const signalDriven = input.signalDriven ?? input.signalDirection !== undefined
  const worthPhone = !signalDriven || opposing || newInformation
  if (!worthPhone) return Object.freeze({ phone: false, centerOnly: true, reason: 'same-direction' })
  if (quotaHit !== undefined) return Object.freeze({ phone: false, centerOnly: true, reason: quotaHit })
  return Object.freeze({ phone: true, centerOnly: false })
}

/**
 * 一条结论 → 一次提交通知。**自动推送与手动发送共用这一个构造器**。
 *
 * 两条路径的差别只有两个入参：去重键的第二个分量（手动那条带点击时刻，所以每次点击都是新键）
 * 与要不要收窄到中心（自动推送同向时收窄，读者点名的那次不收窄）。分成两份的话，
 * 标题与正文规则会慢慢长歪——而读者看到的是同一条通知。
 *
 * **事件 id 不在这里**：它由提交点写（`eventTypeId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.analysisConclusion`），
 * 因为生产者门禁要能在提交点附近静态看见它；写成构造器里的一行，门禁就只能报「无法判定」。
 */
export function buildAnalysisConclusionRequest(input: Readonly<{
  summary: string
  citedCount: number
  /** 去重桶：原因码 + 事件（手动发送是它自己的桶）。 */
  bucket: string
  /** 去重键 `analysis:{triggerKey}:{cutoff}` 的第二个分量；手动发送是 `${截止时刻}:${点击时刻}`。 */
  cutoff: string
  occurredAt: string
  centerOnly: boolean
}>): Omit<NotificationSubmitRequest, 'eventTypeId'> {
  const body = buildAnalysisConclusionBody({
    summary: input.summary,
    citedCount: input.citedCount,
    // 推手机时才追「证据 N 条」：只进中心的那条不该在通知中心里写着「· 证据 2 条」而手机没响。
    withContext: !input.centerOnly
  })
  return {
    dedupeVars: { builder: 'template', vars: { bucket: input.bucket, cutoff: input.cutoff } },
    ...(input.centerOnly ? { narrowedDisruptionLevels: ['center'] as const } : {}),
    rendered: {
      'zh-CN': { ...analysisConclusionPushPolicy.renderedCopy['zh-CN'], body: body.text },
      'en-US': { ...analysisConclusionPushPolicy.renderedCopy['en-US'], body: body.text }
    },
    actions: [],
    occurredAt: input.occurredAt
  }
}
