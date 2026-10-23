import type { IntelligenceAgentCapability } from './capabilityTypes'
import {
  macroMarketSnapshotOutputSchema,
  macroRatesSnapshotOutputSchema,
  macroSnapshotEmptyInputSchema,
  marketAnalysisContextInputSchema,
  marketAnalysisContextOutputSchema,
  marketIntelligenceEvidenceInputSchema,
  marketIntelligenceQueryOutputSchema,
  marketIntelligenceTimeBoundInputSchema,
  provenanceExplainInputSchema,
  provenanceExplainOutputSchema
} from './capabilitySchemas'
import {
  crossAssetSnapshotInputSchema,
  crossAssetSnapshotOutputSchema,
  dashboardFeedStatusInputSchema,
  dashboardFeedStatusOutputSchema,
  describeCapabilitiesInputSchema,
  describeCapabilitiesOutputSchema,
  listSourcesInputSchema,
  listSourcesOutputSchema,
  macroCalendarMonthInputSchema,
  macroCalendarMonthOutputSchema,
  operationsHealthInputSchema,
  operationsHealthOutputSchema,
  sourceDetailInputSchema,
  sourceDetailOutputSchema,
  timelineInputSchema,
  timelineOutputSchema,
  translationStatusInputSchema,
  translationStatusOutputSchema
} from './readCapabilitySchemas'

const READ_OUTPUT_BYTES = 64 * 1024
const ANALYSIS_OUTPUT_BYTES = 256 * 1024

/**
 * The single source of truth for the read surface (design 152 §3).
 *
 * `handlerId` is stable and declared here; `handlerRegistry.ts` maps every one of them to product
 * code and fails at registration if a mapping is missing. Timeouts stay in the 5–10 s range: these
 * are reads over local stores or a bounded month query, never an analysis run.
 */
