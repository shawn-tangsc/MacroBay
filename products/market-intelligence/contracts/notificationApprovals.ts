import type { NotificationEventPolicyEntry } from '@platform/notifications/contracts/notificationEventCatalog'

/** 签署人（情报模块产品经理）。改档位只能由签署人改，签名哈希守卫会拦。 */
export const SIGNED_BY = '情报模块产品经理' as const
/** 签署日期。 */
export const SIGNED_AT = '2026-11-11' as const
/** 对 `canonicalApprovalText({ formatVersion: 1, signedBy: SIGNED_BY, signedAt: SIGNED_AT, events })` 的 sha256（UTF-8 字节）。 */
export const SIGNATURE = 'sha256:dc204543e378a7f8d3285e820d1a9ef1be73e455b56e3dcb91ea521723840c9c' as const

/**
 * 情报模块**签署过的批准值**（与「申请」分开的两份数据之一）。
 *
 * 为什么单独成文件、不与 `notificationEvent` 的声明写在一处：声明里的 `requestedDisruptionLevels` 是**申请**，
 * 这里是**批准**。写进同一个对象，装配时 `requested ⊆ approved` 就变成自己跟自己比、恒真，于是
 * 「还没批」这个合法状态消失、未批事件会被当成已批放行（产品经理 2026-11-08 的结构性反对，架构师采纳）。
 *
 * **签署记录（2026-11-08）**：10 条值与产品签署表逐字一致；其中 `briefing.ready` 为 `center + channel + desktop`（**2026-11-06 用户拍板加桌面档，本行 2026-11-08 补记**——桌面批、提示不批）。
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
  /**
   * 刷新失败（2026-11-11 用户「失败了，要通知」；同日产品经理签署）。
   *
   * **档位**：只批 `center` + `desktop`——**不批手机**（后台维护事件，读者当场做不了事；持续性失败由
   * `source.consecutive-failed` 那条负责，一条事件只干一件事），也不批免打扰穿透（凌晨打断没有收益）。
   *
   * **去重键与本文一致**：`calendar-refresh:{providerId}:{date}:{generation}`
   * （声明在 `product.manifest.ts` 的同名事件上；`date` 按读者时区，`generation` 见下）。
   *
   * 三条写死在这里，免得后来人把它们当实现细节改掉：
   *
   * 1. **`generation` 数的是「这一次故障」**：不是「这天第几次失败」，也不是「第几次成功」；
   *    **一次成功即换代**。它不重试次数、不涨阈值，只用来把「同一个状况」与「恢复之后的又一次」分开。
   * 2. **已知边界**：`generation` 是进程内状态，**重启归零**。最坏情况是同一天的第二条被并进第一条，
   *    **只会少报，不会多报**。这是已知取舍：要修成持久化得动存储，属另一件事——**别当 bug 顺手改**。
   * 3. **读者能看到的样子**：同一来源同一天的多条失败会合并成一条提醒（同一条提醒里的次数会累加）。
   */
  'market-intelligence.calendar.refresh-failed': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.source.consecutive-failed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.source.stale': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.timezone.invalid': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'market-intelligence.sentiment.alert': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false },
  'market-intelligence.analysis.conclusion': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false }
})
