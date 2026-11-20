import { useEffect, useState } from 'react'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { prepareBriefingPublish, BRIEFING_PUBLISH_CAPTION_MAX_CHARS, BRIEFING_PUBLISH_POSTER_MAX_BYTES } from './briefingPosterPublish'
import {
  briefingPushAvailable,
  readBriefingPushChannel,
  redeliverBriefingPush,
  type BriefingPushChannel,
  type BriefingPushChannelResult,
  type BriefingPushEdition
} from './dailyBriefingPushClient'
import type { BriefingPushText } from './dailyBriefingPushText'
import { useBriefingPush, type BriefingPushDisabledReason, type BriefingPushState } from './dailyBriefingPushWiring'

/**
 * 「发布频道」在页面上的那一层：把页面知道的事翻成状态机要的输入，再把状态机的话翻成**读者看到的那一行**。
 *
 * 三件只在这里做的事：
 * - **哪一版能发**：屏幕上这一版（`date + periodId + locale`），不是"最近一期"。取最近一期等于把读者
 *   没在读的一期发到频道里，而他自己看不出来。
 * - **为什么不能发**：五种处境五句话，判定顺序固定：能力 → 正在生成 → 缺这一语言 → 没有版次 →
 *   不是主语言。先判"这个构建根本发不了"，因为其余四种都在说"等一等就有了"，而它不会自己好。
 * - **发之前先出图**：海报在**第一个字节出站之前**渲染并判定（导读长度 / 出图失败 / 图太大），
 *   三种「整条不发」都不调 IPC。**只发文字**是读者自己选的动作，不是失败后的自动降级。
 *
 * 结果那一行：正文只有数字与动作，逐通道的「名字 · 发了什么 · 到没到」全在 ⓘ 里。
 */
export type BriefingPushResultTone = 'info' | 'caution' | 'danger'
export type BriefingPushRowOutcome = 'received' | 'not-received' | 'pending'

/** 明细里的一条通道：名字 / 结果 / 形态 / 人话原因 / 原因码（码只折叠在明细里）。 */
export type BriefingPushResultRow = Readonly<{
  name: string
  outcome: BriefingPushRowOutcome
  form?: 'poster' | 'text'
  reason?: string
  reasonCode?: string
}>

export type BriefingPushActionKey = 'retry' | 'retry-missing' | 'send-text-only' | 'shorten-lede' | 'open-channels'

export type BriefingPushResultView = Readonly<{
  tone: BriefingPushResultTone
  /** 摘要那一句：只有数字（形态前缀 + 三桶合并句 / 全成 / 全败 / 整条没发）。 */
  summary: string
  rows: readonly BriefingPushResultRow[]
  /** **最多一颗**行内文字动作（不是主按钮）。 */
  action?: Readonly<{ key: BriefingPushActionKey; label: string; tip?: string }>
  /** 发送中：没有可关闭、没有明细折叠（还没结果可看）。 */
  sending?: true
}>

export type BriefingPushToPhone = Readonly<{
  state: BriefingPushState
  /** 结果条的内容；`undefined` 时整条不渲染（空闲、禁用）。 */
  result: BriefingPushResultView | undefined
  onPush: () => void
  onRetry: () => void
  onSendTextOnly: () => void
  onClose: () => void
  onAction: (key: BriefingPushActionKey) => void
  onOpenChannels?: () => void
  onShortenLede?: () => void
}>

export function useBriefingPushToPhone(input: Readonly<{
  document: DailyBriefingDocument | undefined
  /** A run is in flight — scheduled or started in another window, not only by this page. */
  generating: boolean
  /** The pane says this language has no edition, which is its own sentence. */
  localeMissing: boolean
  /** Which issue of that day this is; the platform keys the notice by all three values. */
  periodId: string
  text: BriefingPushText
  /**
   * Bumped when the channel may have changed elsewhere — the settings drawer closing, the window
   * regaining focus. Without it the answer read at mount is the answer forever: a reader who goes off
   * to configure a channel comes back to a disabled button still claiming this build cannot send.
   */
  refreshKey?: number
  /** 屏幕上的海报根节点（发布用的那张纸）；没有就不带图发。 */
  posterRoot?: () => HTMLElement | null
  /** 「改短导读」：打开这一版的编辑会话把导读写短（没有会话就不给这颗动作）。 */
  onShortenLede?: (() => void) | undefined
  /** 「去频道」：一条可用通道都没有时那条路。 */
  onOpenChannels?: (() => void) | undefined
}>): BriefingPushToPhone {
  const [channel, setChannel] = useState<BriefingPushChannel>({
    wired: undefined, name: undefined, deliverableCount: undefined
  })
  const onOpenChannels = input.onOpenChannels
  const onShortenLede = input.onShortenLede

  useEffect(() => {
    let active = true
    void readBriefingPushChannel().then((answer) => {
      if (active) setChannel(answer)
    })
    return () => { active = false }
  }, [input.refreshKey])

  const document = input.document
  const edition: BriefingPushEdition | undefined = document === undefined
    ? undefined
    : Object.freeze({ date: document.edition.date, periodId: input.periodId, locale: document.edition.locale })

  const blocked: BriefingPushDisabledReason | undefined =
    !briefingPushAvailable() || channel.wired === false ? 'capability'
      : input.generating ? 'generating'
        : input.localeMissing ? 'missing-locale'
          : edition === undefined ? 'no-edition'
            : undefined

  const { state, push, retry, sendTextOnly, dismiss } = useBriefingPush({
    edition,
    ...(blocked === undefined ? {} : { blocked }),
    send: redeliverBriefingPush,
    // 导读取自**这一版自己的文档**（冻结的事实），不在这里另拼一份。
    prepare: () => prepareBriefingPublish({
      caption: document?.lede?.text ?? '',
      posterRoot: input.posterRoot?.() ?? null
    })
  })

  const result = describeResult(state, {
    text: input.text,
    channelCount: channel.deliverableCount,
    hasShorten: onShortenLede !== undefined,
    hasChannelsPage: onOpenChannels !== undefined
  })
  const onAction = (key: BriefingPushActionKey): void => {
    if (key === 'retry') retry()
    else if (key === 'retry-missing') retry()
    else if (key === 'send-text-only') sendTextOnly()
    else if (key === 'shorten-lede') onShortenLede?.()
    else onOpenChannels?.()
  }

  return {
    state,
    result,
    onPush: push,
    onRetry: retry,
    onSendTextOnly: sendTextOnly,
    onClose: dismiss,
    onAction,
    ...(onShortenLede === undefined ? {} : { onShortenLede }),
    ...(onOpenChannels === undefined ? {} : { onOpenChannels })
  }
}

