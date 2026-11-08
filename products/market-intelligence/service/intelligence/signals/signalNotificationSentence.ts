import type { NotificationContentByLanguage } from '@platform/notifications/contracts/notificationContracts'
import { formatNotificationNumber } from '@platform/notifications/contracts/notificationNumberFormat'

import {
  signalNotificationSentences,
  type SignalNotificationVariant
} from '../../../contracts/signalNotificationSentences'
import { thresholdMultiple } from './signalNotificationCopy'
import {
  composeBothLanguages,
  fillTemplate,
  type SentenceLanguage
} from './notificationSentenceTemplate'

/**
 * 源头拼信号通知的成品句子（契约 v2.56）：平台只按读者语言挑一份，不拼、不改。
 *
 * 两条边界：
 * - **拼不出就不提交**。任何一格缺失（数字不是有限数、阈值算不出来）返回 `undefined`，
 *   由调用点放弃这次提交——`copy-missing` 是「源头没拼完」，不是平台的降级动作；
 * - **中英各一份**，同一批事实、两种说法。只给一份就会把语言钉死在提交那一刻。
 *
 * 数字格式化仍走平台那一个实现（`formatNotificationNumber`）：读数、阈值、倍数怎么舍入不该
 * 在这里长出第二套，否则同一条信号在中心与手机上的读法会不一样。
 *
 * 结构化读数的真源在信号表，不在通知记录里：这里拼出来的句子只回答「当时我们对读者说了什么」，
 * 将来详情页要读数请回源里取，**不要反解析这些句子**。
 */

function compose(
  input: Readonly<{ asset: string; variant: SignalNotificationVariant }>,
  bodyValues: (language: SentenceLanguage) => Readonly<Record<string, string | null>>
): NotificationContentByLanguage | undefined {
  return composeBothLanguages((language) => {
    const sheet = signalNotificationSentences[language]
    const title = fillTemplate(sheet.title, { asset: input.asset, headline: sheet.headline[input.variant] })
    const body = fillTemplate(sheet.body[input.variant], bodyValues(language))
    if (title === undefined || body === undefined) return undefined
    return { title, body, reason: sheet.reason }
  })
}

export type EtfOutflowSentenceInput = Readonly<{
  /** 读者认得的符号：`BTC` / `ETH`。 */
  asset: string
  /** 三日累计净流（可为负；符号由「净流出」这个词表达，格式化只出绝对值）。 */
  flowUsd: number
  /** 规则常量本身，不是另算一遍的数。 */
  thresholdUsd: number
  /** 三日累计判到的那一天（`YYYY-MM-DD`）：读者要知道「截至哪天收盘」。 */
  asOfDate: string
  aggravated: boolean
}>

export function renderEtfOutflowSentence(
  input: EtfOutflowSentenceInput
): NotificationContentByLanguage | undefined {
  if (!Number.isFinite(input.flowUsd) || !Number.isFinite(input.thresholdUsd)) return undefined
  // 「截至哪天」是这条提醒的一半事实：缺了它，读者分不清半天数与定稿数。日期坏掉就不发。
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate)) return undefined
  const asOf = input.asOfDate.slice(5)
  const variant: SignalNotificationVariant = input.aggravated ? 'etfOutflowAggravated' : 'etfOutflow'
  return compose({ asset: input.asset, variant }, (language): Record<string, string | null> => {
    const amount = formatNotificationNumber({ number: input.flowUsd, kind: 'usd' }, language)
    if (!input.aggravated) {
      return { amount, asOf, threshold: formatNotificationNumber({ number: input.thresholdUsd, kind: 'usd' }, language) }
    }
    const multiple = thresholdMultiple(input.flowUsd, input.thresholdUsd)
    return { amount, asOf, multiple: formatNotificationNumber({ number: multiple, kind: 'multiple' }, language) }
  })
}

export type OpenInterestSentenceInput = Readonly<{
  asset: string
  /** 这个桶里的跌幅（负数）。 */
  dropPct: number
  /** 成交放大倍数。 */
  volumeMultiple: number
  /** 这个桶的持仓名义额。 */
  notionalUsd: number
  /** 规则常量：常规阈值或强阈值，二选一。 */
  thresholdPct: number
  /** 哪一边被清：词与句子都跟着它分叉，读者就不会把两头做反。 */
  direction: 'long' | 'short'
  /** 空头那条的带符号涨幅（正数）；多头那条不用。 */
  pricePct?: number
  aggravated: boolean
}>

export function renderOpenInterestSentence(
  input: OpenInterestSentenceInput
): NotificationContentByLanguage | undefined {
  const finite = [input.dropPct, input.volumeMultiple, input.notionalUsd, input.thresholdPct]
  if (!finite.every((value) => Number.isFinite(value))) return undefined
  // 空头那条的正文写「涨了多少」：缺这个数就不发，绝不拿跌幅顶替。
  // 数字格式化只出绝对值、正负号由词承担，所以**符号必须在这里判**：把 -1.8 喂进来会印成
  // 「涨 1.8%」，一句话把读者送到反方向去。方向错了就拼不出句子，由调用点放弃这次提交。
  if (input.direction === 'short' && !(Number.isFinite(input.pricePct) && input.pricePct! > 0)) return undefined
  const short = input.direction === 'short'
  const variant: SignalNotificationVariant = short
    ? (input.aggravated ? 'oiShortAggravated' : 'oiShort')
    : (input.aggravated ? 'oiLongAggravated' : 'oiLong')
  return compose({ asset: input.asset, variant }, (language): Record<string, string | null> => {
    const dropPct = formatNotificationNumber({ number: input.dropPct, kind: 'pct' }, language)
    const thresholdPct = formatNotificationNumber({ number: input.thresholdPct, kind: 'pct' }, language)
    const pricePct = short ? formatNotificationNumber({ number: input.pricePct!, kind: 'pct' }, language) : dropPct
    return {
      dropPct,
      pricePct,
      ...(input.aggravated ? { strongPct: thresholdPct } : { thresholdPct }),
      multiple: formatNotificationNumber({ number: input.volumeMultiple, kind: 'multiple' }, language),
      notional: formatNotificationNumber({ number: input.notionalUsd, kind: 'usd' }, language)
    }
  })
}
