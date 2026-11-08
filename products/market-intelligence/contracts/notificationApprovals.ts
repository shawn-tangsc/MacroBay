import type { NotificationEventPolicyEntry } from '@platform/notifications/contracts/notificationEventCatalog'

/**
 * 情报模块**签署过的批准值**（与「申请」分开的两份数据之一）。
 *
 * 为什么单独成文件、不与 `notificationEvent` 的声明写在一处：声明里的 `requestedDisruptionLevels` 是**申请**，
 * 这里是**批准**。写进同一个对象，装配时 `requested ⊆ approved` 就变成自己跟自己比、恒真，于是
 * 「还没批」这个合法状态消失、未批事件会被当成已批放行（产品经理 2026-11-08 的结构性反对，架构师采纳）。
 *
 * **值一个不改**：谁签的还是谁签，这里只是把原来内联在 `product.manifest.ts` 里的 10 行搬到独立文件，
 * 让「申请」与「批准」在文件层面也分得开。签名与哈希守卫等架构师给规范化规则（本文件暂时无语义签名）。
 */
export const MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS: Readonly<
  Record<string, NotificationEventPolicyEntry>
> = Object.freeze({
  'market-intelligence.briefing.failed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.briefing.ready': { approvedDisruptionLevels: ['center', 'channel', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.signal.triggered': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false },
  'market-intelligence.macro.event-landed': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false, surfaceGroup: 'calendar-events' },
  'market-intelligence.calendar.event-upcoming': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false, surfaceGroup: 'calendar-events' },
  'market-intelligence.source.consecutive-failed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.source.stale': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.timezone.invalid': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.sentiment.alert': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false },
  'market-intelligence.analysis.conclusion': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false }
})