const MB = 1024 * 1024

/** 字节 → 读者看得懂的大小（1024 进制，一位小数）。 */
export function formatPosterBytes(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

type Buckets = Readonly<{ total: number; received: number; failed: number; pending: number }>

function bucketsOf(channels: readonly BriefingPushChannelResult[] | undefined): Buckets | undefined {
  if (channels === undefined || channels.length === 0) return undefined
  const received = channels.filter((channel) => channel.state === 'sent-accepted').length
  const pending = channels.filter((channel) => channel.state === 'sent-unconfirmed').length
  const total = channels.length
  return { total, received, failed: total - received - pending, pending }
}

/**
 * 状态 → 结果条。**三桶分开数**：收到只认 `sent-accepted`，没到认 `failed` / `queued`，
 * `sent-unconfirmed` 自成一桶（等回执）——绝不把它算进「没到」，那是拿不到当没有。
 *
 * 颜色三档（只有这三档）：全成 `info`（中性，不染绿）；部分成与有未回执 `caution`；
 * 全败与三种「整条不发」`danger`。
 */
function describeResult(
  state: BriefingPushState,
  input: Readonly<{
    text: BriefingPushText
    channelCount: number | undefined
    hasShorten: boolean
    hasChannelsPage: boolean
  }>
): BriefingPushResultView | undefined {
  const text = input.text
  if (state.kind === 'sending') {
    // 发送中：`{n}` 是点之前可投递的条数（乐观上界）；拿不到就不编一个数。
    const summary = input.channelCount === undefined || input.channelCount === 0
      ? text.sending
      : text.sendingChannels.replace('{n}', String(input.channelCount))
    return { tone: 'info', summary, rows: [], sending: true }
  }
  switch (state.kind) {
    case 'result': {
      const channels = state.channels
      const buckets = bucketsOf(channels)
      const rows = channels === undefined ? [] : channelRows(channels, text)
      const noChannels = state.delivery === 'failed' && state.deliveryReason === 'push-unavailable'
      const counts = buckets ?? (state.delivery === 'sent-accepted'
        ? { summary: text.sentAcceptedNoRows, tone: 'info' as const }
        : state.delivery === 'sent-unconfirmed'
          ? { summary: text.sentUnconfirmedNoRows, tone: 'caution' as const }
          : { summary: text.notReceivedNoRows, tone: 'danger' as const })
      if (noChannels) {
        return {
          tone: 'danger',
          summary: text.noChannels,
          rows: [],
          ...(input.hasChannelsPage
            ? { action: { key: 'open-channels' as const, label: text.openChannels } }
            : {})
        }
      }
      const summary = 'summary' in counts ? counts.summary : summaryOf(buckets!, text)
      const tone = 'tone' in counts ? counts.tone : toneOf(buckets!)
      // 形态前缀：整条尝试是「只发文字」还是「带海报」——读者点了只发文字之后要知道海报没发。
      const prefixed = state.attempt === 'text' ? `${text.textPrefix}${summary}` : `${text.posterPrefix}${summary}`
      return { tone, summary: prefixed, rows, ...(actionOf(buckets, text)) }
    }
    case 'failed': {
      // 渲不出来可以重试（多半是一次性的）；主进程拒了这次带图发布给「只发文字」。
      const action: BriefingPushActionKey = state.reason === 'poster-refused' ? 'send-text-only' : 'retry'
      return {
        tone: 'danger',
        summary: `${text.failedTitle}：${text.failed[state.reason]}`,
        rows: [],
        action: actionOf2(action, input, text)
      }
    }
    case 'caption-too-long': {
      // 产品定稿：只有两颗里的一颗——没有编辑会话就给不出「改短导读」，那时不摆动作。
      return {
        tone: 'danger',
        summary: text.captionTooLong
          .replace('{chars}', String(state.chars))
          .replace('{limit}', String(BRIEFING_PUBLISH_CAPTION_MAX_CHARS)),
        rows: [],
        ...(input.hasShorten
          ? { action: { key: 'shorten-lede' as const, label: text.shortenLede, tip: text.captionTooLongWhy } }
          : {})
      }
    }
    case 'poster-too-large': {
      // 图太大：说清多大，只给「只发文字」（重试同一张图没有意义）。
      return {
        tone: 'danger',
        summary: text.posterTooLarge
          .replace('{size}', formatPosterBytes(state.byteLength))
          .replace('{limit}', formatPosterBytes(BRIEFING_PUBLISH_POSTER_MAX_BYTES)),
        rows: [],
        action: actionOf2('send-text-only', input, text)
      }
    }
    default:
      return undefined
  }
}

/** 全成的摘要 / 全败的摘要；部分成走三桶合并句。 */
function summaryOf(buckets: Buckets, text: BriefingPushText): string {
  if (buckets.received === buckets.total) return text.sentAll.replace('{n}', String(buckets.total))
  if (buckets.received === 0 && buckets.failed === 0) {
    // 全都在等回执：只有 pending 一段。
    return text.bucketPending.replace('{n}', String(buckets.pending))
  }
  if (buckets.received === 0 && buckets.pending === 0) return text.sentNone.replace('{n}', String(buckets.total))
  const segments: string[] = []
  if (buckets.received > 0) segments.push(text.bucketReceived.replace('{n}', String(buckets.received)))
  if (buckets.failed > 0) segments.push(text.bucketFailed.replace('{n}', String(buckets.failed)))
  if (buckets.pending > 0) segments.push(text.bucketPending.replace('{n}', String(buckets.pending)))
  return segments.join(text.bucketSeparator)
}

function toneOf(buckets: Buckets): BriefingPushResultTone {
  if (buckets.failed === 0 && buckets.pending === 0) return 'info'
  if (buckets.received === 0 && buckets.failed === buckets.total) return 'danger'
  return 'caution'
}

/**
 * 结果条上**最多一颗**动作，按结果选：
 * - 有等回执的 → 不给（等它回来）；
 * - 全败 → 重试（一条都没收到，重发不会重复）；
 * - 部分成 → 「再发一次没到的」。这条路现在是安全的：投递层按**本次请求的意图**选路，重发带海报
 *   时**跳过已 `sent-accepted` 的通道**，一条都不需要补就不发、不读图、不虚增推送次数（频道线
 *   `cb5ef08`）。所以带海报的结果条和纯文字的结果条一样给这颗动作。
 */
function actionOf(
  buckets: Buckets | undefined,
  text: BriefingPushText
): Readonly<{ action?: Readonly<{ key: BriefingPushActionKey; label: string }> }> {
  if (buckets === undefined) return {}
  if (buckets.pending > 0) return {}
  if (buckets.received === buckets.total) return {}
  if (buckets.received === 0 && buckets.failed === buckets.total) {
    return { action: { key: 'retry', label: text.retry } }
  }
  return { action: { key: 'retry-missing', label: text.retryMissing } }
}

function actionOf2(
  key: BriefingPushActionKey,
  input: Readonly<{ text: BriefingPushText }>,
  text: BriefingPushText
): Readonly<{ key: BriefingPushActionKey; label: string }> {
  void input
  return {
    key,
    label: key === 'send-text-only' ? text.sendTextOnly : key === 'shorten-lede' ? text.shortenLede : text.retry
  }
}

/**
 * 明细一行一条通道：名字 / 结果 / 形态 / 人话原因 / 原因码（折叠，由组件渲染）。
 * **降级必须看得出来**：`kind: 'text'` 的那条写「只发了文字（没有海报）」，绝不写成「发了海报」。
 */
function channelRows(
  channels: readonly BriefingPushChannelResult[],
  text: BriefingPushText
): readonly BriefingPushResultRow[] {
  return channels.map((channel) => {
    const outcome: BriefingPushRowOutcome = channel.state === 'sent-accepted'
      ? 'received'
      : channel.state === 'sent-unconfirmed' ? 'pending' : 'not-received'
    return {
      name: channel.channelName ?? text.channelUnknown,
      outcome,
      ...(channel.kind === 'image' ? { form: 'poster' as const } : channel.kind === 'text' ? { form: 'text' as const } : {}),
      // 原因只在「没到」时给人话；等回执那行自己就是原因（还没收到回执）。
      ...(outcome !== 'not-received'
        ? {}
        : { reason: channel.reason === undefined ? text.channelNotReceived : text.channelReasons[channel.reason] ?? text.channelReasonUnknown }),
      ...(channel.reason === undefined ? {} : { reasonCode: channel.reason })
    }
  })
}
