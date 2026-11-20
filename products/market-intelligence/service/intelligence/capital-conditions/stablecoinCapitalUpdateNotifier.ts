import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationSubmitContracts'
import { formatNotificationNumber } from '@platform/notifications/contracts/notificationNumberFormat'

import {
  capitalFlowNotificationSentences,
  netFlowDirection,
  readerDayKey,
  type CapitalFlowSentenceLanguage
} from '../../../contracts/capitalFlowNotificationSentences'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { composeBothLanguages, fillTemplate } from '../signals/notificationSentenceTemplate'

/**
 * 「稳定币总供给变了」出站为一条应用内提醒（R42）。
 *
 * 与 ETF 那条的差别只有一个：稳定币**没有交易日**这个概念（一天里连续变化），所以
 * 键不带日期、24 小时一条，同一天再多变化也只提醒第一条，其余看卡片。
 */
export const STABLECOIN_CAPITAL_PRODUCER_ID = 'market-intelligence.capital-conditions-refresh'

export type StablecoinCapitalUpdate = Readonly<{
  /** 总供给（USDT + USDC 的当前流通量，美元）。 */
  totalSupplyUsd: number
  /** 一日变化（带符号；方向由词表达）。 */
  change1dUsd: number
}>

function amount(absUsd: number, language: CapitalFlowSentenceLanguage): string | null {
  return formatNotificationNumber({ kind: 'usd', number: Math.abs(absUsd) }, language)
}

export function renderStablecoinCapitalUpdateSentence(update: StablecoinCapitalUpdate) {
  return composeBothLanguages((language) => {
    const sheet = capitalFlowNotificationSentences[language]
    const supply = amount(update.totalSupplyUsd, language)
    const change = amount(update.change1dUsd, language)
    if (supply === null || change === null) return undefined
    const body = fillTemplate(sheet.stablecoinBody, {
      amount: supply,
      direction: sheet.direction[netFlowDirection(update.change1dUsd)],
      change
    })
    return body === undefined ? undefined : { title: sheet.stablecoinTitle, body, reason: sheet.stablecoinReason }
  })
}

export function buildStablecoinCapitalUpdateRequest(
  update: StablecoinCapitalUpdate,
  occurredAt: string,
  timeZone: string
): NotificationSubmitRequest | undefined {
  const rendered = renderStablecoinCapitalUpdateSentence(update)
  if (rendered === undefined) return undefined
  return {
    eventTypeId: EVENT_IDS.capitalFlowStablecoinUpdated,
    producerId: STABLECOIN_CAPITAL_PRODUCER_ID,
    // 键里带**读者日**：一天一条（用户 2026-11-18「不进中心」要求 occurrence 去重）。
    dedupeVars: {
      builder: 'template',
      vars: { day: readerDayKey(occurredAt, timeZone) ?? occurredAt.slice(0, 10) }
    },
    rendered,
    actions: [],
    occurredAt
  }
}

export async function notifyStablecoinCapitalUpdate(
  submit: ((request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>) | undefined,
  update: StablecoinCapitalUpdate,
  occurredAt: string,
  timeZone: string
): Promise<NotificationSubmitOutcome | null> {
  if (submit === undefined) return null
  const request = buildStablecoinCapitalUpdateRequest(update, occurredAt, timeZone)
  if (request === undefined) return null
  try {
    return await submit(request)
  } catch {
    return null
  }
}
