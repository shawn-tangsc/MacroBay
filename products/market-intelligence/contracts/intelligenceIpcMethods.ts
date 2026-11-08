/**
 * 「情报」这一族 IPC 方法名的唯一来源。
 *
 * 注册器与 `product.manifest.ts` 都从这里取值：注册了什么，启动基线就有什么——
 * 「注册了没登记」在写的时候就不再成立（2026-11-05 期配置、2026-11-06 舆情推送
 * 各撞过一次 `product-runtime-method-baseline-mismatch`，应用起不来）。
 *
 * 放纯契约文件而不是注册器里：注册器顶层引 `electron` 和整条服务依赖，
 * 而 manifest 是启动早期的纯数据，不能被拖进去。
 */
export const INTELLIGENCE_IPC_METHODS = Object.freeze({
  getNewsPushOutletState: 'intelligence.getNewsPushOutletState',
  setNewsPushOutletEnabled: 'intelligence.setNewsPushOutletEnabled',
  getNewsPushThreshold: 'intelligence.getNewsPushThreshold',
  saveNewsPushThreshold: 'intelligence.saveNewsPushThreshold',
  getCalendarReminderSettings: 'intelligence.getCalendarReminderSettings',
  setCalendarReminderSettings: 'intelligence.setCalendarReminderSettings',
  getTimeline: 'intelligence.getTimeline',
  /** 抽屉里那枚「发送到频道」：入参只有运行 id，结论与文案由主进程按 id 取。 */
  sendAnalysisConclusion: 'intelligence.sendAnalysisConclusion',
  getMonitoringScope: 'intelligence.getMonitoringScope',
  ingestEvent: 'intelligence.ingestEvent',
  getWorkspaceState: 'intelligence.getWorkspaceState',
  getWorkspaceTimeline: 'intelligence.getWorkspaceTimeline',
  getSentimentAggregates: 'intelligence.getSentimentAggregates',
  getNewsSentiment: 'intelligence.getNewsSentiment',
  getNewsSentimentItem: 'intelligence.getNewsSentimentItem',
  getNewsSentimentSettings: 'intelligence.getNewsSentimentSettings',
  translateNewsSentimentBody: 'intelligence.translateNewsSentimentBody',
  rebuildNewsSentiment: 'intelligence.rebuildNewsSentiment',
  rescoreNewsSentiment: 'intelligence.rescoreNewsSentiment',
  saveNewsSentimentSettings: 'intelligence.saveNewsSentimentSettings',
  getDetail: 'intelligence.getDetail',
  getOperationsHealth: 'intelligence.getOperationsHealth',
  retryItemAssessment: 'intelligence.retryItemAssessment'
} as const)

export type IntelligenceIpcMethod = (typeof INTELLIGENCE_IPC_METHODS)[keyof typeof INTELLIGENCE_IPC_METHODS]
