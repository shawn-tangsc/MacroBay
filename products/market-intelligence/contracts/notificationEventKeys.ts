import {
  notificationEventBodyKey,
  notificationEventReasonKey,
  notificationEventTitleKey
} from '@platform/notifications/contracts/platformNotificationEvents'

/**
 * 情报模块通知事件的文案键：**全部由事件 id 机械生成**，调用点不手拼。
 *
 * 标题/正文/理由直接用平台那三个生成函数（`notification.event.<id>.<part>`），
 * 这样事件改名时键跟着变、文案门禁（`notificationEventCopyGate`）能把缺口点名到事件和语言。
 *
 * 动作标签（v2.58）：**产品动作的键也住在产品表里**，形如
 * `notification.action.<productId>.<actionId>`——与平台同一条解析链路，只是表不同。
 * 平台动作（如「去设置」）仍用平台闭集键。
 */
export {
  notificationEventBodyKey,
  notificationEventReasonKey,
  notificationEventTitleKey
} from '@platform/notifications/contracts/platformNotificationEvents'

/**
 * 产品动作的文案键（v2.58）：`notification.action.<productId>.<actionId>`。
 *
 * 前缀与平台动作同一族（`notification.action.`），但**表**是产品那张——解析走
 * `NotificationCopyRef.scope: 'product'`，切语言后历史记录的按钮文案跟着变。
 */
export function productNotificationActionKey(productId: string, actionId: string): string {
  return `notification.action.${productId}.${actionId}`
}

/** 「打开日报」：日报生成失败那条通知的唯一动作。 */
export const OPEN_BRIEFING_ACTION_KEY = productNotificationActionKey('market-intelligence', 'open-briefing')

/**
 * 「知道了」：分析失败那条通知的动作。运行记录是审计页、不设入口（用户 2026-11-11），
 * 所以这条通知只报事——按一下确认收到，不把人送到任何一屏。
 */
export const ACKNOWLEDGE_ACTION_KEY = productNotificationActionKey('market-intelligence', 'acknowledge')

/**
 * 「打开舆情」：新抓到舆情那条通知的唯一动作。
 *
 * 这一版**只到舆情页、不定位到具体某条**（壳层的通知跳转今天只认产品页与设置分区，产品实体
 * 定位能力还没落）。所以标签只能写「打开舆情」——写「查看这条」而点完不定位，就是撒谎。
 */
export const OPEN_SENTIMENT_ACTION_KEY = productNotificationActionKey('market-intelligence', 'open-sentiment')

/** 分析失败通知的动作标签（只在「分析没跑成」那条上用）。 */
export const ANALYSIS_RETRY_ACTION_KEY = productNotificationActionKey('market-intelligence', 'retry-analysis')
export const ANALYSIS_TIMELINE_ACTION_KEY = productNotificationActionKey('market-intelligence', 'view-timeline')
/** 传输层没连上：检查的是「连接」。 */
export const ANALYSIS_CHECK_MODEL_ACTION_KEY = productNotificationActionKey('market-intelligence', 'check-model')
/**
 * 供应商答了但拒绝（4xx）/ 启动时没选出模型：要检查的是**模型设置**，不是网络。
 * 与上面那个键分开：「检查模型连接」用在 401 上，等于让读者去查一个没问题的地方。
 */
export const ANALYSIS_CHECK_MODEL_SETTINGS_ACTION_KEY = productNotificationActionKey('market-intelligence', 'check-model-settings')

/**
 * 事件下的任意一段文案键：`notification.event.<id>.<path>`（如 `country.US`、`indicator.cpi`）。
 *
 * 与其余几个生成函数同源：手写全串会在事件改名时静默失效，而这类键数量多、最容易手写。
 */
export function notificationEventNamedKey(eventTypeId: string, path: string): string {
  return `notification.event.${eventTypeId}.${path}`
}

/**
 * 标题变体的键：`notification.event.<id>.headline.<variant>`。
 *
 * 与标题/正文/理由同一套前缀、同一个生成地：事件改名时四句「加剧」标题跟着变，
 * 不会因为手写全串而静默解析不到、悄悄降级成兜底句。
 */
