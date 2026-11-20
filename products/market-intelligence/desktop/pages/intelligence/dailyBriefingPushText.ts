import { channelResultWords } from './channelResultText'

/**
 * The push button's words, in one place, keyed so a caller picks a key and never assembles a sentence.
 *
 * Frozen by the acceptance document (二之十八): the success sentence is "handed to {channel}", never
 * "delivered" — we know it reached the channel and nothing more — and the two outcomes are two sentences,
 * because "no receipt received" is the only thing that separates them. The account name comes from the
 * platform's channel label, never from this table.
 */
export type BriefingPushText = Readonly<{
  button: string
  sending: string
  retry: string
  /** 读者自己选的动作：不带图发（不是失败降级）。 */
  sendTextOnly: string
  /** 导读超长时的第二个动作：去把导读写短。 */
  shortenLede: string

  /** 发送中：`{n}` 是点之前可投递的通道条数（回执回来之后一切以逐通道行为准）。 */
  sendingChannels: string

  /**
   * 结果条摘要，**只有数字**：`{n}` = 这次的目标通道数，`{ok}` / `{failed}` / `{pending}` 是三桶
   * （收到 / 没到 / 还没回执）。**没回执不许算进「没到」**——那是拿不到当没有。
   * 通道名一个都不出现在摘要里（它们只在明细的逐行说明里）。
   */
  sentAll: string
  /**
   * 三桶合并句的**三段**（按 收到 / 没到 / 还没回执 的顺序拼，空桶整段不出现）。
   * 三段都在时就是产品定稿那句：`{ok} 条收到，{failed} 条没到，{pending} 条还没回执`。
   * 不写成一整句再按逗号切——翻译会换标点，切出来的段就错位了。
   */
  bucketReceived: string
  bucketFailed: string
  bucketPending: string
  bucketSeparator: string
  sentNone: string
  /** 老回执没有逐通道行时（极少）：只知道聚合档，不编一个条数。 */
  sentAcceptedNoRows: string
  sentUnconfirmedNoRows: string
  notReceivedNoRows: string
  /** 形态前缀（整条同一形态时加；混合形态不加，逐行写清）。 */
  posterPrefix: string
  textPrefix: string
  /** 整条没发：一条可用通道都没有（不是「没收到」）。 */
  noChannels: string

  /**
   * 结果条自己的控件与逐行用词。读屏名与逐通道状态词不在这里：它们在产品文案表里
   * （`push.*` 那一组），状态词要交给平台 `StatusPill` 按档位取键。
   */
  stripInfoTip: string
  toggleOpen: string
  toggleClose: string
  rowCodeLabel: string
  /** 这一行没有形态可写时的占位（没发出去的行）。 */
  rowNoForm: string
  retryMissing: string
  openChannels: string

  channelImage: string
  channelText: string
  channelNotReceived: string
  channelUnknown: string
  channelReasonUnknown: string
  channelReasons: Readonly<Record<string, string>>

  /** 三种「整条不发」的人话；`{chars}` / `{limit}` / `{size}` 由调用方填。 */
  captionTooLong: string
  captionTooLongWhy: string
  posterRenderFailed: string
  posterRenderFailedWhy: string
  posterTooLarge: string
  posterTooLargeWhy: string

  failedTitle: string
  failed: Readonly<Record<BriefingPushFailureKey, string>>
  disabled: Readonly<Record<BriefingPushDisabledKey, string>>
}>

export type BriefingPushFailureKey =
  | 'channel-not-configured'
  | 'channel-disconnected'
  | 'channel-rate-limited'
  | 'capability-missing'
  | 'invoke-failed'
  | 'receipt-unknown'
  | 'push-paused'
  | 'record-missing'
  | 'edition-mismatch'
  | 'surface-invalid'
  | 'poster-refused'
  | 'poster-render-failed'

export type BriefingPushDisabledKey = 'generating' | 'no-edition' | 'missing-locale' | 'capability'