export const intelligenceAgentCapabilities = [
  {
    id: 'get_market_analysis_context',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '市场分析上下文', 'en-US': 'Market analysis context' },
    description:
      '读取某个事件组在给定 asOf 时刻已冻结的市场分析五域事实上下文。只回答当时已存在的事实；缺失的域列在 missingDomains 里，不用默认值补齐，也不触发任何分析。',
    inputSchema: marketAnalysisContextInputSchema,
    outputSchema: marketAnalysisContextOutputSchema,
    handlerId: 'market-intelligence.get-market-analysis-context',
    timeoutMs: 5_000,
    maxOutputBytes: ANALYSIS_OUTPUT_BYTES
  },
  {
    id: 'get_macro_market_snapshot',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '美元与黄金快照', 'en-US': 'Dollar and gold snapshot' },
    description:
      '读取市场状态块的美元与黄金快照：美元指数最新水平与 15m/1h/4h/24h 窗口变化，以及黄金最新价。限制：美元正线来自 RealMarketAPI 的 ICE 美元指数（dxy-real，5 分钟，与面板同一份存储）；只有该源没有数据点、或本产品用 ICE 篮子合成的 dxy-synthetic 确实比它更新时才回退到合成值（reading 带 synthetic 标记，结果带 synthetic-dollar-index caveat），合成值不得当作官方 ICE 指数引用；真实那条停在收盘（例如周末 FX 休市）时仍显示它，不换仪器；黄金的 live 价是未收盘的实时 tick（约 90 秒新鲜度），不是已收盘 bar，也不参与任何窗口计算；窗口缺失表示该序列无法回答该窗口，不代表 0。数据是「现在」的读数，没有历史 asOf 参数。只读，不触发分析。',
    inputSchema: macroSnapshotEmptyInputSchema,
    outputSchema: macroMarketSnapshotOutputSchema,
    handlerId: 'market-intelligence.get-macro-market-snapshot',
    timeoutMs: 5_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'get_macro_rates_snapshot',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '美债日频利率', 'en-US': 'Daily rates snapshot' },
    description:
      '读取 FRED 的四条日频利率序列：10Y 名义收益率(DGS10)、10Y 实际利率(DFII10)、2Y 收益率(DGS2)、10Y 盈亏平衡通胀(T10YIE)，每条带观察日 period(YYYY-MM-DD)与可用时的上一交易日 previous。限制：这是官方**日频收盘**，每个交易日一个观测，可能滞后数个交易日，周末与美国休市日没有新值；它不能解释盘中波动，结果带 official-daily-close caveat；previous 缺失表示没有上一交易日读数，不是 0；没有读数的序列直接缺席（该行显示未接入），不会以 0 或上一日值填充。数据是「现在」的读数，没有历史 asOf 参数。只读，不触发分析。',
    inputSchema: macroSnapshotEmptyInputSchema,
    outputSchema: macroRatesSnapshotOutputSchema,
    handlerId: 'market-intelligence.get-macro-rates-snapshot',
    timeoutMs: 5_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'explain_figure',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '数字来源与算式', 'en-US': 'Figure provenance' },
    description:
      '回答「这个数从哪来、怎么算的」：给出该族的来源路线、观测时刻规则、算式，以及**这次回答现读**的阈值与现值，让模型能原原本本复述前因后果。不带 family 调用返回可查族的索引。限制：算式与数字在回答时向 owner 现读，不是这份说明里的快照，所以复述时必须引用返回里的数值；有一族（日频行的 bp 取整）在渲染侧，不在本进程，问到它要明说不在这一侧、不要替它编来源。只读，不触发分析，不要时间边界。',
    inputSchema: provenanceExplainInputSchema,
    outputSchema: provenanceExplainOutputSchema,
    handlerId: 'market-intelligence.explain-figure',
    timeoutMs: 5_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'query_sentiment_snapshot',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '情绪快照查询', 'en-US': 'Sentiment snapshot' },
    description:
      'Query sentiment snapshot visible at a historical asOf timestamp. The answer is bounded by asOf and never includes data detected later; missing source coverage is reported as a caveat, not filled in.',
    inputSchema: marketIntelligenceTimeBoundInputSchema,
    outputSchema: marketIntelligenceQueryOutputSchema,
    handlerId: 'market-intelligence.query-sentiment-snapshot',
    timeoutMs: 5_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'query_sentiment_series',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '情绪序列查询', 'en-US': 'Sentiment series' },
    description:
      'Query sentiment series visible at a historical asOf timestamp. Gaps mean the series could not answer that window; they are not zero values.',
    inputSchema: marketIntelligenceTimeBoundInputSchema,
    outputSchema: marketIntelligenceQueryOutputSchema,
    handlerId: 'market-intelligence.query-sentiment-series',
    timeoutMs: 5_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'query_related_events',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '相关事件查询', 'en-US': 'Related events' },
    description:
      'Query related market intelligence events at asOf. Each event carries its source and evidence references; nothing outside the asOf cut-off is returned.',
    inputSchema: marketIntelligenceTimeBoundInputSchema,
    outputSchema: marketIntelligenceQueryOutputSchema,
    handlerId: 'market-intelligence.query-related-events',
    timeoutMs: 5_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'query_impact_timeline',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '影响时间线查询', 'en-US': 'Impact timeline' },
    description:
      'Query impact timeline visible at asOf. Directions and confidence are the stored assessments, not a new inference by this tool.',
    inputSchema: marketIntelligenceTimeBoundInputSchema,
    outputSchema: marketIntelligenceQueryOutputSchema,
    handlerId: 'market-intelligence.query-impact-timeline',
    timeoutMs: 5_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'get_evidence_excerpt',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '证据摘录', 'en-US': 'Evidence excerpt' },
    description:
      'Get a renderer-safe evidence excerpt for one intelligence item at asOf, identified by evidenceRefId, itemId, impactId, or clusterId. The excerpt is bounded by maxExcerptChars and by asOf; ask again with a narrower reference rather than assuming the missing tail.',
    inputSchema: marketIntelligenceEvidenceInputSchema,
    outputSchema: marketIntelligenceQueryOutputSchema,
    handlerId: 'market-intelligence.get-evidence-excerpt',
    timeoutMs: 10_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'get_source_health',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '情报源健康', 'en-US': 'Source health' },
    description:
      'Get intelligence source health summary visible at asOf. Health is per source and historical: a source that is unhealthy now may have been healthy at asOf, and the answer says which one it is.',
    inputSchema: marketIntelligenceTimeBoundInputSchema,
    outputSchema: marketIntelligenceQueryOutputSchema,
    handlerId: 'market-intelligence.get-source-health',
    timeoutMs: 10_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'get_operations_health',
    domain: 'operations',
    kind: 'read',
    title: { 'zh-CN': '运行健康', 'en-US': 'Operations health' },
    description:
      '读取本产品后台运行面的整体状态：已注册的调度数、正在运行的任务数、最近一次任务时间，以及是否存在需要关注的卡住状态，并附固定文案的 caveats。限制：它不回答单个源的健康与新鲜度——那由 get_source_health 按时间边界回答；也不返回日志正文或任何凭据。',
    inputSchema: operationsHealthInputSchema,
    outputSchema: operationsHealthOutputSchema,
    handlerId: 'market-intelligence.get-operations-health',
    timeoutMs: 5_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'list_intelligence_sources',
    domain: 'source-config',
    kind: 'read',
    title: { 'zh-CN': '情报源清单', 'en-US': 'Intelligence sources' },
    description:
      '列出一个安装里存在的情报源及其配置与凭据状态：是否启用、采集节奏、是否纳入情绪、保留策略、焦点市场，以及 revision（配置修订号）。限制：返回的是投影，不含 profileId、credentialRef、sourceSpecificConfigJson 或任何密钥/掩码；credentialStatus 只有布尔值与最近校验时间。默认只列已启用的源，includeDisabled=true 才包含停用项；domain 按面板归属过滤为 dashboard 或 calendar。',
    inputSchema: listSourcesInputSchema,
    outputSchema: listSourcesOutputSchema,
    handlerId: 'market-intelligence.list-intelligence-sources',
    timeoutMs: 10_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'get_source_detail',
    domain: 'source-config',
    kind: 'read',
    title: { 'zh-CN': '情报源详情', 'en-US': 'Source detail' },
    description:
      '读取单个情报源的完整只读投影：配置、健康状态与凭据是否已保存（只有布尔值与最近校验时间），并带上源定义的说明、认证方式与需要用户填写的字段名。限制：未知 sourceId 返回 state=unavailable；不返回 profileId、credentialRef、sourceSpecificConfigJson、maskedPreview 或任何密钥，也不返回原始采集载荷。',
    inputSchema: sourceDetailInputSchema,
    outputSchema: sourceDetailOutputSchema,
    handlerId: 'market-intelligence.get-source-detail',
    timeoutMs: 10_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'get_intelligence_timeline',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '情报时间线', 'en-US': 'Intelligence timeline' },
    description:
      '读取情报时间线，可按时间范围、来源组、监控范围、方向、层级等过滤。view=timeline 使用事件时间线（limit 生效）；view=workspace 使用工作台时间线（filters 生效）。限制：只返回用户可见的投影，内部行 id、匹配内部结构与原始载荷不返回；没有条目时 state=empty，不补默认事件。',
    inputSchema: timelineInputSchema,
    outputSchema: timelineOutputSchema,
    handlerId: 'market-intelligence.get-intelligence-timeline',
    timeoutMs: 10_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'query_macro_calendar',
    domain: 'calendar',
    kind: 'read',
    title: { 'zh-CN': '宏观日历月查询', 'en-US': 'Macro calendar month' },
    description:
      '按 YYYY-MM 查询某个月的宏观日历事件，并用 asOf 冻结查询时点。限制：asOf 之后才发生的事件修订不会出现；月查询不可用时返回 state=unavailable 与 failureCode，不返回空月份来假装没有事件；maxEvents 有上限，超过时只返回上限内的条目。',
    inputSchema: macroCalendarMonthInputSchema,
    outputSchema: macroCalendarMonthOutputSchema,
    handlerId: 'market-intelligence.query-macro-calendar',
    timeoutMs: 10_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'get_translation_status',
    domain: 'translation',
    kind: 'read',
    title: { 'zh-CN': '翻译状态', 'en-US': 'Translation status' },
    description:
      '读取翻译模块的只读状态：模块计数（待翻译/失败/已翻译、最近任务）、当前设置与目标语言，以及逐条翻译状态。限制：不返回翻译正文以外的内部记录，也不触发任何翻译；queued 为空的含义是当前没有待处理项，不是翻译已完成。',
    inputSchema: translationStatusInputSchema,
    outputSchema: translationStatusOutputSchema,
    handlerId: 'market-intelligence.get-translation-status',
    timeoutMs: 10_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'get_cross_asset_snapshot',
    domain: 'cross-asset',
    kind: 'read',
    title: { 'zh-CN': '跨资产快照', 'en-US': 'Cross-asset snapshot' },
    description:
      '读取跨资产观察快照：给定 range（1h/24h/7d）的收益曲线、已收盘窗口收益、相关性、相对收益与读数口径。限制：asOf 可省略，省略时取现在；没有可用快照时只返回 state=unavailable，不编造读数；不返回任何端点、URL 或接口凭据。',
    inputSchema: crossAssetSnapshotInputSchema,
    outputSchema: crossAssetSnapshotOutputSchema,
    handlerId: 'market-intelligence.get-cross-asset-snapshot',
    timeoutMs: 10_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'get_dashboard_feed_status',
    domain: 'operations',
    kind: 'read',
    title: { 'zh-CN': '看板来源状态', 'en-US': 'Dashboard feed status' },
    description:
      '读取看板来源状态条所需的逐源事实：是否启用、是否已保存凭据、最近成功时间与最近的终态失败码。限制：只返回布尔值与枚举码，不返回 provider 原文、请求 URL 或密钥；某源从未成功时 lastSuccessAtMs 缺席，不带默认时间。',
    inputSchema: dashboardFeedStatusInputSchema,
    outputSchema: dashboardFeedStatusOutputSchema,
    handlerId: 'market-intelligence.get-dashboard-feed-status',
    timeoutMs: 5_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'describe_intelligence_capabilities',
    domain: 'operations',
    kind: 'discovery',
    title: { 'zh-CN': '能力清单', 'en-US': 'Capability discovery' },
    description:
      '列出本产品当前提供给 Agent 的能力（按域分组，含 id、类型、标题、说明与必填字段名），用于在调用前确认某个域有哪些工具可用。限制：只列出已注册的能力，不返回实现细节、handlerId 或任何凭据；可按 domain 过滤，未知域等同于空分组。',
    inputSchema: describeCapabilitiesInputSchema,
    outputSchema: describeCapabilitiesOutputSchema,
    handlerId: 'market-intelligence.describe-intelligence-capabilities',
    timeoutMs: 5_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  }
] as const satisfies readonly IntelligenceAgentCapability[]

export type CapabilityId = (typeof intelligenceAgentCapabilities)[number]['id']
