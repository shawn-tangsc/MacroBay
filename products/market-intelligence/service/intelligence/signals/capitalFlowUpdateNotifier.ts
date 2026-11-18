import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationSubmitContracts'
import { formatNotificationNumber } from '@platform/notifications/contracts/notificationNumberFormat'

import {
  capitalFlowNotificationSentences,
  netFlowDirection,
  type CapitalFlowSentenceLanguage
} from '../../../contracts/capitalFlowNotificationSentences'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { composeBothLanguages, fillTemplate } from './notificationSentenceTemplate'

/**
 * 「ETF 这一天的读数变了」出站为一条应用内提醒（R42；口径见 r42 的 01-prd §1）。
 *
 * 三种情形**不由这里判**，判在刷新服务里：这是新交易日、还是已定稿值被修订、还是只是来源换了。
 * 这里只负责把「已经判定的变化」说清楚——改数那条**必须同时给出旧值与新值**，只说「数据已更新」
 * 等于让读者自己去猜哪变了。
 *
 * 去重键由平台按声明里的模板展开（`capital-flow-etf-update:{asset}:{tradingDate}`）：
 * 同一交易日同一资产 24 小时内一条，首次与改数共用（改数通常发生在 24 小时之后，所以两条都会发）。
 */

/** 稳定 handler id：换名字会让平台把它当成另一个生产者。 */
export const ETF_CAPITAL_FLOW_PRODUCER_ID = 'market-intelligence.etf-flow-refresh'

export type EtfCapitalFlowUpdate = Readonly<{
  kind: 'arrived' | 'revised'
  asset: 'BTC' | 'ETH'
  tradingDate: string
  netFlowUsd: number
  /** 改数时读者上次看到的那个值；`arrived` 没有它。 */
  previousUsd?: number
  /**
   * 这一轮采集的时刻（不是交易日零点）：中心里那一条的「发生时间」必须是读者**今天几点收到的**，
   * 写成交易日零点会让往回翻的人对不上号（产品 2026-11-18 审出来的）。正文里已有交易日。
   */
  occurredAt: string
}>

export type CapitalFlowNoticeSubmit = (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>

function amount(absUsd: number, language: CapitalFlowSentenceLanguage): string | null {
  return formatNotificationNumber({ kind: 'usd', number: Math.abs(absUsd) }, language)
}

/**
 * 拼中英两份成品句。任何一格拼不出来就返回 `undefined`，调用点放弃这次提交——
 * 半句真话比不说更糟（改数只说「改了」就是典型）。
 */
export function renderEtfCapitalFlowSentence(update: EtfCapitalFlowUpdate) {
  return composeBothLanguages((language) => {
    const sheet = capitalFlowNotificationSentences[language]
    const direction = sheet.direction[netFlowDirection(update.netFlowUsd)]
    const currentAmount = amount(update.netFlowUsd, language)
    if (currentAmount === null) return undefined
    if (update.kind === 'arrived') {
      const title = fillTemplate(sheet.etfTitle, { asset: update.asset })
      const body = fillTemplate(sheet.etfArrivedBody, {
        day: update.tradingDate, direction, amount: currentAmount
      })
      return title === undefined || body === undefined ? undefined : { title, body, reason: sheet.etfReason }
    }
    if (update.previousUsd === undefined) return undefined
    const previousAmount = amount(update.previousUsd, language)
    if (previousAmount === null) return undefined
    const title = fillTemplate(sheet.etfRevisedTitle, { asset: update.asset })
    const body = fillTemplate(sheet.etfRevisedBody, {
      day: update.tradingDate,
      previousDirection: sheet.direction[netFlowDirection(update.previousUsd)],
      previousAmount,
      direction,
      amount: currentAmount
    })
    return title === undefined || body === undefined ? undefined : { title, body, reason: sheet.etfReason }
  })
}

export function buildEtfCapitalFlowUpdateRequest(
  update: EtfCapitalFlowUpdate
): NotificationSubmitRequest | undefined {
  const rendered = renderEtfCapitalFlowSentence(update)
  if (rendered === undefined) return undefined
  return {
    eventTypeId: EVENT_IDS.capitalFlowEtfUpdated,
    producerId: ETF_CAPITAL_FLOW_PRODUCER_ID,
    dedupeVars: {
      builder: 'template',
      vars: { asset: update.asset, tradingDate: update.tradingDate }
    },
    rendered,
    actions: [],
    // 发生时间 = 这一轮采集的时刻；交易日已经在正文里（两者混用会让中心的时间线错位）。
    occurredAt: update.occurredAt
  }
}

/**
 * 发出去。没有提交入口（例如未接通知的运行环境）时静默跳过；
 * 一条提醒发不出去不能把已经落库的行情判成失败，所以吞掉提交异常。
 */
export async function notifyEtfCapitalFlowUpdates(
  submit: CapitalFlowNoticeSubmit | undefined,
  updates: readonly EtfCapitalFlowUpdate[]
): Promise<readonly NotificationSubmitOutcome[]> {
  if (submit === undefined || updates.length === 0) return []
  const outcomes: NotificationSubmitOutcome[] = []
  for (const update of updates) {
    const request = buildEtfCapitalFlowUpdateRequest(update)
    if (request === undefined) continue
    try {
      outcomes.push(await submit(request))
    } catch {
      // 通知不是事实来源。
    }
  }
  return outcomes
}