const zh: BriefingPushText = {
  button: '发布频道',
  sending: '正在发布…',
  retry: '重试',
  sendTextOnly: '只发文字',
  shortenLede: '改短导读',
  sendingChannels: '正在发到 {n} 条通道…',
  sentAll: '{n} 条通道都收到了',
  bucketReceived: '{n} 条收到',
  bucketFailed: '{n} 条没到',
  bucketPending: '{n} 条还没回执',
  bucketSeparator: '，',
  sentNone: '没有任何通道收到（共 {n} 条）',
  posterPrefix: '发了海报：',
  textPrefix: '只发了文字：',
  noChannels: '没有可用的通道',
  stripInfoTip: '只说明这一次发布的结果；下一次发布会替换这条。',
  toggleOpen: '展开明细',
  toggleClose: '收起明细',
  rowCodeLabel: '原因码',
  rowNoForm: '—',
  retryMissing: '再发一次没到的',
  openChannels: '去频道',
  sentAcceptedNoRows: '通道收到了',
  sentUnconfirmedNoRows: '已送出去，还没收到回执',
  notReceivedNoRows: '通道没收到',
  channelImage: channelResultWords['zh-CN'].image,
  channelText: channelResultWords['zh-CN'].text,
  channelNotReceived: channelResultWords['zh-CN'].notReceived,
  channelUnknown: channelResultWords['zh-CN'].unknownChannel,
  channelReasonUnknown: channelResultWords['zh-CN'].reasonUnknown,
  channelReasons: channelResultWords['zh-CN'].reasons,
  captionTooLong: '没发出去：导读 {chars} 字，一次最多 {limit} 字',
  captionTooLongWhy: '导读是按原文发的，所以不截断——截断就成了半句话。改短导读会打开这一期的编辑会话，把导读写短后重新生成（会花一次模型调用）；也可以只发文字。',
  posterRenderFailed: '没发出去：这次的海报没渲染出来',
  posterRenderFailedWhy: '图没有生成成功，这次一个字节都没发。可以重试。',
  posterTooLarge: '没发出去：这一版的海报 {size}，上限 {limit}',
  posterTooLargeWhy: '一条消息只带一张图，单张上限 {limit}。可以只发文字。',
  failedTitle: '没发布出去',
  failed: {
    // 读者能做的动作写进句子：去频道页启用一条，而不是一句「未配置」。
    'channel-not-configured': '还没有可用的频道，先到「频道」启用一条',
    'channel-disconnected': '网络连不上 {channel}',
    'channel-rate-limited': '{channel} 限制了发送频率，过一会儿再试',
    // 三种失败各一句：能力不在、请求没发出、回执不认识。原文进日志，界面不复述技术原因。
    'capability-missing': '这个版本还发不了手机推送',
    'invoke-failed': '推送请求没发出去',
    'receipt-unknown': '推送服务回了一个不认识的结果',
    // 暂时性，不是配置问题：会自己恢复，也可以当场重试。
    'push-paused': '推送暂停了：连续失败后会自己恢复，也可以现在重试',
    // 与版次不符同因同果：记录里没有读者眼前这一版。两句若分开写，读者会以为是两种毛病。
    'record-missing': '这一版还没进通知，先重新生成再看',
    'edition-mismatch': '这一版还没进通知，先重新生成再看',
    'surface-invalid': '这次推送没能启动，重开这个页面再试',
    'poster-refused': '这次带海报的发布被整条拒了，可以只发文字',
    'poster-render-failed': '这次的海报没渲染出来，没有发出去；可以重试'
  },
  disabled: {
    generating: '正在生成这一期，生成完就能推',
    'no-edition': '这一天还没有生成过',
    'missing-locale': '这一期还没有{locale}版',
    // Four reader situations, four sentences: waiting, generating, switching language and an old build ask
    // different things of the reader, and one merged sentence would be a guess.
    capability: '暂时推不了：这个版本还没有推送能力'
  }
}

