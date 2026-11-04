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
  /** `{channel}` is filled with the platform's own label, e.g. "Telegram · 贾维斯". */
  sentAccepted: string
  sentUnconfirmed: string
  /**
   * The word `{channel}` falls back to when the platform has not named one. Not a channel name: an
   * unnamed channel must not be printed as a placeholder brace or as an invented brand.
   */
  channelUnknown: string
  failedTitle: string
  failed: Readonly<Record<BriefingPushFailureKey, string>>
  disabled: Readonly<Record<BriefingPushDisabledKey, string>>
}>

export type BriefingPushFailureKey =
  | 'channel-not-configured'
  | 'channel-disconnected'
  | 'channel-rate-limited'
  | 'runtime-unavailable'
  | 'push-paused'
  | 'record-missing'
  | 'edition-mismatch'
  | 'surface-invalid'

export type BriefingPushDisabledKey = 'generating' | 'no-edition' | 'missing-locale' | 'capability'

const zh: BriefingPushText = {
  button: '推送到手机',
  sending: '正在推送…',
  retry: '重试',
  sentAccepted: '已交给 {channel}',
  sentUnconfirmed: '已交给 {channel}（未拿到回执）',
  channelUnknown: '推送通道',
  failedTitle: '没推出去',
  failed: {
    'channel-not-configured': '还没有配置推送通道，先去频道设置里配一条',
    'channel-disconnected': '连不上 {channel}',
    'channel-rate-limited': '{channel} 限制了发送频率，过一会儿再试',
    'runtime-unavailable': '推送服务还没启动',
    // 暂时性，不是配置问题：别让读者去改设置。
    'push-paused': '推送暂时停了，过一会儿会自动恢复',
    // 与版次不符同因同果：记录里没有读者眼前这一版。两句若分开写，读者会以为是两种毛病。
    'record-missing': '这一版还没进通知，先重新生成再看',
    'edition-mismatch': '这一版还没进通知，先重新生成再看',
    'surface-invalid': '这次推送没能启动，重开这个页面再试'
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
  button: 'Send to phone',
  sending: 'Sending…',
  retry: 'Retry',
  sentAccepted: 'Handed to {channel}',
  sentUnconfirmed: 'Handed to {channel} (no receipt received)',
  channelUnknown: 'the push channel',
  failedTitle: 'Not sent',
  failed: {
    'channel-not-configured': 'No push channel is configured yet; add one in channel settings',
    'channel-disconnected': 'Cannot reach {channel}',
    'channel-rate-limited': '{channel} is rate-limiting sends; try again shortly',
    'runtime-unavailable': 'The push service is not running yet',
    'push-paused': 'Push is paused for now; it comes back by itself',
    'record-missing': 'This edition is not in the notifications yet; generate it again first',
    'edition-mismatch': 'This edition is not in the notifications yet; generate it again first',
    'surface-invalid': 'This send could not start; reopen this page and try again'
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
