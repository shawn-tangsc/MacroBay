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
  calendarStateInputSchema,
  calendarStateOutputSchema,
  crossAssetSnapshotInputSchema,
  crossAssetSnapshotOutputSchema,
  dashboardFeedStatusInputSchema,
  dashboardFeedStatusOutputSchema,
  describeCapabilitiesInputSchema,
  describeCapabilitiesOutputSchema,
  listSourcesInputSchema,
  listSourcesOutputSchema,
  macroCalendarMonthInputSchema,
  newsSentimentInputSchema,
  newsSentimentItemInputSchema,
  newsSentimentItemOutputSchema,
  newsSentimentOutputSchema,
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
import {
  configureCrossAssetInterfaceInputSchema,
  configureCrossAssetInterfaceOutputSchema,
  configureIntelligenceSourceInputSchema,
  configureIntelligenceSourceOutputSchema,
  configureTranslationInputSchema,
  configureTranslationOutputSchema,
  operateIntelligenceSourceInputSchema,
  operateIntelligenceSourceOutputSchema,
  operateMacroCalendarInputSchema,
  operateMacroCalendarOutputSchema,
  requestSourceCredentialInputSchema,
  requestSourceCredentialOutputSchema
} from './writeCapabilitySchemas'

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
    timeoutMs: 10_000,
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
    timeoutMs: 10_000,
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
    timeoutMs: 10_000,
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
    timeoutMs: 10_000,
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
      '按 YYYY-MM 查询某个月的宏观日历，同时返回「官方日历」（BLS/Fed/BEA 等官方发布）与「市场日历」（0xRouter 的市场事件），并在 events 里给出带 source 标记的合并时间线。官方侧回答官方发布与发布值，市场侧回答市场预期（consensus）、前值与已公布值，两者口径不同，不要混用。每个事件带 surprise（beat/miss/inline/consensus-unavailable）；可比时另有 surpriseValue 与 surpriseUnit（pp=百分点，relative-percent=相对预期偏离百分比），不可比或缺少一侧时给 surpriseReason，不要自己再做减法或换算单位。官方源不提供 consensus，所以官方事件恒为 consensus-unavailable。限制：asOf 之后才发生的事件修订不会出现；某一侧不可用时该侧为 unavailable 并写进 caveats，另一侧照常返回；市场日历是分页读取的，工具会翻完所有页，但 events 默认只保留前 120 条，截断时 truncated=true 且 totalEvents 给出总数，问某一天时请用 from/to 收窄（ISO 时间，含时区）；events 为空表示两侧都没有该月条目，不是「当天没有数据发布」；maxEvents 最大 300。',
    inputSchema: macroCalendarMonthInputSchema,
    outputSchema: macroCalendarMonthOutputSchema,
    handlerId: 'market-intelligence.query-macro-calendar',
    timeoutMs: 10_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'get_calendar_state',
    domain: 'calendar',
    kind: 'read',
    title: { 'zh-CN': '日历供应商状态', 'en-US': 'Calendar provider state' },
    description:
      '读取宏观日历供应商的开关与读者自己改过的发布时间覆盖。providers 里 configured=false 且 enabled=null 表示该供应商从未保存过设置，不是「已停用」；releaseTimes 逐条给出被读者覆盖的 eventKey、发布时间与发布日，没有覆盖时为空数组，不编造约定默认时间。限制：只回答供应商设置与发布时间覆盖，事件、发布值与预期差由 query_macro_calendar 回答；不返回任何凭据、URL、原始 HTTP 响应或调度内部结构。',
    inputSchema: calendarStateInputSchema,
    outputSchema: calendarStateOutputSchema,
    handlerId: 'market-intelligence.get-calendar-state',
    timeoutMs: 5_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'query_news_sentiment',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '重点舆情', 'en-US': 'Key news sentiment' },
    description:
      '读取面板「重点舆情」同一份数据：按时间窗口聚合的新闻/公告条目、多空判定、强度、置信度、来源与情绪汇总。限制：这是读时聚合，不触发打分或翻译；窗口内没有条目时 state=empty 并带 news-empty-window，不要当成「没有新闻」；条目正文常只有标题（caveat body-limited），引用时必须带来源与发布时间；不返回原始网页、请求头或凭据。',
    inputSchema: newsSentimentInputSchema,
    outputSchema: newsSentimentOutputSchema,
    handlerId: 'market-intelligence.query-news-sentiment',
    timeoutMs: 10_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'get_news_sentiment_item',
    domain: 'query',
    kind: 'read',
    title: { 'zh-CN': '舆情条目详情', 'en-US': 'News sentiment item' },
    description:
      '读取单条舆情的详情：标题、来源、发布时间、多空判定与正文摘录（可能来自翻译）。限制：itemId 必须来自 query_news_sentiment 的返回；查不到时返回 state=unavailable，不要自行编造内容；正文摘录受长度限制，缺失时说明只有标题。',
    inputSchema: newsSentimentItemInputSchema,
    outputSchema: newsSentimentItemOutputSchema,
    handlerId: 'market-intelligence.get-news-sentiment-item',
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
      '读取跨资产观察快照：给定 range（1h/24h/7d）的收益曲线、已收盘窗口收益、相关性、相对收益与读数口径，并同时返回 interface（配置 state、enabled 与租约 lease）。interface 不表示数据好坏，只表示通道状态：state=unknown 或 lease=unknown 是「判定不了」，不是「确定没有」；lease=none 才是确定没有租约，expired 表示租约曾存在但已过期。限制：asOf 可省略，省略时取现在；没有可用快照时 state=unavailable，但仍带 interface，不编造读数；不返回 leaseId、端点、URL 或接口凭据。',
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
  },
  {
    id: 'configure_intelligence_source',
    domain: 'source-config',
    kind: 'write',
    title: { 'zh-CN': '修改情报源配置', 'en-US': 'Configure intelligence source' },
    description:
      '修改一个情报源的配置，每次调用都会先请用户确认。action=save-profile 只改采集预设、是否计入情绪、范围策略、原始归档、保留策略、解析器升级后自动重放与监控标的——不能改启用状态、凭据或自由配置；action=set-enabled 启用或停用一个源；action=save-focus-markets 改焦点市场。返回 changed（逐字段 before/after）与改动前后的配置修订号。限制：凭据只通过 request_source_credential 交接，绝不经过本工具；未知 sourceId 会失败且不做任何修改；sourceSpecificConfigJson 与 credentialRef 一律不被接受。',
    inputSchema: configureIntelligenceSourceInputSchema,
    outputSchema: configureIntelligenceSourceOutputSchema,
    handlerId: 'market-intelligence.configure-intelligence-source',
    timeoutMs: 10_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'operate_intelligence_source',
    domain: 'operations',
    kind: 'write',
    title: { 'zh-CN': '情报源运行操作', 'en-US': 'Operate intelligence source' },
    description:
      '对情报源执行一次性运行操作，每次调用都会先请用户确认。action=run-now 立即采集一次并返回 worker 动作与排队时间；action=test-connection 测试连接并返回 ok、message 与 testedAt；action=retry-assessment 重试单条情报的评估并返回评估/失败条数。限制：这些动作不修改配置，所以 changed 为空；源未启用或未就绪时由产品服务拒绝，本工具不会顺手替你启用；不读取、不返回任何凭据或原始响应。',
    inputSchema: operateIntelligenceSourceInputSchema,
    outputSchema: operateIntelligenceSourceOutputSchema,
    handlerId: 'market-intelligence.operate-intelligence-source',
    timeoutMs: 15_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'operate_macro_calendar',
    domain: 'calendar',
    kind: 'write',
    title: { 'zh-CN': '维护宏观日历', 'en-US': 'Operate macro calendar' },
    description:
      '维护宏观日历供应商与发布时间，每次调用都会先请用户确认。动作：save-provider-profile（启用/停用供应商）、run-provider-now、test-provider-connection、set-release-time 与 clear-release-time（读者自己的发布时间覆盖，写入后立即回读）、refresh-bls-employment 与 refresh-fed-fomc（会改写已发布数值，必须同时传 acknowledgeOverwrite=true；真正的二次确认由产品注入，模型不能传 confirmed）、sync-bls-schedule（按年份同步 BLS 日程）、preview-manual-ics 与 import-manual-ics（先预览再导入手工 ICS）。限制：不返回原始 HTTP 响应、证据正文或凭据；预览不落库，导入才是显式写入。',
    inputSchema: operateMacroCalendarInputSchema,
    outputSchema: operateMacroCalendarOutputSchema,
    handlerId: 'market-intelligence.operate-macro-calendar',
    timeoutMs: 15_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'configure_translation',
    domain: 'translation',
    kind: 'write',
    title: { 'zh-CN': '配置与补翻翻译', 'en-US': 'Configure translation' },
    description:
      '修改翻译设置或排队翻译任务，每次调用都会先请用户确认。action=save-settings 只改自动翻译开关、目标语言、供应商/模型与标题/摘要/证据摘录三个开关；action=queue-missing 以 manual-selection 原因补翻缺失项，可用 itemIds、clusterIds、filters、targetLocale 限定范围；action=retry-failed 以 retry-failed 原因重试失败项。限制：未提供的设置字段保持原值；不返回翻译正文以外的内部记录，也不读取或返回模型凭据；队列为空表示当前没有待处理项，不代表翻译已完成。',
    inputSchema: configureTranslationInputSchema,
    outputSchema: configureTranslationOutputSchema,
    handlerId: 'market-intelligence.configure-translation',
    timeoutMs: 15_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'configure_cross_asset_interface',
    domain: 'cross-asset',
    kind: 'write',
    title: { 'zh-CN': '维护跨资产接口', 'en-US': 'Configure cross-asset interface' },
    description:
      '维护跨资产观察接口的租约与连通性，每次调用都会先请用户确认。动作：acquire 获取租约；renew、release、refresh 对一个 leaseId 续租、释放或刷新；test-interface 触发一次接口测试；cancel-test 取消正在运行的测试。限制：只返回状态枚举、leaseId、到期时间与逐资产 rest/ws 布尔值，不返回端点、URL、请求头或任何凭据；接口未启用或运行时不可用时返回 unavailable，不伪造成功。',
    inputSchema: configureCrossAssetInterfaceInputSchema,
    outputSchema: configureCrossAssetInterfaceOutputSchema,
    handlerId: 'market-intelligence.configure-cross-asset-interface',
    timeoutMs: 15_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  },
  {
    id: 'request_source_credential',
    domain: 'source-config',
    kind: 'handoff',
    title: { 'zh-CN': '发起凭据填写', 'en-US': 'Request source credential' },
    description:
      '当某个情报源需要凭据而用户尚未填写时，返回设置页的填写入口，而不是索要或接收密钥。输出只有 handoff、sourceId、settingsSectionId 与需要填写的字段名（如 apiKey；无需凭据的源为空数组）。限制：不返回、不回显、不校验任何密钥、掩码或历史；用户填完后应改用 test-connection 验证，绝不要让用户在对话里粘贴 key。',
    inputSchema: requestSourceCredentialInputSchema,
    outputSchema: requestSourceCredentialOutputSchema,
    handlerId: 'market-intelligence.request-source-credential',
    timeoutMs: 5_000,
    maxOutputBytes: READ_OUTPUT_BYTES
  }
] as const satisfies readonly IntelligenceAgentCapability[]

export type CapabilityId = (typeof intelligenceAgentCapabilities)[number]['id']