export function notificationEventHeadlineKey(eventTypeId: string, variant: string): string {
  return `notification.event.${eventTypeId}.headline.${variant}`
}

/** 一条事件有正文时用的键；带变体时是 `.body.<variant>`。 */
export function notificationEventVariantKey(eventTypeId: string, variant: string): string {
  return notificationEventBodyKey(eventTypeId, variant)
}

/** 本模块的通知事件 id：与 `notification-event-ownership.md`、批准表逐字一致。 */
/**
 * 平台分析事件的 id —— 本产品是它们的生产者，所以 id 从这里取，别处不再写一遍字面量。
 *
 * 与批准表逐字一致；生产者门禁只认这一处和平台声明表，写在别处它认不出「有没有人真的在发」。
 */
export const ANALYSIS_NOTIFICATION_EVENT_IDS = Object.freeze({
  manualFailed: 'platform.analysis.manual-failed',
  quotaExhausted: 'platform.analysis.quota-exhausted',
  repeatedFailure: 'platform.analysis.repeated-failure',
  attemptAbandoned: 'platform.analysis.attempt-abandoned',
  recovered: 'platform.analysis.recovered'
})

export const MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS = Object.freeze({
  briefingFailed: 'market-intelligence.briefing.failed',
  briefingReady: 'market-intelligence.briefing.ready',
  signalTriggered: 'market-intelligence.signal.triggered',
  macroEventLanded: 'market-intelligence.macro.event-landed',
  calendarEventUpcoming: 'market-intelligence.calendar.event-upcoming',
  /** 市场日历（0xRouter 那条腿）一次刷新没成功。手动与自动同一条，读者要的是「这次没刷成」。 */
  calendarRefreshFailed: 'market-intelligence.calendar.refresh-failed',
  sentimentAlert: 'market-intelligence.sentiment.alert',
  /**
   * 一条非低重要性的舆情刚入库（R40，用户 2026-11-18）：**只发桌面，不进中心、不进手机**。
   * 手机那条仍由 `sentiment.alert`（阈值）负责，两条各自只干一件事。
   */
  newsItemArrived: 'market-intelligence.news.item-arrived',
  /** N12：信号唤起的那次分析出结论了（只在这一条路径发）。 */
  analysisConclusion: 'market-intelligence.analysis.conclusion',
  /**
   * 分析没跑成（2026-11-17 用户「失败了，怎么不报应用内通知出来」）。
   *
   * 手动与自动共用一个事件、**只有 `center` 一档**：手动失败读者在等，自动失败只报链路级
   * （连续 3 次或 2 小时零成功），两种都不该弹桌面或手机。去重键由提交侧拼：
   * 手动 `analysis-failed:manual:{runId}`、自动 `analysis-failed:{triggerKey}:{failureCode}:{bucket30m}`，
   * 见 `product.manifest.ts` 的同名声明。
   */
  analysisFailed: 'market-intelligence.analysis.failed',
  sourceConsecutiveFailed: 'market-intelligence.source.consecutive-failed',
  sourceStale: 'market-intelligence.source.stale',
  /**
   * 供应商把这个品种列为「不受支持」（套餐不含 / 品种下架）：永久状态，重试不会恢复。
   * 与 `consecutive-failed` 分开，因为动作不同——续费或换源，不是查密钥（用户 2026-11-16
   * 「出现这种情况，还要通知出来」）。
   */
  sourceSymbolRefused: 'market-intelligence.source.symbol-not-supported',
  timezoneInvalid: 'market-intelligence.timezone.invalid',
  /**
   * R42（用户 2026-11-18）：ETF / 稳定币的读数变了——只应用内（`center` + `popup`）。
   * 判据是**数字**，不是「刷新返回 updated」：主备源切换那一轮数没变，不弹。
   */
  capitalFlowEtfUpdated: 'market-intelligence.capital-flow.etf-updated',
  capitalFlowStablecoinUpdated: 'market-intelligence.capital-flow.stablecoin-updated'
})