const en: BriefingPushText = {
  button: 'Publish to channel',
  sending: 'Publishing…',
  retry: 'Retry',
  sendTextOnly: 'Send text only',
  shortenLede: 'Shorten the lede',
  sendingChannels: 'Sending to {n} channels…',
  sentAll: 'All {n} channels received it',
  bucketReceived: '{n} received',
  bucketFailed: '{n} did not',
  bucketPending: '{n} awaiting a receipt',
  bucketSeparator: ', ',
  sentNone: 'No channel received it (0 of {n})',
  posterPrefix: 'With the poster: ',
  textPrefix: 'Text only: ',
  noChannels: 'No usable channel',
  stripInfoTip: 'This describes this publish only; the next publish replaces it.',
  toggleOpen: 'Show details',
  toggleClose: 'Hide details',
  rowCodeLabel: 'Reason code',
  rowNoForm: '—',
  retryMissing: 'Send the missing ones again',
  openChannels: 'Go to channels',
  sentAcceptedNoRows: 'The channel received it',
  sentUnconfirmedNoRows: 'Sent, no receipt yet',
  notReceivedNoRows: 'The channel did not receive it',
  channelImage: channelResultWords['en-US'].image,
  channelText: channelResultWords['en-US'].text,
  channelNotReceived: channelResultWords['en-US'].notReceived,
  channelUnknown: channelResultWords['en-US'].unknownChannel,
  channelReasonUnknown: channelResultWords['en-US'].reasonUnknown,
  channelReasons: channelResultWords['en-US'].reasons,
  captionTooLong: 'Not published: the lede is {chars} characters, over the limit of {limit}',
  captionTooLongWhy: 'The lede is sent as written, so it is never truncated. Shortening it opens this edition’s editing session, where you make the lede shorter and regenerate (this spends one model call); you can also send text only.',
  posterRenderFailed: 'Not published: the poster could not be rendered',
  posterRenderFailedWhy: 'The image was never produced, so nothing was sent. You can retry.',
  posterTooLarge: 'Not published: this poster is {size}, over the limit of {limit}',
  posterTooLargeWhy: 'One message carries one image, up to {limit}. Send text only instead.',
  failedTitle: 'Not published',
  failed: {
    'channel-not-configured': 'No channel is available yet; enable one in Channels',
    'channel-disconnected': 'Cannot reach {channel} over the network',
    'channel-rate-limited': '{channel} is rate-limiting sends; try again shortly',
    'capability-missing': 'This build cannot send to a phone yet',
    'invoke-failed': 'The push request did not go out',
    'receipt-unknown': 'The push service returned an unexpected answer',
    'push-paused': 'Push is paused: it comes back after repeated failures, or retry now',
    'record-missing': 'This edition is not in the notifications yet; generate it again first',
    'edition-mismatch': 'This edition is not in the notifications yet; generate it again first',
    'surface-invalid': 'This send could not start; reopen this page and try again',
    'poster-refused': 'The publish with a poster was refused as a whole; try sending text only',
    'poster-render-failed': 'The poster could not be rendered, so nothing was sent; you can retry'
  },
  disabled: {
    generating: 'This edition is still being generated; you can send it once it is ready',
    'no-edition': 'Nothing has been generated for this day yet',
    'missing-locale': 'This edition has no {locale} version yet',
    capability: 'Not available yet: this build cannot send to a phone'
  }
}

export const briefingPushText: Readonly<Record<'zh-CN' | 'en-US', BriefingPushText>> = Object.freeze({ 'zh-CN': zh, 'en-US': en })

/**
 * One sentence, one fill: `{channel}` and `{locale}` are the only holes, and a caller that has no value for
 * one of them gets the sentence with the placeholder rather than a sentence with an empty parenthesis.
 */
export function fillBriefingPush(template: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(value), template)
}
