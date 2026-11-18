import type { NotificationEventDeclaration } from '../../../platform/notifications/contracts/notificationEventCatalog'

import { notificationEvent } from './notificationEventDeclaration'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as IDS } from './notificationEventKeys'

/**
 * R42：资金面读数变了 → 应用内提醒（用户 2026-11-18「每次 etf 和稳定币有数据更新了，应用内要弹框」）。
 *
 * 口径与验收（N42）见 `docs-private/iterations/r42-capital-flow-update-notice/01-prd.md`。
 * **数字变了才弹**：新交易日入窗，或已经给读者看过的那一天被修订；来源切换、抓取时刻变化、
 * 读取失败、首轮建档一律不弹。档位：弹框 + 桌面（用户 2026-11-18「我要桌面的」），**不进手机**。
 *
 * 声明住在这里而不是 `product.manifest.ts`：那个文件已经越过 500 行门禁，新事件往里堆就是
 * 让门禁红上加红。装配端仍从 manifest 的 `notificationEvents` 收表，这里只把两条整块搬出来。
 */
export const capitalFlowNotificationEvents: readonly NotificationEventDeclaration[] = Object.freeze([
  notificationEvent(IDS.capitalFlowEtfUpdated, {
    category: 'reminder',
    // 两种正文：新的一天 / 你已经看过的那天被修订。变体名与文案表的 `…body.<variant>` 逐字对应。
    bodyVariants: ['arrived', 'revised'],
    requiresUserAction: false,
    requestedDisruptionLevels: ['popup', 'desktop'],
    // 同一交易日同一资产 24 小时内最多一条：首次与改数共用这个键。
    dedupeKeyTemplate: 'capital-flow-etf-update:{asset}:{tradingDate}',
    dedupeUnit: 'condition',
    conditionWindowMs: 86_400_000,
    requestedBypassQuietHours: false
  }),
  notificationEvent(IDS.capitalFlowStablecoinUpdated, {
    category: 'reminder',
    body: true,
    requiresUserAction: false,
    requestedDisruptionLevels: ['popup', 'desktop'],
    // 稳定币没有「交易日」这个粒度，键不带日期：一天再多变化也只提醒第一条。
    // 模板必须含占位符（平台校验），所以把固定段写成 `{scope}`，提交侧只传 `total-supply`——
    // 展开后的键仍是 `capital-flow-stablecoin-update:total-supply`，与产品给的批准值一致。
    dedupeKeyTemplate: 'capital-flow-stablecoin-update:{scope}',
    dedupeUnit: 'condition',
    conditionWindowMs: 86_400_000,
    requestedBypassQuietHours: false
  })
])
