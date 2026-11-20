import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationSubmitContracts'

import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { realMarketApiPolicy, type RealMarketApiFailureCode } from './realMarketApiPolicy'

/**
 * 「供应商不再提供这个品种」的通知（用户 2026-11-16：「出现这种情况，还要通知出来」）。
 *
 * 为什么和 `source.consecutive-failed` 分开：那条说的是「一直取不到数据，去查密钥或代理」，
 * 而套餐不含 / 品种下架是**永久**状态——查密钥没用，必须续费、换品种或换源。同一条正文
 * 说两件动作不同的事，读者会做错动作。
 *
 * 去重沿用平台注册的 `sourceIssue(sourceId)`：同一来源 24 小时内一条，多只品种合并进同一条。
 * 提交异常只吞掉、不改变采集结果：数据该不该存与通知成不成是两件事。
 */
export const PERMANENT_REFUSAL_CODES: readonly RealMarketApiFailureCode[] = Object.freeze(['symbol-not-supported'])

/**
 * 供应商在正文里的名字：集成数据（供应商的显示名），不是内部词汇。
 */
export const SOURCE_REFUSAL_SOURCE_NAME = 'RealMarketAPI' as const

export type SourceRefusalNotice = Readonly<{
  sourceId: string
  /** 被拒的品种，我们自己的请求码（如 `DXY`）；不是供应商的响应正文。 */
  symbols: readonly string[]
}>

/**
 * 永久拒绝的判据。参数收成 `string`：调用方各自的失败码闭集不同（跨资产那条还有 `disabled`
 * 这类非失败值），判据本身只认这几枚码，不需要把每个调用方的类型搬过来。
 */
export function isPermanentRefusal(code: string): boolean {
  return (PERMANENT_REFUSAL_CODES as readonly string[]).includes(code)
}

export function buildSourceRefusalRequest(notice: SourceRefusalNotice, occurredAt: string): NotificationSubmitRequest {
  return {
    eventTypeId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.sourceSymbolRefused,
    producerId: realMarketApiPolicy.sourceId,
    bodyParams: { sourceName: SOURCE_REFUSAL_SOURCE_NAME, symbols: notice.symbols.join('、') },
    // 键由平台展开，与声明里的 `sourceIssue` 逐个同名；这里只给参数，不手拼键。
    dedupeVars: { builder: 'sourceIssue', sourceId: notice.sourceId },
    actions: [],
    occurredAt
  }
}

/** 发一条：没有通知端口、没有品种时什么也不做；提交失败不把这一轮采集判成失败。 */
export async function notifySourceRefusal(
  submit: ((request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>) | undefined,
  notice: SourceRefusalNotice,
  occurredAt: string
): Promise<NotificationSubmitOutcome | null> {
  if (submit === undefined || notice.symbols.length === 0) return null
  try {
    return await submit(buildSourceRefusalRequest(notice, occurredAt))
  } catch {
    return null
  }
}
