import type { ProductApprovalFieldLabelTable } from '@platform/product-manifest'

/**
 * 工具审批卡片上「请求参数」的字段名（中英各一份）。
 *
 * 这些名字是**产品词**（情报源、采集节奏、目标语言……），所以住在产品里：壳层只负责按
 * 「工具名 + 字段名 + 当前语言」取一句话，取不到就把卡片退回 JSON 摘要，不自己编名字。
 *
 * 键是模型请求里真实出现的参数名——写错一个，那张卡就整块退回摘要（宁可退回，也不画半个表）。
 */
export const marketIntelligenceAgentApprovalFieldLabels = {
  configure_intelligence_source: {
    action: { 'zh-CN': '动作', 'en-US': 'Action' },
    sourceId: { 'zh-CN': '情报源', 'en-US': 'Source' },
    collectionPreset: { 'zh-CN': '采集节奏', 'en-US': 'Collection preset' },
    includeInSentiment: { 'zh-CN': '计入情绪', 'en-US': 'Include in sentiment' },
    scopePolicy: { 'zh-CN': '范围策略', 'en-US': 'Scope policy' },
    rawArchiveEnabled: { 'zh-CN': '原始归档', 'en-US': 'Raw archive' },
    retentionMode: { 'zh-CN': '保留策略', 'en-US': 'Retention' },
    autoReplayAfterParserUpgrade: { 'zh-CN': '解析器升级后重放', 'en-US': 'Replay after parser upgrade' }
  },
  operate_intelligence_source: {
    action: { 'zh-CN': '动作', 'en-US': 'Action' },
    sourceId: { 'zh-CN': '情报源', 'en-US': 'Source' },
    enabled: { 'zh-CN': '启用', 'en-US': 'Enabled' },
    monitoredSymbols: { 'zh-CN': '监控标的', 'en-US': 'Monitored symbols' },
    itemId: { 'zh-CN': '情报条目', 'en-US': 'Item' },
    itemIds: { 'zh-CN': '情报条目', 'en-US': 'Items' },
    clusterIds: { 'zh-CN': '情报簇', 'en-US': 'Clusters' },
    providerId: { 'zh-CN': '供应商', 'en-US': 'Provider' },
    modelId: { 'zh-CN': '模型', 'en-US': 'Model' },
    filters: { 'zh-CN': '过滤条件', 'en-US': 'Filters' },
    leaseId: { 'zh-CN': '租约', 'en-US': 'Lease' }
  },
  operate_macro_calendar: {
    action: { 'zh-CN': '动作', 'en-US': 'Action' },
    eventKey: { 'zh-CN': '日历事件', 'en-US': 'Calendar event' },
    enabled: { 'zh-CN': '启用', 'en-US': 'Enabled' },
    scheduledAt: { 'zh-CN': '发布时间', 'en-US': 'Release time' },
    scheduledDate: { 'zh-CN': '发布日', 'en-US': 'Release date' },
    year: { 'zh-CN': '年份', 'en-US': 'Year' },
    body: { 'zh-CN': 'ICS 内容', 'en-US': 'ICS body' },
    truncated: { 'zh-CN': '已截断', 'en-US': 'Truncated' },
    acknowledgeOverwrite: { 'zh-CN': '确认覆盖', 'en-US': 'Confirm overwrite' }
  },
  configure_translation: {
    action: { 'zh-CN': '动作', 'en-US': 'Action' },
    enabled: { 'zh-CN': '启用', 'en-US': 'Enabled' },
    autoTranslateEnabled: { 'zh-CN': '自动翻译', 'en-US': 'Auto translate' },
    targetLocale: { 'zh-CN': '目标语言', 'en-US': 'Target locale' },
    translateTitle: { 'zh-CN': '翻译标题', 'en-US': 'Translate title' },
    translateSummary: { 'zh-CN': '翻译摘要', 'en-US': 'Translate summary' },
    translateEvidenceExcerpt: { 'zh-CN': '翻译证据摘录', 'en-US': 'Translate evidence excerpt' }
  },
  configure_cross_asset_interface: {
    action: { 'zh-CN': '动作', 'en-US': 'Action' },
    enabled: { 'zh-CN': '启用', 'en-US': 'Enabled' },
    itemId: { 'zh-CN': '情报条目', 'en-US': 'Item' },
    filters: { 'zh-CN': '过滤条件', 'en-US': 'Filters' }
  }
} as const satisfies ProductApprovalFieldLabelTable
