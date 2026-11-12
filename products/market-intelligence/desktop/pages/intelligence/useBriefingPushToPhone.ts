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
export type BriefingPushChannelRow = Readonly<{ name: string; detail: string }>
export type BriefingPushActionKey = 'retry' | 'send-text-only' | 'shorten-lede'

export type BriefingPushResultView = Readonly<{
  /** 正文那一句：数字与会话，不带通道名。 */
  message: string
  /** ⓘ 的逐通道说明；没有回执通道行时为空（不画空气泡）。 */
  channels?: readonly BriefingPushChannelRow[]
  /** 动作（按顺序摆）：重试 / 只发文字 / 缩短导读。 */
  actions: readonly Readonly<{ key: BriefingPushActionKey; label: string }>[]
  /** ⓘ 里那句解释（为什么整条不发 / 为什么不截断）；成功时没有。 */
  why?: string
}>

export type BriefingPushToPhone = Readonly<{
  state: BriefingPushState
  /** 读者看到的那一行；`undefined` 时整行不渲染（空闲、发送中、禁用）。 */
  result: BriefingPushResultView | undefined
  onPush: () => void
  onRetry: () => void
  onSendTextOnly: () => void
  /** 导读超长时的第二个动作：去把导读写短（打开这一版的编辑会话）。没有会话时不给这颗。 */
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
  /** 导读超长的第二动作：打开这一版的编辑会话去把导读写短。 */
  onShortenLede?: (() => void) | undefined
}>): BriefingPushToPhone {
  const [channel, setChannel] = useState<BriefingPushChannel>({ wired: undefined, name: undefined })

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

  const { state, push, retry, sendTextOnly } = useBriefingPush({
    edition,
    ...(blocked === undefined ? {} : { blocked }),
    send: redeliverBriefingPush,
    // 导读取自**这一版自己的文档**（冻结的事实），不在这里另拼一份。
    prepare: () => prepareBriefingPublish({
      caption: document?.lede?.text ?? '',
      posterRoot: input.posterRoot?.() ?? null
    })
  })

  return {
    state,
    result: describeResult(state, input),
    onPush: push,
    onRetry: retry,
    onSendTextOnly: sendTextOnly,
    ...(input.onShortenLede === undefined ? {} : { onShortenLede: input.onShortenLede })
  }
}

const MB = 1024 * 1024

/** 字节 → 读者看得懂的大小（1024 进制，一位小数）。 */
export function formatPosterBytes(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * 状态 → 读者那一行。
 *
 * 计数只从逐通道行来：收到只认 `sent-accepted`，`sent-unconfirmed` 既不算收到也不算没到
 * （只要有一条未回执，正文就走中性句），其余（`failed` / `queued`）算没到。
 */
function describeResult(
  state: BriefingPushState,
  input: Readonly<{ text: BriefingPushText; onShortenLede?: (() => void) | undefined }>
): BriefingPushResultView | undefined {
  const text = input.text
  switch (state.kind) {
    case 'result': {
      const channels = state.channels
      return {
        message: countMessage(channels, state.delivery, text),
        ...(channels === undefined ? {} : { channels: channelRows(channels, text) }),
        actions: []
      }
    }
    case 'failed': {
      // 渲不出来可以重试（多半是一次性的）；主进程拒了这次带图发布则给「只发文字」。
      const actions: BriefingPushActionKey[] = state.reason === 'poster-refused' ? ['send-text-only', 'retry'] : ['retry']
      return { message: `${text.failedTitle}：${text.failed[state.reason]}`, actions: actionViews(actions, text, input) }
    }
    case 'caption-too-long': {
      const actions: BriefingPushActionKey[] = input.onShortenLede === undefined
        ? ['send-text-only']
        : ['send-text-only', 'shorten-lede']
      return {
        message: text.captionTooLong
          .replace('{chars}', String(state.chars))
          .replace('{limit}', String(BRIEFING_PUBLISH_CAPTION_MAX_CHARS)),
        why: text.captionTooLongWhy,
        actions: actionViews(actions, text, input)
      }
    }
    case 'poster-too-large': {
      return {
        message: text.posterTooLarge
          .replace('{size}', formatPosterBytes(state.byteLength))
          .replace('{limit}', formatPosterBytes(BRIEFING_PUBLISH_POSTER_MAX_BYTES)),
        why: text.posterTooLargeWhy,
        actions: actionViews(['send-text-only'], text, input)
      }
    }
    default:
      return undefined
  }
}

function actionViews(
  keys: readonly BriefingPushActionKey[],
  text: BriefingPushText,
  input: Readonly<{ onShortenLede?: (() => void) | undefined }>
): readonly Readonly<{ key: BriefingPushActionKey; label: string }>[] {
  return keys
    // 没有会话就没有「缩短导读」这条路：不摆一颗按了没反应的按钮。
    .filter((key) => key !== 'shorten-lede' || input.onShortenLede !== undefined)
    .map((key) => ({
      key,
      label: key === 'retry' ? text.retry : key === 'send-text-only' ? text.sendTextOnly : text.shortenLede
    }))
}

function countMessage(
  channels: readonly BriefingPushChannelResult[] | undefined,
  delivery: 'sent-accepted' | 'sent-unconfirmed' | 'failed' | 'queued',
  text: BriefingPushText
): string {
  if (channels === undefined || channels.length === 0) {
    return delivery === 'sent-accepted'
      ? text.sentAcceptedNoRows
      : delivery === 'sent-unconfirmed'
        ? text.sentUnconfirmedNoRows
        : text.notReceivedNoRows
  }
  const total = channels.length
  const received = channels.filter((channel) => channel.state === 'sent-accepted').length
  const unconfirmed = channels.filter((channel) => channel.state === 'sent-unconfirmed').length
  if (unconfirmed > 0) return text.sentUnconfirmed.replace('{n}', String(total))
  if (received === total) return text.sentAll.replace('{n}', String(total))
  if (received === 0) return text.sentNone.replace('{n}', String(total))
  return text.sentSome.replace('{ok}', String(received)).replace('{failed}', String(total - received)).replace('{n}', String(total))
}

/**
 * 一行一条通道：「名字 · 发了海报/只发了文字 · 到没到」。
 * **降级必须看得出来**：`kind: 'text'` 的那条写「只发了文字」，绝不写成「发了海报」。
 */
function channelRows(
  channels: readonly BriefingPushChannelResult[],
  text: BriefingPushText
): readonly BriefingPushChannelRow[] {
  return channels.map((channel) => {
    const kind = channel.kind === 'image' ? text.channelImage : channel.kind === 'text' ? text.channelText : undefined
    const outcome = channel.state === 'sent-accepted'
      ? text.channelReceived
      : channel.state === 'sent-unconfirmed'
        ? text.channelUnconfirmed
        : channel.reason === undefined
          ? text.channelNotReceived
          : text.channelReasons[channel.reason] ?? text.channelReasonUnknown
    return {
      name: channel.channelName ?? text.channelUnknown,
      detail: kind === undefined ? outcome : `${kind} · ${outcome}`
    }
  })
}
