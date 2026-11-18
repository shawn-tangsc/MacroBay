import type { NotificationEventDeclaration } from '../../../platform/notifications/contracts/notificationEventCatalog'

import { notificationEvent } from './notificationEventDeclaration'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as IDS } from './notificationEventKeys'

/**
 * R42：资金面读数变了 → 应用内提醒（用户 2026-11-18「每次 etf 和稳定币有数据更新了，应用内要弹框」）。
 *
 * 口径与验收（N42）见 `docs-private/iterations/r42-capital-flow-update-notice/01-prd.md`。
 * **数字变了才弹**：新交易日入窗，或已经给读者看过的那一天被修订；来源切换、抓取时刻变化、
 * 读取失败、首轮建档一律不弹。档位：弹框 + 桌面（用户 2026-11-18「我要桌面的」），**不进手机**；
 * 用户同批要求「失败才进中心」，所以这两条**不进中心**——平台只允许 `occurrence` 去重的事件省略 center，
 * 因此去重粒度是「一天一条」（键带日期；ETF 再带种类，让新到与改数各弹一次）。
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
    // 一天一条，键里带**种类**与**读者日**：`arrived` 与 `revised` 是两个键，所以「新的一天」与
    // 「那天后来改了数」各能弹一次；`revised` 带读者日，所以**隔天又被改还会再报**（只到 `revised`
    // 等于这个交易日改过一次就永远闭嘴）。同一天同种类改多次只报第一次。
    // 用户 2026-11-18 选的「不进中心」要求 `occurrence`——只有它允许批准表不写 center。
    dedupeKeyTemplate: 'capital-flow-etf-update:{asset}:{tradingDate}:{kind}:{day}',
    dedupeUnit: 'occurrence',
    requestedBypassQuietHours: false
  }),
  notificationEvent(IDS.capitalFlowStablecoinUpdated, {
    category: 'reminder',
    body: true,
    requiresUserAction: false,
    requestedDisruptionLevels: ['popup', 'desktop'],
    // 稳定币没有「交易日」这个粒度：键里带**读者日**，一天一条；同一天再多变化只提醒第一条。
    dedupeKeyTemplate: 'capital-flow-stablecoin-update:{day}',
    dedupeUnit: 'occurrence',
    requestedBypassQuietHours: false
  })
])
