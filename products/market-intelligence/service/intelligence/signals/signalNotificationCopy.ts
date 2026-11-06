import type { NotificationCopyParam } from '@platform/notifications/contracts/notificationCopyPort'

import {
  MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS,
  notificationEventHeadlineKey
} from '../../../contracts/notificationEventKeys'

/**
 * 信号通知的参数装配（情报 v3.26 §十一）：**这里只放数与引用，不放句子**。
 *
 * 两条硬规矩落在这里，避免两个生产者各写一份：
 * - 资产名是**读者认得的符号**（`BTC` / `ETH`），不是内部 id，也不翻译；
 * - 正文里每个数字都以 `{ number, kind }` 传，**阈值必须是规则常量本身**——句子里的
 *   「超过 {threshold} 的阈值」如果在这里另算一个数，两处就会各改各的。
 */

const PRODUCT_ID = 'market-intelligence'

/** 标题里的 headline 槽：一层产品引用（不带参数），按规则选一句。 */
export const SIGNAL_HEADLINE_KEYS = Object.freeze({
  etfOutflow: notificationEventHeadlineKey(EVENT_IDS.signalTriggered, 'etfOutflow'),
  etfOutflowAggravated: notificationEventHeadlineKey(EVENT_IDS.signalTriggered, 'etfOutflowAggravated'),
  oiDrop: notificationEventHeadlineKey(EVENT_IDS.signalTriggered, 'oiDrop'),
  oiDropAggravated: notificationEventHeadlineKey(EVENT_IDS.signalTriggered, 'oiDropAggravated')
})

/** 资产在通知里显示为符号：数据不翻译，但要保证是符号形状。 */
export function signalAssetSymbol(asset: 'btc' | 'eth'): string {
  return asset.toUpperCase()
}

/** 一层产品引用：`{ ref: { scope: 'product', key } }`，解析那一刻按读者语言展开。 */
export function signalHeadline(key: string): NotificationCopyParam {
  return { ref: { scope: 'product', productId: PRODUCT_ID, key } }
}

/** 金额：原样传数，符号由模板里的「净流出」表达，格式化器只出绝对值。 */
export function usdParam(value: number): NotificationCopyParam {
  return { number: value, kind: 'usd' }
}

export function pctParam(value: number): NotificationCopyParam {
  return { number: value, kind: 'pct' }
}

export function multipleParam(value: number): NotificationCopyParam {
  return { number: value, kind: 'multiple' }
}

/** 阈值与读数之比：乘除都在这一次算完，文案里不再出现第二个数。 */
export function thresholdMultiple(value: number, threshold: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(threshold) || threshold === 0) return Number.NaN
  return value / threshold
}
