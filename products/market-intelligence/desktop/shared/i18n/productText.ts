/**
 * 已注册发布的事件名词表——全产品**唯一一份**（设计 145 §8 D）。
 *
 * **分析侧是 owner**：`analysisWorkspace.readableNames.eventName` 就是这一份，模型提示词的中文词表
 * 与它逐年比对（`analysisModelVocabulary.test.ts`），图表竖线也用它取名。日历侧的 `calendar.events`
 * 是同一份值的引用（只多一个「未注册官方行」的兜底词），因此同一个发布在竖线、日历卡片与抽屉里
 * 读同一个名字——两处各写一份措辞，正是读者指出的瑕疵（竖线「核心 CPI」/ 抽屉
 * 「Core CPI（核心消费者价格指数）」）。
 *
 * 只有 9 个已注册指标在这里；provider 的长尾事件不起中文名，用它自己的 `displayName`。
 * 改动这里之前先想清楚：模型侧词表与服务侧 `analysisModelVocabulary` 必须同时改，否则红了是对的。
 */
const registeredEventNames = {
  'zh-CN': {
    cpi: '消费者物价指数（CPI）', 'core-cpi': '核心 CPI', 'nonfarm-payrolls': '非农就业人数',
    unemployment: '失业率', 'average-hourly-earnings': '平均时薪', pce: 'PCE 物价', 'core-pce': '核心 PCE',
    gdp: 'GDP', fomc: '美联储议息会议'
  },
  'en-US': {
    cpi: 'CPI', 'core-cpi': 'Core CPI', 'nonfarm-payrolls': 'Nonfarm payrolls',
    unemployment: 'Unemployment rate', 'average-hourly-earnings': 'Average hourly earnings', pce: 'PCE', 'core-pce': 'Core PCE',
    gdp: 'GDP', fomc: 'FOMC decision'
  }
} as const

/**
 * Market Intelligence 产品文案（i18n）。
 */
export const productText = {
  'zh-CN': {
    pages: {
      intelligence: {
        title: '情报',
        subtitle: '情报控制台：采集状态、三层信号覆盖与下一步操作',
        loading: '加载中…',
        loadFailed: '加载失败，请重试。',
        evaluateAlerts: '评估近期事件告警',
        evaluatingAlerts: '评估中…',
        empty: '暂无相关事件。事件采集接入后会在此显示。',
        portal: {
          moduleLabel: 'MARKET INTELLIGENCE / AGENTS',
          agents: {
            crypto: { name: '数字货币市场解读员', lens: 'CRYPTO MARKET LENS', sourceSummary: '7 个静态情报源' },
            stocks: { name: '股票市场解读员', lens: 'EQUITIES MARKET LENS', sourceSummary: '数据源待接入' },
            futures: { name: '期货市场解读员', lens: 'FUTURES MARKET LENS', sourceSummary: '数据源待接入' }
          },
          states: { available: '配置激活', comingSoon: '准备中' },
          sourceSummary: { count: '{count} 个静态情报源', pending: '数据源待接入' },
          actions: { activate: '配置并激活', openDashboard: '打开看板', unavailable: '—' },
          analysisWorkspace: {
            openAgent: '完整 Agent 面板', stop: '停止', approvalRequired: '等待工具审批，请打开完整 Agent 面板处理；也可停止本次运行。',
            title: '数字货币解读 Agent', chat: '分析对话', dashboard: '市场看板', view: '切换工作区', selectedAnalysis: '已绑定选中分析', selectedEvent: '选中事件', contextAnalysis: '引用分析',
            newConversation: '市场解读对话', newChatAction: '新对话', sessionHistory: '历史会话', deleteSession: '删除会话', deleteSessionConfirm: '删除这个会话？', cancel: '取消', noSessions: '还没有历史会话', loading: '正在加载 Agent…', noSelection: '当前市场 · 可选择下方分析节点追问', clearSelection: '返回当前市场',
            empty: '向市场解读员提问，或选择下方时间轴中的分析。', input: '输入问题', placeholder: '想了解哪些市场变化？', followUpPlaceholder: '针对选中的分析继续提问…',
            send: '发送', sending: '分析中', resize: '调整日历与舆情高度', failed: '发送未完成，请检查会话记录和模型配置后再试。', modelRequired: '请在通用 Agent 设置中为数字货币市场解读员选择可用模型。',
            roles: { user: '你', assistant: '市场解读员', system: '系统' }, messageStates: { pending: '处理中', error: '运行失败', paused: '已暂停' },
            closeDetail: '关闭详情', detailUnavailable: '该节点的分析详情暂不可用。', readTrace: '最近一次读取', conclusionBlocks: { change: '本次变化', 'causal-chain': '因果链', condition: '成立条件', macro: '宏观侧', evidence: '证据强弱', 'data-gap': '数据缺口' }, changeFacts: '发生变化的字段', changeStructural: '结构性变化', changeDomainAdded: '新增缺失域', changeDomainRemoved: '恢复缺失域', changeCaveatAdded: '新增数据限制', changeCaveatRemoved: '解除数据限制', changeEvidenceAdded: '新增证据', changeEvidenceRemoved: '移除证据', changeObservationsAdded: '新增观测', changeObservationsRemoved: '退出窗口',
            changeSummary: '本次数据变化', noChange: '本次无新变化（与上一次快照一致）。', latestConclusion: '最新 AI 结论', latestConclusionHint: '点击下方时间轴节点可在左侧查看该节点的完整结论，不影响当前绑定。', latestConclusionEmpty: '暂无已发布的 AI 结论。可在下方时间轴生成首次分析。', latestConclusionLoading: '正在读取最新 AI 结论…', latestConclusionUnavailable: '最新结论详情暂不可用，请稍后重试。', openDetail: '查看完整结论',
            conclusionDirection: { label: '方向', bullish: '偏多', bearish: '偏空', range: '震荡', undecided: '暂不判断', mixed: '信号冲突' },
            directions: { title: '操作方向建议', horizons: { short: '短期（0-24 小时）', medium: '中期（1-7 天）', long: '长期（1-4 周）' }, unknownHorizon: '其他周期', confidence: { label: '置信度', low: '低', medium: '中', high: '高' } },
            /**
             * 分析内部标识的人话名称。模型提示词有自己的中文词表（主进程不能引用渲染层代码），
             * 两份词表由 analysisModelVocabulary.test.ts 逐年比对，禁止各说各话。
             */
            readableNames: {
              domain: { macro: '宏观', capital: '资金面', sentiment: '情绪', funding: '资金费率', 'cross-asset': '跨资产' },
              metric: {
                'current-usd': '当前值', 'change-1d-usd': '1 日变化', 'change-7d-usd': '7 日变化', 'change-30d-usd': '30 日变化',
                'etf-net-flow-usd': 'ETF 净流入', 'funding-rate-percent': '资金费率', 'fear-greed-index': '恐惧贪婪指数',
                'price-return-15m': '15 分钟价格收益', 'price-return-2h': '2 小时价格收益',
                'price-return-24h': '24 小时价格收益', 'price-return-3d': '3 天价格收益',
                'relative-return-2h': '2 小时相对收益（BTC 相对 ETH）', 'cpi-12-month-percent': 'CPI 年率', score: '评分',
                // The 市场状态 block's dollar/gold row and FRED's daily rate block, which the analysis
                // now reads as facts: every one of them needs a reader-facing name.
                'dollar-index-level': '美元指数', 'dollar-index-return-15m': '美元指数 15 分钟变化',
                'dollar-index-return-1h': '美元指数 1 小时变化', 'dollar-index-return-4h': '美元指数 4 小时变化',
                'dollar-index-return-24h': '美元指数 24 小时变化', 'gold-price-usd-oz': '黄金价格',
                'us-10y-yield': '美债 10 年期收益率', 'us-10y-yield-change-1d': '美债 10 年期 1 日变化',
                'us-10y-real-yield': '美债 10 年期实际利率', 'us-10y-real-yield-change-1d': '美债 10 年期实际利率 1 日变化',
                'us-2y-yield': '美债 2 年期收益率', 'us-2y-yield-change-1d': '美债 2 年期 1 日变化',
                'us-10y-breakeven-inflation': '美债 10 年期盈亏平衡通胀', 'us-10y-2y-term-spread': '10Y−2Y 期限利差',
                'event-name': '事件', 'lifecycle-state': '生命周期', 'scheduled-date': '计划日期', 'scheduled-at': '计划时间',
                'official-release-date': '官方发布日期', actual: '实际值', previous: '前值', consensus: '市场预期', 'event-excerpt': '事件摘要'
              },
              subject: {
                stablecoins: '稳定币', BTC: 'BTC', ETH: 'ETH', market: '市场', all: '全部', 'btc-vs-eth': 'BTC 相对 ETH',
                'consumer-price-index': '消费者物价指数', 'employment-situation': '就业形势', fomc: '美联储议息',
                pce: 'PCE 物价', 'core-pce': '核心 PCE', gdp: 'GDP',
                'economic-indicator': '经济指标', 'financial-event': '金融事件', 'central-bank-activity': '央行活动',
                'usd-index': '美元指数', gold: '黄金', 'us-treasury': '美债利率'
              },
              // 唯一 owner 见文件头 `registeredEventNames`。
              eventName: registeredEventNames['zh-CN'],
              lifecycleState: { scheduled: '待公布', released: '已公布', cancelled: '已取消' },
              comparability: { comparable: '可比', 'not-comparable': '不可比' },
              caveat: {
                'max-items-truncated': '证据条数已截断', 'source-health-unavailable': '来源健康度不可用', 'query-unavailable': '查询不可用',
                'query-empty': '查询结果为空', 'evidence-unavailable': '证据不可用', 'not-comparable': '与其他数据不可比',
                'macro-calendar-unavailable': '经济日历不可用', 'macro-calendar-empty': '经济日历为空',
                'macro-calendar-consensus-unavailable': '缺少市场预期值', 'macro-calendar-query-not-wired': '经济日历未接线',
                'observed-unverified': '来源身份未验证', 'provider-title-is-display-name': '事件名取自提供方标题',
                'provider-surprise-not-comparable': '预期差不可计算', 'provider-observation-identity-missing': '日历观测缺少稳定身份',
                'provider-observation-page-unavailable': '日历观测不可用', 'provider-observation-pages-truncated': '日历观测分页已截断',
                'provider-observations-truncated': '日历观测条数已截断', 'etf-unavailable': 'ETF 数据不可用',
                'sentiment-not-computed-as-of': '情绪指标尚未计算', 'domain-not-requested': '未请求该域', 'query-not-run': '尚未执行查询',
                'official-time-not-published': '官方未公布时间', 'official-timezone-not-published': '官方未公布时区',
                'official-period-not-published-in-ics': '官方未公布统计期', 'official-value-revised': '官方值已修订',
                'manual-ics-import': '手工导入日历', 'bls-python-schedule': 'BLS 自动排期', 'bea-official-rss-release-page': 'BEA 官方发布页',
                'us-cash-session': '仅美股现金时段', 'tokenized-index-proxy': '代币化指数代理',
                'official-daily-close': '官方日频收盘，可能滞后数个交易日', 'synthetic-dollar-index': '合成美元指数（非官方 ICE 指数）',
                'provider-time-series': '提供方时间序列（按提供方周期成 bar）', 'query-stale': '读数已过期，不作为当前值',
                'macro-rates-mixed-observation-dates': '两条日频序列观察日不一致，不计算差值'
              },
              term: { consensus: '市场预期值', actual: '实际值', previous: '前值', stablecoins: '稳定币' }
            }
          },
          calendarCard: {
            title: '接下来要看的', todaySection: '最近已公布（有变化）', upcomingSection: '待发布',
            empty: '未来 7 天无高重要性事件', unavailable: '日历数据暂不可用', refresh: '刷新',
            awaitingData: '已到发布时刻，等待实际值',
            // 「±30 分」反应那一行的标签（原型 ④）。三条线的名字用跨资产那份词表。
            reactionWindow: '±30分',
            openCalendar: '打开经济日历', switchToAgent: '切换到市场解读 Agent', switchToCalendar: '切换到日历卡片',
            openEventInCalendar: '在日历中打开该事件',
            collapseAgent: '收起 Agent', expandAgent: '打开市场解读 Agent', closeAgent: '关闭', agentTitle: '市场解读 Agent', clearConversation: '清空', copyEvent: '复制', eventContext: { heading: '选中事件', state: '状态', released: '已公布', upcoming: '待公布', cancelled: '已取消', missing: '未公布', related: '同期事件', factsHeading: '系统当前事实', factsUnavailable: '系统当前没有这条事件的数据，请勿据此推断', factsPartial: '以下事实不完整，缺失处请直说缺失', factsEvidence: '证据引用' }, importanceHigh: '高重要性', timePending: '时间待定'
          },
          analysisTimeline: {
            retryAnalysis: '重试分析', attemptFailed: '上次分析未发布',
            failureReasons: { 'analysis-invalid-output-schema': '模型输出格式不符合要求，请重试。', 'analysis-missing-evidence': '分析输出与冻结证据不一致，已拒绝发布，请重试；若持续失败请检查情报来源。', 'analysis-provider-not-ready': '模型未就绪，请检查模型服务配置。', 'analysis-provider-error': '模型调用失败，请检查连接后重试。', 'analysis-timeout': '模型调用超时，请重试。', 'analysis-cancelled': '分析被中断（应用关闭或任务取消），请重试。' },
            triggerStatus: { label: '最近一次判定', since: '起', slotOpen: '本机开盘 ', slotDelayed: '延迟补跑', reasons: { 'significance-confirmed': '数据变化显著，已开始分析', 'significance-below-threshold': '数据无显著变化，本次未分析', 'provider-surprise-confirmed': 'provider 日历的发布显著偏离市场预期（非官方值），已开始分析', 'semantic-no-op': '数据与上次相同，本次未分析', 'interval-active': '距上次分析不足 30 分钟，已合并', 'hour-budget-exhausted': '本小时分析次数已达上限', 'day-budget-exhausted': '今天分析次数已达上限', 'schedule-reserve-exhausted': '今日盘口分析额度已用尽', 'session-slot-asia': '亚洲盘开盘分析（08:00）', 'session-slot-europe': '欧洲盘开盘分析（16:00）', 'session-slot-us': '美洲盘开盘分析（24:00）', 'invalid-significance-input': '判定输入异常，本次未分析', 'manual-request': '你在界面上手动触发', 'severity-confirmed': '这条情报达到高重要性门槛，已开始分析', 'medium-score-confirmed': '这条情报达到中等级别门槛，已开始分析', 'market-reaction-confirmed': '已确认出现可比行情反应，已开始复盘', 'restart-initial-compensated': '进程重启后补跑缺失的首次分析', 'restart-review-compensated': '进程重启后补跑缺失的复盘' } },
            loadMore: '加载更多', selectEntry: '选择一个时间轴节点查看详情。',
            settings: '设置', settingsTitle: 'AI 分析设置', analysisEnabled: '开启 AI 分析',
            analysisEnabledHint: '关闭后不再自动分析，也不会调用模型。', analysisModel: '分析模型', modelFollowDefault: '跟随默认助手模型', followsDefaultPrefix: '跟随默认：',
            enableAnalysis: '开启 AI 分析', analysisOffHint: 'AI 分析已关闭。历史分析仍保留，开启后才会生成新的分析。',
            refusalModelUnconfigured: '没有可用的默认助手模型，请先在设置里选择分析模型。', refusalModelUnavailable: '所选模型当前不可用，请换一个模型。',
            refusalFailed: '保存失败，请重试。', saving: '保存中…', save: '保存', cancel: '取消',
            entry: '消息分析 / 时间轴', description: '查看已发布的分析摘要、预测与证据覆盖',
            workspaceLabel: '— MARKET ANALYSIS', title: 'AI 情报分析', back: '返回 Agent', loading: '正在加载消息分析…', unavailable: '分析详情暂不可用。', empty: '暂无已发布的消息分析。', requestInitialAnalysis: '生成首次分析', refreshAnalysis: '立即分析', initialAnalysisQueued: '首次分析已入队，完成后会自动更新。', initialAnalysisUnavailable: '当前没有符合条件的已发布情报可分析。', initialAnalysisFailed: '首次分析任务启动失败，请刷新后重试。', analysisRefreshAlreadyAvailable: '已有最新分析，无需重新分析。', analysisRefreshFailed: '重新分析请求未成功，请稍后重试。', analysisServiceNotReady: '分析服务正在启动，请稍后重试。', timeline: '分析时间轴', detail: '分析详情', dismissError: '关闭提示',
            eventGroup: '事件组', analysisRun: '分析运行', summaryVersion: '摘要版本', evidenceCount: '证据数量', asOf: '分析时点', dataCutoff: '数据限制', conclusion: 'AI 结论', confirmedFacts: '已确认事实', transmission: '传导判断', marketReaction: '市场反应', noMarketReaction: '当前没有可比行情证据，暂不判断市场方向。', supportingEvidence: '支撑证据', counterEvidence: '反向证据', catalysts: '后续关注', auditInfo: '查看审计信息', prediction: '预测', noPrediction: '该摘要暂无预测。', conditions: '条件', invalidation: '失效条件', verificationDue: '验证截止', agentUnavailable: '追问 Agent 将在下一阶段启用。',
            status: { published: '已发布', stale: '已过期', superseded: '已替代', pending: '待验证', confirmed: '已确认', 'partially-confirmed': '部分确认', invalidated: '已失效', expired: '已到期', 'insufficient-data': '数据不足' }
          },
          newsSentiment: {
            title: '重点舆情',
            all: '全部',
            loading: '正在读取舆情…',
            empty: '暂无数据',
            unavailable: '舆情暂时不可用。',
            retry: '重试',
            refresh: '刷新',
            labels: { bullish: '偏多', bearish: '偏空', neutral: '中性', mixed: '分歧' },
            counts: '{count} 条',
            breakdown: '多 {bull} · 空 {bear} · 中性 {flat}',
            engine: { model: '模型', rules: '规则' },
            bodyLimited: '部分条目仅依据标题',
            openAll: '查看全部舆情',
            settings: '舆情设置',
            drawer: {
              title: '舆情',
              filters: { direction: '方向', source: '来源', scope: '对象', all: '全部' },
              scope: { market: '全市场', BTC: 'BTC', ETH: 'ETH' },
              columns: { time: '时间', title: '标题', polarity: '方向', source: '来源', symbols: '标的' },
              detail: { evidence: '证据引文', strength: '强度', confidence: '置信', strengthLevels: { weak: '弱', medium: '中', strong: '强' }, body: '正文摘录', noBody: '仅依据标题与摘要判断', translatingBody: '正在翻译正文…', translationFailed: '正文翻译失败，先显示原文。', translateBody: '翻译正文', engine: '引擎', prompt: '提示词', original: '原文', openOriginal: '原文链接' },
              emptyFiltered: '当前筛选没有结果。',
              clearFilters: '清除筛选',
              loadMore: '加载更多',
              settings: '设置'
            },
            settingsModal: {
              title: '舆情设置',
              modelScoring: '使用模型判断新闻方向',
              model: '判断模型',
              followFast: '跟随快速模型：{name}',
              fastUnset: '模型服务里还没有设置快速模型',
              hint: '模型只决定新闻方向；翻译仍按情报源的翻译偏好。',
              judgeHint: '“跟随”跟随的是快速模型，与翻译模型是两套独立设置。',
              translation: { label: '翻译', on: '自动翻译已开启', off: '自动翻译已关闭', open: '打开翻译偏好', modelLabel: '翻译模型', followDefault: '跟随模型服务默认' },
              rescore: '重新评分已有条目', rescoring: '正在加入队列…', rescored: '已加入队列，完成后刷新查看。', rescoreFailed: '重新评分失败，请重试。',
              rebuild: '重新抓取全部正文', rebuilding: '正在清空并重建…', rebuilt: '已清空正文与判断并重新抓取，稍后刷新。', rebuildFailed: '重建失败，请重试。',
              retryTranslation: '翻译全部缺失', translateAll: '全部翻译', translating: '正在翻译…', translationStatus: { waiting: '等待翻译', translating: '翻译中', translated: '已翻译', failed: '翻译失败', contextMenu: '右键更多操作', translateOne: '翻译此条', retranslateOne: '重新翻译' }, translationQueued: '已提交翻译重试，完成后刷新查看。', translationRetryFailed: '翻译重试提交失败。',
              save: '保存',
              cancel: '取消',
              saved: '已保存',
              failed: '保存失败'
            }
          },
          analysisDrawer: { title: '分析时间轴', open: '分析时间轴', close: '关闭' },
          dashboard: {
            workspaceLabel: '— CRYPTO INTELLIGENCE',
            title: '数字货币市场检查表',
            description: '按资金、宏观、加密风险偏好、杠杆顺序阅读；没有覆盖时保留 partial，不以中性填补。',
            backToAgents: '返回 Agent',
            configureSources: '配置情报源',
            crossAsset: {
              title: '纳斯达克 100 / QQQ 代理 × BTC × ETH 联动', subtitle: 'Binance QQQUSDT 代币化永续代理（24/7，默认，带「代理」标签）；该腿不可用时回落到真实纳斯达克 100 指数（USTEC · 美股现金时段）',
              chart: '同起点收益率',
              eventLine: '事件',
              // 官方与 provider 同分钟、未能确认是同一条发布时的线上说明（设计 145 §8 B 的留痕）。
              eventLineIdentityUnconfirmed: '同一分钟里官方日历也有一条发布，没能确认是同一条，两边的名字都保留',
              eventsCollapsed: '已折叠 {count} 条事件',
              readingMarket: 'BTC↔ETH 高相关 = 同涨同跌；真正有信息量的是它们与 QQQ/美元的相关性——那才说明驱动来自哪里。',
              readingEvent: '同一时刻横向对比 —— 美元涨、黄金跌、BTC 跟跌 = 贴现率驱动；黄金涨、BTC 跌 = BTC 在当风险资产交易。',
              // The row is named after the instrument that actually answers it, so a price and its name
              // can never disagree. `assets.index` is the row's *default* instrument — the perpetual it
              // shows unless the licensed fallback answers — which is also the name an unanswered row
              // carries, because that is what it would display.
              assets: { index: 'QQQ', btc: 'BTC', eth: 'ETH' },
              indexNames: { real: '纳斯达克 100', proxy: 'QQQ' },
              noData: '无数据', windowNoData: '—', forming: '实时未闭合',
              refresh: '更新历史', loading: '正在加载行情…', unavailable: '行情暂不可用',
              quote: '纳斯达克 100 最新收盘', closed: '已闭合涨跌', observed: '成交时间', analysis: '闭合数据截至',
              observations: '跨市场观察', correlations: '24h · 5m 收益率相关性', indexBtc: '纳斯达克 100 ↔ BTC', indexEth: '纳斯达克 100 ↔ ETH',
              proxyTag: '代理', proxyCaveat: '代币化合成品：Binance QQQUSDT 永续（24/7），不是标准纳斯达克 100 指数。本行默认显示它；真实指数只在它拿不到数据时接手。',
              indexCaveat: '真实纳斯达克 100 指数（RealMarketAPI · USTEC），只在美股现金时段产生新的 5 分钟 K 线。',
              marketClosed: '休市', marketClosedHint: '美股现金时段（纽约 09:30–16:00）之外没有新的 5 分钟 K 线，这里显示最后一根已收盘 K 线。',
              lastClosedBar: '最后一根已收盘 K 线',
              proxyMarketState: '代币化代理 24/7 交易',
              statusTitle: '市场状态', statusColumns: { asset: '资产', latest: '最新', '15m': '15m', '1h': '1h', '24h': '24h', '7d': '7d' },
              assetLabels: { dxy: '美元 DXY', gold: '黄金 XAU', us10y: '美债 10Y', realRate: '实际利率' },
              syntheticTag: '合成', syntheticCaveat: '该美元指数由 ICE 篮子货币按公布权重合成，不是官方 ICE DXY 指数。',
              notConnected: '未接入', notConnectedHint: '尚未接入数据源，接入后自动显示',
              dailyFrequency: '日频', bpUnit: 'bp',
              // One observation per trading day, so the four intraday windows are one cell whose date
              // is the day FRED actually published — never "now".
              dailyChangeWithDate: '日频 {change}（截至 {date}）',
              // 区块自己的节奏：官方日频每交易日发布一次，没发布新收盘前这行不会变——读者
              // 看到一行两天不动时会以为坏了，所以节奏写在区块表头上，不塞进数值格。
              dailyCadence: '每交易日发布一次；未发布新收盘前不变',
              dailyChangeUnknownWithDate: '日频 —（截至 {date}）',
              termSpread: '期限利差',
              // 通胀预期是自己一条序列，可以比这两行早一天（2026-10-15 就是），所以永远带自己的观察日。
              inflationExpectationWithDate: '通胀预期 {value}%（截至 {date}）',
              dailyMixedDates: '两条日频序列观察日不一致，不计算差值',
              dailyCaveat: '官方日频收盘，仅反映交易日收盘水平，不解释盘中波动。',
              // 跨市场判读（设计 142）。文案一律读者语言：剧本名是口语短名，解释是"钱在做什么"，
              // 数字只在"不像"里出现一次，且带上是哪条腿没走成——只给名字的结论读者已经有了。
              reading: {
                title: '怎么读',
                scenarios: {
                  'risk-off': '钱在躲', 'discount-rate': '钱变贵', 'risk-on': '钱在冒险（还留着保险）',
                  'risk-on-recovery': '不怕了', 'crypto-specific': '只有加密在动'
                },
                stories: {
                  'risk-off': '美元和黄金被买，股票和 BTC 一起跌',
                  'discount-rate': '美元涨、黄金跌，股票和 BTC 一起跌',
                  'risk-on': '美元跌，黄金、股票、BTC 一起涨',
                  'risk-on-recovery': '美元跌，黄金被卖，股票和 BTC 一起涨',
                  'crypto-specific': '美元、黄金、股票都没什么变化，BTC 自己在走'
                },
                // 判读句与"不像"：剧本名与腿名都是短名，句子里不再出现第二套标的叫法。
                verdict: '像：{scenario} · {story}',
                refuted: '不像 {scenario}（{leg}{direction}）',
                // 没有剧本匹配时：说清**最接近**的那个剧本，以及是哪条腿没走成——只点名字读起来像半句话，
                // 甚至像自相矛盾（「看不出是哪一种」+「不像 X」）。
                nearestMiss: '最接近的是 {scenario}，但 {leg}没走成',
                // 认不出组合时的兜底描述：不是"我不知道"，而是把四条腿说成人话，读者能拿上表逐格核对。
                noDriverNone: '几条线都在自己的平常波动里，看不出有谁在推',
                noDriverOne: '只有 {direction}，其余几条都在自己的平常波动里',
                noDriverSeveral: '有几条线各自在走（{detail}），但没有组成任何一个剧本',
                // 腿的方向说法自带数值，这样"没变化"不必硬塞一个数进去。
                directions: { up: '涨了 {value}', down: '跌了 {value}', flat: '没变化' },
                legs: { dxy: '美元', gold: '黄金', index: '纳指', btc: 'BTC' },
                correlation: 'ρ {value} · {window}·{interval} · {samples}/{expected}',
                correlationUnavailable: 'ρ 不可用（样本不足），本条没有相关性背书',
                relative: 'BTC−纳指 {btcMinusIndex} · ETH−BTC {ethMinusBtc}',
                undetermined: {
                  'window-not-judged': '该窗口不判读：相关性固定按 24 小时算，切回 24H',
                  'legs-missing': '数据不足，暂不判：{leg}这条腿在该窗口没有数据',
                  stale: '数据不足，暂不判：{leg}的数据已停止更新',
                  'no-match': '看不出是哪一种：几条线没走出能被认出的组合'
                },
                notices: {
                  'index-proxy': '纳指取的是代币化代理', 'dxy-synthetic': '美元为合成指数', 'gold-synthetic': '黄金为合成报价'
                }
              },
              statusReads: { dxy: '美元↑ 对加密逆风', gold: '与 BTC 同跌 = 贴现率驱动', us10y: '名义资金成本（口径待定）', realRate: '与 BTC 关系最直接', index: '风险偏好', btc: '双重属性：风险 + 流动性', eth: '跟随 BTC，弹性更大' },
              btcIndex: 'BTC − 纳斯达克 100 · 1h', ethBtc: 'ETH − BTC · 1h', pp: 'pp', unit: 'USDT', samples: '样本', coverage: '历史覆盖',
              states: { disabled: '未启用', connecting: '连接中', live: '实时', stale: '延迟', limited: '资源受限', unavailable: '不可用', missing: '无数据' },
              liveStateLabels: { disabled: '未启用', connecting: '连接中', live: '实时', stale: '延迟', unavailable: '实时不可用' },
              liveHint: '实时价来自未闭合的价格流，四个窗口仍按已闭合K线计算；观测时间',
              facts: { up: '纳斯达克 100 与 BTC 近 1h 同向上涨', down: '纳斯达克 100 与 BTC 近 1h 同向下跌', diverging: '纳斯达克 100 与 BTC 近 1h 走势分化', mixed: '纳斯达克 100 与 BTC 近 1h 方向不一致或变化较小', unavailable: '数据不足或延迟，暂不判断' },
              relativeFacts: { stronger: 'ETH 近 1h 较 BTC 强', weaker: 'ETH 近 1h 较 BTC 弱', flat: 'ETH 近 1h 与 BTC 持平', unavailable: '数据不足或延迟，暂不判断' }
            },
            sourceConfiguration: {
              title: '配置看板来源', close: '关闭', sourceList: '看板来源', configure: '在数据源中配置', runNow: '立即运行', provider: '提供方', readiness: '就绪状态', back: '返回来源', pending: '待接入', pendingHint: '该数据源尚未接入，暂不可配置。', openFullSettings: '完整设置',
              marketConnection: { funding: '资金费率', market: '跨市场行情', pending: '测试中', passed: '通过', partial: '部分通过', failed: '失败', busy: '正在执行其他请求', limited: '请求受限', unavailable: '不可用', rest: '历史', ws: '实时', assets: { index: 'QQQ', btc: 'BTC', eth: 'ETH' }, visibility: '行情在看板可见时实时更新；采集预设仅控制资金费率。' },
              loading: '正在加载来源设置…', unavailable: '来源设置暂时不可用。', enabled: '启用', disabled: '未启用', collectionPreset: '采集预设', testConnection: '测试连接', saveFailed: '保存失败，请重试。', apiKey: { label: 'API Key', save: '保存 API Key', emptyHint: '输入 API Key 后即可保存。', savedHint: '凭据已保存；输入新的 API Key 可替换。' }, requestBudget: '请求额度：{maxRequests} 次 / {windowSeconds} 秒',
              connection: { succeeded: '连接已验证。', failed: '无法验证连接，请重试。' },
              blsSchedule: {
                action: '同步官方 BLS 日程', pending: '正在同步官方 BLS 日程…', confirmation: '是否同步当前年份的官方 BLS 日程？',
                feedback: {
                  schedule: { updated: '日程已更新', unchanged: '日程已是最新', unavailable: '日程暂不可用' },
                  cpi: { updated: 'CPI 值已更新', current: 'CPI 值已是最新', 'not-required': 'CPI 暂无需补抓', unavailable: 'CPI 值暂不可用' },
                  employment: { updated: '就业值已更新', current: '就业值已是最新', 'not-required': '就业暂无需补抓', unavailable: '就业值暂不可用' }
                }
              },
              schedule: { macro: '每 {hours} 小时在上次完成后运行；启动时补跑一次；可立即运行。', manual: '仅手动；启用不会自动采集。', interval: '每 {minutes} 分钟在上次完成后运行；启用时首次运行。' },
              presets: { manual: '手动', balanced: '均衡', frequent: '高频' },
              marketCalendar: {
                title: '市场日历', description: '由产品定时任务采集；在与官方日程建立关联前，事件标记为未验证。', refresh: '立即刷新', refreshing: '正在刷新市场日历…', succeeded: '市场日历已刷新。', failed: '市场日历刷新失败。',
                feeds: { 'macro-calendar-0xrouter-economic-data': '经济数据', 'macro-calendar-0xrouter-financial-events': '金融事件', 'macro-calendar-0xrouter-central-bank-activities': '央行活动' },
                owner: '市场 · 未验证'
              },
              groups: { 'macro-calendar': '宏观日历', 'macro-regulation': '宏观与监管', 'crypto-market': '加密市场', 'aggregate-data-provider': '聚合数据供应商' },
              sources: {
                'macro-calendar-fed': { name: 'Federal Reserve Board (Fed)', description: '官方 Federal Reserve Board (Fed) 日程', status: '日程设置' },
                'macro-calendar-bea': { name: '美国经济分析局（BEA）', description: '官方美国经济分析局（BEA）日程', status: '日程设置' },
                'macro-calendar-bls': { name: '美国劳工统计局（BLS）', description: '官方 BLS 发布日程', status: '官方日程' },
                'zero-x-router-market-calendar': { name: '0xRouter 市场日历', description: '经济数据、金融事件与央行活动；由产品定时任务采集，事件标记为未验证。', status: '市场日历' },
                'macro-calendar-coinmarketcal': { name: 'CoinMarketCal', description: '事件日历；尚未接入。', status: '待接入' },
                'fred-rates-liquidity': { name: 'FRED 利率与流动性', description: '官方日频收盘：美债 2Y/10Y、10Y 实际利率与 10Y 盈亏平衡通胀；需要 FRED API Key。', status: '来源设置' },
                'fear-greed': { name: 'Alternative.me 恐惧与贪婪', description: '市场风险偏好', status: '来源设置' },
                'btc-funding-rate': { name: 'Binance Futures Positioning', description: 'BTC / ETH 永续资金费率', status: '来源设置' },
                'stablecoin-capital-conditions': { name: 'DeFiLlama 稳定币资金面', description: '已验证的美元稳定币资金面', status: '来源设置' },
                'zero-x-router-aggregate-provider': { name: '0xRouter', description: '聚合数据供应商配置', status: '来源设置' },
                'twelve-data-market': { name: 'Twelve Data', description: '美元（ICE 篮子合成）、黄金、离岸人民币与稳定币溢价；免费额度 8 次/分钟、800 次/天。', status: '来源设置' },
                'realmarketapi-market': { name: 'RealMarketAPI', description: '真实 ICE 美元指数（DXY）；每 5 分钟采集一次，未配置或数据失效时回退到 ICE 篮子合成值。', status: '来源设置' }
              }
            },
            macroReleaseDynamics: {
              title: '宏观发布动态',
              loading: '正在加载宏观发布动态…',
              unavailable: '宏观发布动态暂时不可用。',
              upcoming: '待发布',
              released: '已发布',
              noUpcoming: '暂无待发布官方日程',
              noReleased: '暂无已发布官方值',
              today: '今天',
              inDays: '{days} 天后',
              inDaysHours: '{days} 天 {hours} 小时后',
              lessThanOneHour: '不足 1 小时',
              prior: '前值',
              eventCount: '{count} 项',
              overflowAnnouncement: '还有 {count} 项事件；打开日历查看完整分组',
              calendarAction: '打开日历',
              sourceName: '经济日历',
              sourceStates: { loading: '加载中', available: '日程可用', empty: '暂无官方日程', unavailable: '日程不可用' },
              manageSettings: '管理宏观日历设置'
            },
            fearGreed: {
              title: '恐惧与贪婪',
              loading: '正在加载恐惧与贪婪指数…',
              empty: '暂无已采集的恐惧与贪婪指数。',
              unavailable: '恐惧与贪婪指数暂时不可用。',
              score: '指数得分',
              observedAt: '观测时间',
              sourceName: '恐惧与贪婪指数',
              sourceStates: { loading: '加载中', available: '指数可用', empty: '暂无观测值', unavailable: '指数不可用' },
              manageSettings: '管理恐惧与贪婪设置',
              buckets: { 'extreme-fear': '极度恐惧', fear: '恐惧', neutral: '中性', greed: '贪婪', 'extreme-greed': '极度贪婪' }
            },
            fundingRate: {
              title: '永续资金费率',
              pairTitle: '永续资金费率 · Binance USDT 永续',
              loading: '正在加载永续资金费率…',
              empty: '暂无已采集的永续资金费率观测值。',
              unavailable: '永续资金费率暂时不可用。',
              observedAt: '观测时间',
              sourceName: 'Binance Futures Positioning',
              sourceStates: { loading: '加载中', available: '资金费率可用', empty: '暂无观测值', unavailable: '资金费率不可用' },
              manageSettings: '管理 Binance Futures Positioning 设置',
              assets: { btc: 'BTC', eth: 'ETH' },
              paymentDirections: { 'long-pays-short': '多头付费', 'short-pays-long': '空头付费', neutral: '中性' }
            },
            capitalConditions: {
              title: '资金面', loading: '正在加载资金面…', empty: '暂无已验证的资金面快照。', unavailable: '资金面暂时不可用。',
              stablecoinSupply: '稳定币总供给', change7d: '7D 净变化', btcEtfLatest: 'BTC ETF 最新', ethEtfLatest: 'ETH ETF 最新', observedAt: '观测时间', etfFlow: '市场资金流', etfUnavailable: '市场资金流暂时不可用。', funds: '资金面', btc: 'BTC ETF', eth: 'ETH ETF',
              flowDirections: { inflow: '净流入', outflow: '净流出', zero: '持平' }, singleDay: '1 日', consecutiveDays: '{count} 日连续', valueUnavailable: '—',
              refresh: '重新采集来源', refreshFailed: '重新采集失败，请稍后重试。'
            },
            positioning: { title: '市场情绪', fearGreed: '恐惧与贪婪', observedAt: '观测时间', gaugeMarkers: { fear: '极恐', neutral: '中性', greed: '极贪' } },
            macroMarket: {
              sourceName: '宏观市场（Twelve Data）',
              sourceStates: {
                loading: '加载中', available: '可用', 'awaiting-collection': '等待首次采集',
                disabled: '未启用', 'credential-missing': '未配置 API Key', unavailable: '不可用'
              },
              manageSettings: '管理宏观市场设置'
            },
            // 来源状态 one row per feed. The synthetic/proxy words are filled with the panel's own tags
            // (`crossAsset.syntheticTag`/`proxyTag`), so a row can never label the same reading two ways.
            feedStatus: {
              rowNames: {
                dollar: '美元指数（DXY）',
                gold: '黄金（XAU/USD · Twelve Data）',
                rates: '美债利率（10Y / 实际利率 · FRED 日频）',
                index: '跨资产指数（纳斯达克 100）'
              },
              sourceNames: {
                'realmarketapi-market': 'RealMarketAPI',
                'twelve-data-market': 'Twelve Data',
                'fred-rates-liquidity': 'FRED 日频',
                'binance-futures-positioning': 'Binance 跨资产行情'
              },
              states: {
                loading: '加载中', ok: '采集正常', unconfigured: '未配置', 'configured-disabled': '已配置未启用',
                failed: '采集失败', 'stale-fallback': '数据过期，已回退', proxy: '代理在役',
                'awaiting-collection': '等待首次采集', unavailable: '不可用'
              },
              detail: {
                recent: '最近 {time}',
                asOf: '截至 {date}',
                indexReal: '真实指数 {name}',
                unconfigured: '未配置 {source}，{usage}',
                disabled: '{source} 已配置但未启用，{usage}',
                failed: '{source} 采集失败（{code}），{usage}',
                failedNoCode: '{source} 采集失败，{usage}',
                staleFallback: '真实 DXY 超过 {minutes} 分钟未更新，{usage}',
                staleFallbackNoPoint: '真实 DXY 暂无数据点，{usage}',
                proxyInUse: '{usage} QQQUSDT（非标准指数）',
                awaiting: '已配置，等待首次采集',
                unavailable: '来源状态不可读'
              },
              usage: { synthetic: '当前使用{tag}值', proxy: '当前使用{tag}值', none: '当前无数据' },
              relative: { justNow: '刚刚', minutes: '{count} 分钟前', hours: '{count} 小时前', days: '{count} 天前' },
              // 异常优先：健康的源合并成一行，只有需要留意的源各自占一行，链接文字因此不再重复源名。
              summary: '✓ {count} 源正常（{names}）',
              manage: '管理 ›',
              manageSources: '管理来源 ›'
            },
            context: { sourceStatus: { title: '来源状态' } }
          },
          calendar: {
            unifiedDay: { total: '当日共 {count} 条', grouped: '已按类型分组', groupCount: '{type} · {count} 条', empty: '当日暂无事件', timePending: '待定', more: '还有 {count} 条', loading: '加载中', incomplete: '未完整加载', back: '返回当日列表', storageUnavailable: '存储受限，已有数据保留', coverage: '当前查询：UTC {month}；官方最多 200 条；跨月事件覆盖可能不完整' },
            calendarSettings: '配置日历',
            calendarPanel: { title: '日历源', configure: '在数据源中配置', loading: '正在加载日历源…', unavailable: '当前面板没有可配置的日历源。', pending: '待接入', enabled: '已启用', disabled: '未启用' },
            market: { refreshOutcome: { succeeded: '刷新成功', failed: '刷新失败', unattempted: '本次尚未刷新' }, refreshTrigger: { manual: '手动', automatic: '自动' }, attemptFailure: { 'input-invalid': '请求无效', 'credential-not-configured': '未配置凭据', 'response-unavailable': '来源未响应', 'archive-unavailable': '证据归档不可用', 'parse-unavailable': '解析受限', 'storage-unavailable': '存储不可用', 'storage-pressure': '存储受限' }, collectedAt: '数据采集于', retainedData: '显示上次数据', automaticRefresh: '每 {interval} 分钟自动更新', officialActual: '官方公布值', officialPrevious: '官方前值', sourceAdvanced: '该来源此后已更新；以下数值与时间属于上方那条观测。', linkedTimeOfficial: '日历时间：官方', linkedTimeProvider: '日历时间：0xRouter', linkedTimePending: '日历时间：待定', missingValue: '暂无', importance: { high: '高', medium: '中', low: '低' }, locale: 'zh' as const, refresh: '刷新市场日历', loading: '正在读取市场事件…', pending: '正在刷新市场日历…', completed: '市场日历已更新', partial: '部分来源失败，保留已有数据', unavailable: '刷新未完成，已有数据可能过期', queryUnavailable: '市场事件读取受限', settings: '管理 0xRouter 来源', unknownCountry: '未标明国家', consensus: '市场预期', providerPrevious: '前值（0xRouter）', providerActual: '公布值（0xRouter）', comparison: '暂不可比较', source: '0xRouter', observed: '来源观测时间', time: '发布时间', more: '更多市场事件', kinds: { 'economic-indicator': '经济指标', 'financial-event': '财经事件', 'central-bank-activity': '央行活动' }, statuses: { success: '已采集', 'success-empty': '本次无事件', 'all-skipped': '解析受限', partial: '部分事件可用', unavailable: '尚无可用批次' } },
            eventStatus: { label: '发布进度', 'data-received': '数据已获取', upcoming: '未到发布时间', 'awaiting-data': '待发布', 'storage-limited': '存储受限', 'time-pending': '时间待定', 'elapsed-unconfirmed': '计划时间已过', cancelled: '已取消' },
            workspaceLabel: '— MACRO / ECONOMIC CALENDAR',
            title: '经济日历',
            month: '当前月份',
            monthNavigation: { previous: '上个月', next: '下个月', current: '回到本月', picker: '选择月份' },
            status: { loading: '正在加载经济日历…', empty: '此月份暂无已导入或已采集的官方日程。' },
            emptyState: { title: '尚未导入或采集官方日程', manageAction: '管理宏观日历' },
            failures: { 'calendar-query-unavailable': '经济日历暂时不可用。', 'query-input-invalid': '经济日历查询无效。', 'event-not-found': '未找到该事件详情。' },
            backToDashboard: '返回数字货币看板',
                        weekdays: ['日', '一', '二', '三', '四', '五', '六'],
            importance: { high: '高' },
            states: { scheduled: '待公布', released: '已发布', cancelled: '已取消' },
            categories: { inflation: '通胀', employment: '就业', growth: '增长', 'monetary-policy': '货币政策', consumption: '消费' },
            // 已注册的 9 个指标**引用**分析侧那一份（`registeredEventNames`），不再各写一套措辞；
            // `unknown` 是官方路线里没有注册名字的那些行（`labelKey === 'unknown'`）的兜底词，
            // 它不是任何一个发布的名字，所以留在这里。
            events: { ...registeredEventNames['zh-CN'], unknown: '官方宏观事件' },
            abbreviations: {
              fomc: 'FOMC', cpi: 'CPI', 'core-cpi': 'Core CPI', 'nonfarm-payrolls': '非农', unemployment: '失业率',
              'average-hourly-earnings': '时薪', pce: 'PCE', 'core-pce': 'Core PCE', gdp: 'GDP', unknown: '宏观'
            },
            details: { title: '事件详情', category: '类别', period: '统计周期', source: '来源', time: '发布时间', importance: '重要性', state: '状态', actual: '实际值', previous: '前值', unavailable: '暂无官方值', scheduledDateOnly: '官方未公布具体时间', conventionTime: '惯例默认', editedTime: '已编辑',
              editTime: { label: '发布时间（可编辑）', save: '保存', cancel: '取消', restore: '恢复官方/惯例', saved: '已保存你的时间。', rejected: '保存失败：时间或日期不合法。', ambiguous: '该时刻在本地时区出现两次（夏令时切换），请换一个时间。', hint: '编辑会保存你的日期与时间，并覆盖官方与惯例值。' } },
            sources: { federalReserve: 'Federal Reserve Board (Fed)', bea: '美国经济分析局（BEA）', blsManualIcs: '美国劳工统计局（BLS，手动 ICS）', blsAutomaticSchedule: '美国劳工统计局（BLS，自动年度日程）' },
            sourceMarkers: { federalReserve: 'Fed', bea: 'BEA', blsManualIcs: 'BLS', blsAutomaticSchedule: 'BLS' },
            periods: { officialNotPublished: '官方未提供统计期' },
            caveats: { 'official-value-revised': '已修正', 'official-time-not-published': '官方尚未公布具体发布时间。', 'official-timezone-not-published': '官方尚未公布发布时间所属时区。', 'official-period-not-published-in-ics': 'BLS ICS 未提供统计周期。', 'manual-ics-import': '此 BLS 日程来自手动导入的 ICS 文件。', 'bls-python-schedule': '此 BLS 日程由本机 Python requests 自动同步。' },
            moreEvents: '+{count} 项',
            dayEvents: { title: '{date} 的事件', listLabel: '当天全部事件', close: '关闭', moreAriaLabel: '+{count} 项事件' },
            manualImport: {
              action: '导入 BLS ICS',
              title: '导入 BLS ICS 日程',
              filename: '文件',
              actions: { confirm: '导入到日历', cancel: '取消', close: '关闭' },
              status: { importing: '正在导入本地 ICS 文件…' },
              counts: { totalEvents: 'BLS 日历事件', supportedReleaseGroups: '支持的发布组', generatedEvents: '生成的日历事件', unsupportedEvents: '未支持的事件', insertedCount: '新增日程', rescheduledCount: '改期日程', unchangedCount: '未变化日程' },
              results: { imported: '已将 BLS 日程导入日历。', unchanged: '此 BLS 日程与当前日历一致。' },
              failures: { 'invalid-file': '请选择完整的 BLS ICS 文件。', 'unsupported-calendar': '该 ICS 文件不是受支持的 BLS 发布日历。', 'no-supported-events': '该 BLS ICS 文件没有当前支持的发布日程。', 'persistence-failed': '无法保存此 BLS 日程，请稍后重试。' }
            },
            blsRefresh: {
              action: '刷新 BLS 数据',
              title: '刷新 BLS 发布数据',
              confirmation: '将请求 BLS 官方数据并更新对应完整发布组：CPI 与核心 CPI，或非农、失业率与平均时薪。',
              confirm: '刷新', cancel: '取消', pending: '正在刷新 BLS 数据…',
              updated: '已刷新对应完整 BLS 发布组的数据。', unchanged: '对应完整 BLS 发布组的数据已是最新。', unavailable: '对应完整 BLS 发布组的官方数据暂不可用，未保存任何值。'
            },
            blsScheduleSync: {
              schedule: { updated: 'BLS 日程已更新', unchanged: 'BLS 日程已是最新', unavailable: 'BLS 日程暂不可用' },
              cpi: { updated: 'CPI 值已更新', current: 'CPI 值已是最新', 'not-required': 'CPI 暂无需补抓', unavailable: 'CPI 值暂不可用' },
              employment: { updated: '就业值已更新', current: '就业值已是最新', 'not-required': '就业暂无需补抓', unavailable: '就业值暂不可用' }
            },
            fomcRefresh: {
              publishedAt: '官方公布时间', retained: '刷新失败，显示上次官方值',
              action: '获取官方值',
              confirmation: '将请求 Fed 官方 FOMC 决议并更新此事件的已验证值。',
              pending: '正在获取 Fed 官方值…',
              updated: '已获取 Fed 官方值。', unchanged: 'Fed 官方值已是最新。', unavailable: 'Fed 官方值暂不可用，未保存任何值。'
            }
          },
          drawer: {
            title: '激活数字货币 Agent',
            subtitle: '以下为静态情报源预设，当前不会保存或启动任何采集。',
            tiers: { required: '必需', recommended: '推荐', optional: '可选' },
            sources: {
              'fear-greed': { name: '恐惧与贪婪指数', description: '市场风险偏好与拥挤度。' },
              'spot-momentum': { name: '现货市场动量', description: 'BTC / ETH 现货趋势与成交背景。' },
              'funding-rate': { name: '合约资金费率', description: '衍生品杠杆与拥挤度。' },
              'macro-calendar': { name: '宏观日历（CPI / 非农 / FOMC）', description: '宏观事件窗口与预期重定价风险。' },
              'stablecoin-defi': { name: '稳定币与 DeFi', description: '链上流动性与资金背景。' },
              'regulation-exchange': { name: '监管与交易所', description: '监管、公告与基础设施状态。' },
              'industry-news': { name: '行业新闻', description: '行业叙事与背景线索。' }
            },
            detailTitle: '选中情报源',
            detailFallback: '未选择情报源',
            sourceListTitle: '静态情报源',
            sourceListStatus: '7 / 7 预设',
            sourceDetails: {
              'fear-greed': { scope: '风险偏好 / 市场拥挤度', adapter: 'Metric REST', endpoint: 'Static preview', cadence: '每 10 分钟' },
              'spot-momentum': { scope: 'BTC / ETH 现货趋势', adapter: 'Market feed', endpoint: 'Static preview', cadence: '每 5 分钟' },
              'funding-rate': { scope: '合约杠杆拥挤度', adapter: 'Derivatives feed', endpoint: 'Static preview', cadence: '每 5 分钟' },
              'macro-calendar': { scope: 'CPI / 非农 / FOMC', adapter: 'Calendar feed', endpoint: 'Static preview', cadence: '每日' },
              'stablecoin-defi': { scope: '链上流动性', adapter: 'On-chain feed', endpoint: 'Static preview', cadence: '每小时' },
              'regulation-exchange': { scope: '公告与基础设施状态', adapter: 'Event feed', endpoint: 'Static preview', cadence: '每 15 分钟' },
              'industry-news': { scope: '行业叙事与背景', adapter: 'News feed', endpoint: 'Static preview', cadence: '每小时' }
            },
            detailFields: { scope: '覆盖范围', adapter: '适配器', endpoint: '连接', cadence: '采集节奏', status: '静态预览：不会保存、测试或启动采集。' },
            unverified: '尚未启用',
            activate: '开始预热并激活'
          }
        },
        views: {
          overview: '概览',
          timeline: '时间线',
          sentiment: '情绪'
        },
        filtersPanel: {
          timeRange: '时间范围',
          sourceGroup: '来源分组',
          scope: '关联范围',
          symbol: '标的',
          symbolPlaceholder: 'BTC',
          horizon: '情绪窗口',
          includeBackfill: '显示历史回填',
          layer: '情报层级',
          direction: '影响方向',
          eventFamily: '事件类型',
          sourceReliability: '来源可靠性',
          timeRanges: {
            '24h': '24 小时',
            '7d': '7 天',
            '30d': '30 天'
          },
          sourceGroups: {
            all: '全部来源',
            exchange: '交易所',
            regulator: '监管',
            media: '媒体',
            social: '社交'
          },
          scopes: {
            both: '持仓 + 自选',
            'active-exposure': '仅持仓',
            watchlist: '仅自选',
            all: '全部相关'
          },
          horizons: {
            '15m': '15 分钟',
            '1h': '1 小时',
            '4h': '4 小时',
            '24h': '24 小时'
          },
          layers: {
            all: '全部层级',
            macro: '宏观',
            industry: '行业',
            asset: '资产',
            exchange: '交易所',
            project: '项目',
            infrastructure: '基础设施'
          },
          directions: {
            all: '全部方向',
            bullish: '利多',
            bearish: '利空',
            neutral: '中性',
            mixed: '混合'
          },
          eventFamilies: {
            all: '全部事件',
            'text-event': '文本事件',
            'metric-event': '指标事件',
            mixed: '混合事件'
          },
          reliabilities: {
            all: '全部可靠性',
            official: '官方',
            'exchange-api': '交易所 API',
            aggregator: '聚合器',
            'page-extract': '页面提取',
            community: '社区'
          }
        },
        overview: {
          highImpact: '高影响事件',
          sentimentSummary: '情绪摘要',
          alertChanges: '告警相关变更',
          sourceFreshness: '来源新鲜度',
          empty: '暂无数据',
          columns: {
            title: '事件',
            source: '来源',
            alertStatus: '告警状态'
          }
        },
        console: {
          statusStrip: {
            matchingEvents: '匹配事件',
            effectiveSignals: '有效信号',
            liveSources: '运行中来源',
            needsAttention: '待处理',
            filterSummary: '当前筛选',
            fearGreed: '恐惧贪婪',
            fearGreedNotCollected: '未采集',
            emptyHint: {
              'no-sources-enabled': '尚未启用任何可运行情报源。请打开情报源设置并启用采集。',
              'enabled-never-run': '来源已启用但尚未完成首次采集。请立即运行或等待调度。',
              'source-failed': '最近采集失败。请打开运行状态查看失败来源。',
              'filters-too-narrow': '当前筛选条件过窄，已隐藏可用事件。请清除筛选。',
              'no-sentiment-signal': '已有事件但未形成可计算情绪信号。请查看时间线或检查影响规则。',
              'no-recent-events': '当前时间范围内没有匹配事件。'
            },
            filterTokens: {
              timeRange: { '24h': '24小时', '7d': '7天', '30d': '30天', all: '全部时间' },
              sourceGroup: {
                all: '全部来源',
                exchange: '交易所',
                regulator: '监管',
                media: '媒体',
                social: '社交'
              },
              scope: { all: '全部相关', both: '持仓+自选', 'active-exposure': '仅持仓', watchlist: '仅自选' },
              layer: {
                all: '全部层级',
                macro: '宏观',
                industry: '行业',
                asset: '资产',
                exchange: '交易所',
                project: '项目',
                infrastructure: '基础设施'
              },
              direction: { all: '全部方向', bullish: '利多', bearish: '利空', neutral: '中性', mixed: '混合' },
              horizon: { '15m': '15分钟', '1h': '1小时', '4h': '4小时', '24h': '24小时' },
              symbol: {},
              eventFamily: { 'text-event': '文本事件', 'metric-event': '指标事件', mixed: '混合事件' },
              sourceReliability: {
                official: '官方',
                'exchange-api': '交易所 API',
                aggregator: '聚合器',
                'page-extract': '页面提取',
                community: '社区'
              }
            }
          },
          layerDesk: {
            title: '三层情报台',
            collectionState: '采集状态',
            latestEvent: '最新事件',
            noRecentEvent: '暂无近期事件',
            lastSuccess: '上次成功',
            readiness: '覆盖情况',
            readinessCounts: { live: '已上线', fixtureReady: 'Fixture', planned: '待实现' },
            plannedCoverage: '待实现覆盖',
            fixtureCoverage: 'Fixture 覆盖',
            fearGreedTitle: '恐惧贪婪指数',
            fearGreedNotCollected: '未采集',
            collectionStates: {
              healthy: '健康',
              degraded: '降级',
              failed: '失败',
              pending: '待采集',
              paused: '已暂停',
              'none-enabled': '未启用'
            },
            readinessLabels: {
              live: '已上线',
              'fixture-ready': 'Fixture',
              planned: '待实现'
            }
          },
          recentEvents: {
            title: '近期有效事件',
            empty: '当前没有可展示事件。',
            columns: {
              event: '事件',
              layer: '层级',
              direction: '方向',
              source: '来源',
              time: '时间'
            }
          },
          sourceCoverage: {
            title: '来源覆盖',
            v2Required: 'V2',
            columns: {
              source: '来源',
              layer: '层级',
              state: '状态',
              items: '事件',
              impacts: '影响'
            },
            productionStates: {
              fresh: '新鲜',
              stale: '过期',
              pending: '待采集',
              failed: '失败',
              disabled: '未启用',
              'fixture-only': 'Fixture',
              planned: '待实现'
            },
            readinessLabels: {
              live: '已上线',
              'fixture-ready': 'Fixture',
              planned: '待实现'
            }
          },
          fearGreedBuckets: {
            'extreme-fear': '极度恐惧',
            fear: '恐惧',
            neutral: '中性',
            greed: '贪婪',
            'extreme-greed': '极度贪婪'
          },
          fearGreedInterpretation: {
            'extreme-fear': '风险偏好偏弱，可能意味着抛压，但不是自动做多信号。',
            fear: '市场偏防御，风险资产需要更强催化剂。',
            neutral: '该指数未给出明显拥挤信号。',
            greed: '风险偏好抬升，需关注拥挤与杠杆。',
            'extreme-greed': '拥挤风险偏高，应视为混合或回调风险输入。'
          },
          attentionKinds: {
            'source-failed': '来源采集失败',
            'source-pending': '来源待首次采集',
            'credential-missing': '缺少 API 凭证',
            'planned-source-visible': '待实现来源（仅路线图）',
            'fixture-ready-source-visible': 'Fixture 来源（非生产数据）'
          },
          filterTokens: {
            timeRange: { '24h': '24小时', '7d': '7天', '30d': '30天', all: '全部时间' },
            sourceGroup: {
              all: '全部来源',
              exchange: '交易所',
              regulator: '监管',
              media: '媒体',
              social: '社交'
            },
            scope: { all: '全部相关', both: '持仓+自选', 'active-exposure': '仅持仓', watchlist: '仅自选' },
            layer: {
              all: '全部层级',
              macro: '宏观',
              industry: '行业',
              asset: '资产',
              exchange: '交易所',
              project: '项目',
              infrastructure: '基础设施'
            },
            direction: { all: '全部方向', bullish: '利多', bearish: '利空', neutral: '中性', mixed: '混合' },
            horizon: { '15m': '15分钟', '1h': '1小时', '4h': '4小时', '24h': '24小时' },
            symbol: {},
            eventFamily: { 'text-event': '文本事件', 'metric-event': '指标事件', mixed: '混合事件' },
            sourceReliability: {
              official: '官方',
              'exchange-api': '交易所 API',
              aggregator: '聚合器',
              'page-extract': '页面提取',
              community: '社区'
            }
          }
        },
        detailContext: {
          contextTitle: '工作台上下文',
          filterSummary: '当前筛选',
          matchingEvents: '匹配事件',
          effectiveSignals: '有效信号',
          latestSuccess: '最近成功采集',
          needsAttention: '待处理项',
          plannedCoverage: '待实现能力',
          fearGreed: '恐惧贪婪指数',
          fearGreedScore: '指数分数',
          fearGreedClassification: '分类',
          fearGreedUpdatedAt: '更新时间',
          fearGreedSource: '来源',
          fearGreedReadiness: '实现状态',
          fearGreedCollectionState: '采集状态',
          fearGreedNotCollected: '未采集',
          fearGreedIncludedInAggregate: '纳入聚合',
          fearGreedIncluded: '已纳入',
          fearGreedExcluded: '未纳入',
          fearGreedStateLabels: {
            live: '已采集',
            pending: '采集待完成',
            failed: '采集失败',
            'not-collected': '未采集'
          },
          fearGreedReadinessLabels: {
            live: '可采集',
            'fixture-ready': 'Fixture 可验证',
            planned: '待实现'
          },
          actions: {
            clearFilters: '清除筛选',
            openRuntime: '运行状态',
            openTimeline: '打开时间线',
            openSettings: '情报源设置'
          }
        },
        timelineView: {
          empty: '暂无时间线事件。',
          retryAssessment: '重试',
          columns: {
            event: '事件',
            source: '来源',
            eventType: '类型',
            publishedAt: '发布时间',
            detectedAt: '检测时间',
            symbols: '标的',
            assessmentStatus: '评估状态',
            alertStatus: '告警状态',
            layer: '层级',
            direction: '方向',
            confidence: '置信度',
            impactScope: '影响范围',
            revision: '有更新',
            noSymbols: '全市场'
          }
        },
        sentimentView: {
          empty: '暂无情绪聚合。',
          columns: {
            scope: '范围',
            horizon: '窗口',
            score: '分数',
            label: '标签',
            signals: '信号数',
            layerBreakdown: '层级贡献'
          }
        },
        detailPanel: {
          empty: '选择一行以查看详情。',
          sources: '来源',
          latestRevision: '最新修订',
          latestAssessment: '最新评估',
          rawEvidence: '原始证据',
          sentimentScope: '情绪范围',
          sentimentScore: '情绪分数',
          supportingEvents: '支撑事件',
          translationStatus: '翻译状态',
          translatedAt: '翻译时间',
          retryTranslation: '重试翻译',
          impacts: '影响评估',
          metricEvent: '指标事件',
          transmissionLogic: '传导逻辑',
          evidence: '证据',
          forecastMissing: '缺少预测值，已使用前值对比',
          forecast: '预测',
          previous: '前值',
          surprise: '意外方向',
          confidence: '置信度',
          magnitude: '幅度',
          expected: '预期',
          clusters: '聚类',
          items: '条目',
          supportingEvidence: '支撑证据',
          impactRules: '影响规则',
          omittedSupportingItems: '另有 {count} 条未展示'
        },
        translation: {
          translated: '译文',
          original: '原文',
          statuses: {
            translated: '已翻译',
            pending: '待翻译',
            failed: '翻译失败',
            stale: '已过期',
            'not-required': '无需翻译'
          }
        },
        operations: {
          open: '运行状态',
          title: '采集运行状态',
          close: '关闭',
          empty: '暂无来源运行数据。',
          lastSuccess: '上次成功',
          lastFailure: '上次失败',
          failures: '连续失败',
          runtimeStatuses: {
            healthy: '健康',
            degraded: '降级',
            failed: '失败',
            paused: '已暂停',
            pending: '待采集'
          }
        },
        display: {
          eventTypes: {
            news: '新闻',
            announcement: '公告',
            incident: '事故',
            maintenance: '维护',
            regulation: '监管',
            macro: '宏观',
            'exchange-status': '交易所状态',
            'system-status': '系统状态',
            'exchange-announcement': '交易所公告',
            blog: '博客'
          },
          aggregateLabels: {
            positive: '偏多',
            negative: '偏空',
            neutral: '中性',
            mixed: '混合'
          },
          scopeTypes: {
            'market-wide': '全市场',
            'risk-assets': '风险资产',
            'crypto-market': '加密市场',
            sector: '板块',
            symbol: '标的',
            watchlist: '自选',
            'active-position': '持仓',
            exchange: '交易所'
          },
          layers: {
            macro: '宏观',
            industry: '行业',
            asset: '资产',
            exchange: '交易所',
            project: '项目',
            infrastructure: '基础设施'
          },
          directions: {
            bullish: '利多',
            bearish: '利空',
            neutral: '中性',
            mixed: '混合'
          },
          reliabilities: {
            official: '官方',
            'exchange-api': '交易所 API',
            aggregator: '聚合器',
            'page-extract': '页面提取',
            community: '社区'
          },
          eventFamilies: {
            'text-event': '文本',
            'metric-event': '指标',
            mixed: '混合'
          }
        },
        filters: {
          both: '持仓 + 自选',
          'active-exposure': '仅持仓',
          watchlist: '仅自选',
          all: '全部相关'
        },
        columns: {
          time: '时间',
          title: '事件',
          relevance: '关联',
          alertStatus: '告警状态'
        },
        enums: {
          relevance: {
            'active-futures-position': '合约持仓',
            'active-spot-exposure': '现货敞口',
            watchlist: '自选',
            'position-and-watchlist': '持仓 + 自选',
            'market-wide-critical': '全市场重大',
            'related-sector': '相关板块',
            irrelevant: '无关'
          },
          alertStatus: {
            none: '未评估',
            suppressed: '已抑制',
            'timeline-only': '仅时间线',
            notify: '已通知'
          },
          assessmentStatus: {
            pending: '未评估',
            queued: '评估排队中',
            evaluating: '评估中',
            evaluated: '已评估',
            failed: '评估失败',
            'model-not-ready': '模型未就绪'
          }
        },
        sourceHealth: {
          collectionGap: '存在采集缺口',
          supportsHistoricalBackfill: '支持历史补采'
        }
      }
    },
    settings: {
      macroCalendar: {
        title: '宏观日历',
        description: '启用后采集固定的官方日程。',
        loading: '加载中…',
        unavailable: '设置暂不可用，请重试。',
        runNow: '立即运行', testConnection: '测试连接', testingConnection: '正在测试…', connection: { succeeded: '连接已验证。', failed: '无法验证连接，请重试。' },
        schedule: { macro: '每 {hours} 小时在上次完成后运行；启动时补跑一次；可立即运行。' },
        runNowFeedback: { queued: '运行请求已排队，尚未确认采集完成。', skipped: '本次运行未排队，请确认提供方已启用后重试。', failed: '无法提交运行请求，请重试。', 'completed-succeeded': '采集已完成，可打开日历查看刷新后的日程。', 'completed-failed': '采集未成功完成，请查看提供方健康状态后稍后重试。' },
        failureCount: '连续失败',
        lastCompletedAt: '最近完成',
        providers: { 'macro-calendar-fed': 'Federal Reserve Board (Fed)', 'macro-calendar-bea': '美国经济分析局（BEA）' },
        blsCard: { title: '美国劳工统计局（BLS）', description: '官方发布日程与就业数据同步。', status: '官方采集' },
        blsSchedule: {
          action: '同步官方 BLS 日程', pending: '正在同步官方 BLS 日程…',
          feedback: {
            schedule: { updated: '日程已更新', unchanged: '日程已是最新', unavailable: '日程暂不可用' },
            cpi: { updated: 'CPI 值已更新', current: 'CPI 值已是最新', 'not-required': 'CPI 暂无需补抓', unavailable: 'CPI 值暂不可用' },
            employment: { updated: '就业值已更新', current: '就业值已是最新', 'not-required': '就业暂无需补抓', unavailable: '就业值暂不可用' }
          }
        },
        pendingFeeds: { title: '待接入', hint: '尚未接入，不可配置。', coinMarketCal: 'CoinMarketCal' },
        marketCalendar: {
          title: '市场日历', description: '由产品定时任务采集；在与官方日程建立关联前，事件标记为未验证。', refresh: '立即刷新', refreshing: '正在刷新市场日历…', succeeded: '市场日历已刷新。', failed: '市场日历刷新失败。', owner: '市场 · 未验证',
          feeds: { 'macro-calendar-0xrouter-economic-data': '经济数据', 'macro-calendar-0xrouter-financial-events': '金融事件', 'macro-calendar-0xrouter-central-bank-activities': '央行活动' }
        },
        health: { 'never-run': '尚未运行', healthy: '正常', degraded: '需关注', failed: '失败' }
      },
      intelligenceSources: {
        sourceCategories: { macro: '宏观', crypto: '加密市场', aggregate: '聚合数据供应商', system: '系统与状态' },
        sourceNames: {
          'macro-calendar-fed': '美联储官方日程', 'federal-reserve-rss': '美联储新闻稿',
          'macro-calendar-bea': 'BEA 官方发布', 'bea-economic-series': 'BEA 经济数据',
          'macro-calendar-bls': 'BLS 官方日程', 'bls-economic-series': 'BLS 经济数据',
          'fred-rates-liquidity': '美债利率与流动性', fred: 'FRED（已弃用）',
          'treasury-fiscal-data': '财政部财政数据', 'sec-rss': 'SEC 监管公告', 'cftc-rss': 'CFTC 监管公告',
          'binance-announcements': '币安公告', 'binance-api-updates': '币安 API 更新',
          'binance-spot-market': '币安现货行情', 'binance-futures-positioning': '币安合约持仓',
          'binance-asset-page': '币安资产页', 'okx-latest-announcements': 'OKX 最新公告',
          'okx-api-announcements': 'OKX API 公告', 'coingecko-market': 'CoinGecko 行情',
          'defillama-stablecoins': 'DeFiLlama 稳定币', 'defillama-tvl': 'DeFiLlama TVL',
          'alternative-fear-greed': '恐惧与贪婪指数', 'coindesk-rss': 'CoinDesk 新闻',
          'ethereum-foundation-blog': '以太坊基金会博客', cryptopanic: 'CryptoPanic 新闻',
          coinmarketcal: 'CoinMarketCal 新闻（旧）', 'macro-calendar-coinmarketcal': 'CoinMarketCal 事件日历',
          '0xrouter-aggregate-provider': '0xRouter 聚合行情',
          'macro-calendar-0xrouter-economic-data': '0xRouter 经济数据',
          'macro-calendar-0xrouter-financial-events': '0xRouter 财经事件',
          'macro-calendar-0xrouter-central-bank-activities': '0xRouter 央行活动',
          'realmarketapi-market': 'RealMarketAPI 美元指数', 'twelve-data-market': 'Twelve Data 宏观行情',
          'coinbase-status': 'Coinbase 运行状态', 'kraken-status': 'Kraken 运行状态',
          'kraken-system-status': 'Kraken 系统状态', 'solana-status': 'Solana 运行状态',
          'github-releases': 'GitHub 版本发布'
        },
        providerNames: {
          fed: '美联储', bea: '美国经济分析局', bls: '美国劳工统计局', fred: 'FRED',
          treasury: '美国财政部', sec: '美国证监会', cftc: '美国商品期货交易委员会',
          binance: '币安', okx: 'OKX', coingecko: 'CoinGecko', defillama: 'DeFiLlama',
          'alternative-me': 'Alternative.me', coindesk: 'CoinDesk', 'ethereum-foundation': '以太坊基金会',
          cryptopanic: 'CryptoPanic', coinmarketcal: 'CoinMarketCal', '0xrouter': '0xRouter',
          realmarketapi: 'RealMarketAPI', 'twelve-data': 'Twelve Data', coinbase: 'Coinbase',
          kraken: 'Kraken', solana: 'Solana', github: 'GitHub'
        },
        readinessLabels: { live: '可用', 'fixture-ready': '测试数据', planned: '未接入' },

        sourceFilters: { all: '全部', calendar: '日历', dashboard: '看板', pending: '待接入', advanced: '高级' },
        sourceBadges: { pending: '待接入', advanced: '高级', agent: '解读员', panel: '面板', calendar: '日历', proxy: '需要代理' },
        proxyNotice: {
          title: '需要可用的本地代理（VPN）',
          body: '这个来源的服务器会拦截来自大陆网络的请求，所以「测试连接」和「刷新市场日历」在没走代理时会一直失败（与 API Key 是否正确无关）。请先打开能访问境外网络的 VPN 或本地代理（也就是常说的翻墙），再到「设置 → 基础设置 → 代理模式」选择「自定义代理」并填入同一个本地地址（例如 http://127.0.0.1:7888），保存后回来重试。浏览器能打开不代表应用能连——应用请求只走这里的代理。',
          action: '去设置代理'
        },
        agentNames: { crypto: '数字货币', stocks: '股票', futures: '期货' },
        panelNames: { dashboard: '看板', 'economic-calendar': '日历' },
        providerSummary: '{total} 项能力 · 已启用 {enabled}',
        credentialsRequired: '需要 API Key',
        website: '官网',
        signup: '注册 / 获取 Key',
        inviteNote: '如果这个源帮到你，欢迎用我的邀请链接注册，就当请作者吃根雪糕 🍦',
        testConnection: '测试连接',
        jobRegistered: '已注册自动任务',
        jobNotRegistered: '未注册自动任务',
        connectionSucceeded: '连接已验证。',
        connectionFailed: '无法验证连接，请重试。',
        connectionUnsupported: '该来源由本地同步任务采集，不支持连接测试。',
        apiKey: { label: 'API Key', save: '保存并验证', emptyHint: '输入 API Key 后保存。', savedHint: '已保存；输入新的 Key 可替换。', revealFailed: '无法读取完整 Key，请重启应用后重试。' },
        calendarSources: {
          title: '宏观日历', official: '官方采集', market: '市场日历', pending: '待接入', hint: '在宏观日历中管理',
          feeds: {
            'macro-calendar-fed': 'Federal Reserve Board (Fed)',
            'macro-calendar-bea': '美国经济分析局（BEA）',
            'macro-calendar-bls': '美国劳工统计局（BLS）',
            'macro-calendar-0xrouter-economic-data': '0xRouter 市场日历',
            'macro-calendar-coinmarketcal': 'CoinMarketCal'
          }
        },
        title: '情报源',
        loading: '加载中…',
        saving: '保存中…',
        saved: '已保存',
        disabledSaved: '已停用',
        enabledManualHint: '已启用。手动模式不会自动采集，请点击「立即运行」。',
        enabledAutoCollectQueued: '已启用，首次采集已自动排队。',
        loadFailed: '加载失败，请重试。',
        saveFailed: '保存失败，请重试。',
        runFailed: '立即运行失败，请重试。',
        runQueued: '采集任务已提交，正在等待结果…',
        runSucceeded: '采集成功。',
        testFailed: '凭证测试失败，请重试。',
        replayFailed: '重放请求失败，请重试。',
        focusMarkets: {
          title: '默认覆盖范围',
          description: '每个信息源都有内置覆盖范围，系统会按默认规则工作。通常无需调整；只有需要强行改变采集覆盖时再自定义。',
          defaultSummary: '当前来源',
          customize: '高级自定义',
          customizeDone: '完成',
          saving: '保存中…',
          plannedHint: '待实现',
          markets: {
            'global-macro': '全球宏观',
            'digital-assets': '数字资产',
            'cn-a-shares': 'A 股',
            'us-equities': '美股',
            'china-futures': '国内期货',
            fx: '外汇',
            commodities: '大宗商品'
          }
        },
        focusGroups: {
          globalMacro: '宏观与监管',
          digitalAssets: '加密市场',
          aggregateProviders: '聚合数据供应商',
          multiMarketDynamic: '多市场 / 动态识别',
          plannedMarkets: '规划中市场',
          pending: '待接入',
          macroCalendar: '宏观日历'
        },
        groups: {
          'exchange-announcement': '交易所公告',
          'exchange-status': '交易所与基础设施状态',
          'official-source': '官方来源',
          'mainstream-news': '主流新闻',
          'macro-regulation': '宏观与监管'
        },
        layers: {
          macro: '宏观情报',
          industry: '行业情报',
          asset: '资产微观',
          exchange: '交易所',
          project: '项目',
          infrastructure: '基础设施'
        },
        readiness: {
          title: '实现状态',
          layer: '情报层级',
          status: '采集状态',
          plannedHint: '该来源尚未接入采集适配器，启用后也无法立即运行；下方说明列出了待实现项。',
          fixtureReadyHint: '该来源仅支持 fixture 重放验证，不能启用生产采集、定时任务或立即运行。',
          statuses: {
            live: '可采集',
            'fixture-ready': 'Fixture 可验证',
            planned: '待实现'
          }
        },
        sources: {
          'binance-announcements': 'Binance 公告',
          'binance-api-updates': 'Binance API 更新',
          'binance-spot-market': 'Binance 现货行情',
          'binance-futures-positioning': 'Binance 合约持仓',
          'binance-asset-page': 'Binance 资产页',
          'okx-latest-announcements': 'OKX 最新公告',
          'okx-api-announcements': 'OKX API 公告',
          'coindesk-rss': 'CoinDesk RSS',
          cryptopanic: 'CryptoPanic',
          coinmarketcal: 'CoinMarketCal',
          'coingecko-market': 'CoinGecko 市场',
          'ethereum-foundation-blog': 'Ethereum Foundation 博客',
          'github-releases': 'GitHub Releases',
          'sec-rss': 'SEC RSS',
          'cftc-rss': 'CFTC RSS',
          'federal-reserve-rss': 'Federal Reserve RSS',
          'bls-economic-series': 'BLS 宏观指标',
          'bea-economic-series': 'BEA 宏观指标',
          'fred-rates-liquidity': 'FRED 利率与流动性',
          'realmarketapi-market': 'RealMarketAPI',
          'treasury-fiscal-data': '美国财政部数据',
          fred: 'FRED',
          'alternative-fear-greed': '恐惧贪婪指数',
          'defillama-stablecoins': 'DeFiLlama 稳定币',
          'defillama-tvl': 'DeFiLlama TVL',
          'kraken-system-status': 'Kraken SystemStatus',
          'coinbase-status': 'Coinbase Status',
          'kraken-status': 'Kraken Status',
          'solana-status': 'Solana Status'
        },
        adapters: {
          'html-page-poller': 'HTML 页面轮询',
          'rss-poller': 'RSS 轮询',
          'rest-api-poller': 'REST API 轮询',
          'statuspage-poller': 'Statuspage 轮询',
          'websocket-stream-consumer': 'WebSocket 流消费'
        },
        status: {
          enabled: '已启用',
          disabled: '未启用'
        },
        executionModes: {
          polling: '轮询',
          websocket: 'WebSocket'
        },
        header: {
          runNow: '立即运行',
          refreshHealth: '刷新健康状态',
          replay: '重放窗口',
          adapter: '适配器',
          executionMode: '执行模式'
        },
        collectionPolicy: {
          title: '采集策略',
          enabled: '启用',
          collectionPreset: '采集预设',
          manualPresetNote: '手动模式启用后不会自动采集，需点击「立即运行」。',
          plannedNotConfigurable: '该来源尚未实现，暂不可启用或配置采集策略。',
          productOwnedNote: '该来源由产品自己的采集作业负责，启用状态由这里控制；采集预设与范围策略不适用于它。',
          includeInSentiment: '纳入情绪分析',
          scopePolicy: '范围策略',
          presets: {
            manual: '手动',
            balanced: '均衡',
            frequent: '高频'
          },
          scopePolicies: {
            all: '全部',
            'watchlist-priority': '自选优先',
            'active-position-priority': '持仓优先'
          }
        },
        credentials: {
          title: '访问凭证',
          credentialRef: '凭证引用',
          testCredentials: '保存并验证连接',
          saveApiKey: '保存 API Key',
          requestBudget: '请求额度：{maxRequests} 次 / {windowSeconds} 秒',
          placeholder: '输入 API Key'
        },
        beaUserIdGuide: {
          title: 'BEA UserID',
          action: '获取 UserID',
          modalTitle: '获取 BEA UserID',
          steps: {
            required: 'BEA UserID 免费，PCE 与 GDP 实际值采集需要该 UserID。',
            register: '点击下方按钮打开 BEA 官方注册页面。',
            keep: '完成注册后，请保留获发的 UserID。'
          },
          configureInMacroCalendar: '注册后，请在“设置 > 宏观日历”中配置 UserID。',
          openRegistration: '打开 BEA 注册页面'
        },
        sourceSpecific: {
          title: '来源专属选项',
          empty: '当前来源没有额外可见字段。'
        },
        retentionReplay: {
          title: '保留与重放',
          rawArchiveEnabled: '启用原始归档',
          retentionMode: '保留模式',
          autoReplayAfterParserUpgrade: '解析器升级后自动重放',
          retentionModes: {
            compact: '紧凑',
            balanced: '均衡',
            extended: '扩展'
          }
        },
        health: {
          title: '来源健康',
          runtimeStatus: '运行状态',
          lastSuccessAt: '最近成功',
          lastFailureAt: '最近失败',
          consecutiveFailures: '连续失败',
          lastRunSummary: '最近运行摘要',
          empty: '暂无',
          statuses: {
            healthy: '健康',
            degraded: '降级',
            failed: '失败',
            paused: '已暂停'
          }
        },
        actions: {
          save: '保存'
        },
        collectionHint: {
          title: '需要手动采集',
          body: '当前为手动模式：启用后不会自动拉取数据。点击「立即运行」后，情报页才会出现内容。',
          action: '立即运行'
        },
        translationPreferences: {
          title: '翻译偏好',
          autoTranslateEnabled: '自动翻译',
          targetLocale: '目标语言',
          translationModel: '翻译模型',
          translateTitle: '翻译标题',
          translateSummary: '翻译摘要',
          translateEvidenceExcerpt: '翻译证据摘录',
          translateBody: '翻译正文',
          queueMissing: '翻译当前筛选结果',
          saving: '保存中…',
          saved: '已保存',
          saveFailed: '保存失败，请重试。',
          queueFailed: '翻译任务提交失败，请重试。',
          queueQueued: '翻译任务已提交。',
          followModelServiceDefault: '跟随模型服务默认',
          defaultModelNotConfigured: '未设置默认翻译模型',
          defaultModelUnavailable: '默认翻译模型当前不可用',
          moduleStatus: '翻译任务',
          pendingCount: '待处理',
          failedCount: '失败',
          translatedCount: '已翻译',
          lastJobAt: '最近任务',
          targetLocales: {
            'follow-app': '跟随应用语言',
            'zh-CN': '简体中文',
            'en-US': 'English'
          }
        }
      }
    }
  },
  'en-US': {
    pages: {
      intelligence: {
        title: 'Intelligence',
        subtitle: 'Intelligence control desk: collection status, layered coverage, and next actions',
        loading: 'Loading…',
        loadFailed: 'Load failed. Try again.',
        evaluateAlerts: 'Evaluate Recent Event Alerts',
        evaluatingAlerts: 'Evaluating…',
        empty: 'No relevant events yet. They will appear here once source collection is connected.',
        portal: {
          moduleLabel: 'MARKET INTELLIGENCE / AGENTS',
          agents: {
            crypto: { name: 'Crypto Market Analyst', lens: 'CRYPTO MARKET LENS', sourceSummary: '7 static intelligence sources' },
            stocks: { name: 'Equities Market Analyst', lens: 'EQUITIES MARKET LENS', sourceSummary: 'Sources pending' },
            futures: { name: 'Futures Market Analyst', lens: 'FUTURES MARKET LENS', sourceSummary: 'Sources pending' }
          },
          states: { available: 'Configure activation', comingSoon: 'Coming soon' },
          sourceSummary: { count: '{count} static sources', pending: 'Sources pending' },
          actions: { activate: 'Configure and activate', openDashboard: 'Open dashboard', unavailable: '—' },
          analysisWorkspace: {
            openAgent: 'Full Agent panel', stop: 'Stop', approvalRequired: 'Waiting for tool approval. Open the full Agent panel to review, or stop this run.',
            title: 'Crypto analysis Agent', chat: 'Analysis conversation', dashboard: 'Market dashboard', view: 'Switch workspace', selectedAnalysis: 'Selected analysis is bound', selectedEvent: 'Selected event', contextAnalysis: 'Quoted analysis',
            newConversation: 'Market analysis conversation', newChatAction: 'New chat', sessionHistory: 'History', deleteSession: 'Delete chat', deleteSessionConfirm: 'Delete this conversation?', cancel: 'Cancel', noSessions: 'No conversations yet', loading: 'Loading Agent…', noSelection: 'Current market · Select a timeline entry to follow up', clearSelection: 'Current market',
            empty: 'Ask the analyst a question or select an analysis below.', input: 'Your question', placeholder: 'What market changes would you like to understand?', followUpPlaceholder: 'Ask about the selected analysis…',
            send: 'Send', sending: 'Analyzing', resize: 'Resize calendar and sentiment', failed: 'Send did not complete. Check the conversation and model configuration before retrying.', modelRequired: 'Select an available model for the crypto analyst in the shared Agent settings.',
            roles: { user: 'You', assistant: 'Market analyst', system: 'System' }, messageStates: { pending: 'Processing', error: 'Run failed', paused: 'Paused' },
            closeDetail: 'Close details', detailUnavailable: 'Details for this entry are unavailable.', readTrace: 'Last read', conclusionBlocks: { change: 'What changed', 'causal-chain': 'Causal chain', condition: 'Conditions', macro: 'Macro', evidence: 'Evidence strength', 'data-gap': 'Data gaps' }, changeFacts: 'Fields that changed', changeStructural: 'Structural changes', changeDomainAdded: 'Missing domains added', changeDomainRemoved: 'Missing domains resolved', changeCaveatAdded: 'Data caveats added', changeCaveatRemoved: 'Data caveats cleared', changeEvidenceAdded: 'Evidence added', changeEvidenceRemoved: 'Evidence removed', changeObservationsAdded: 'Observations added', changeObservationsRemoved: 'Left the window',
            changeSummary: 'What changed', noChange: 'No new change since the previous snapshot.', latestConclusion: 'Latest AI conclusion', latestConclusionHint: 'Select a timeline entry below to read that entry in full on the left; the current binding is unchanged.', latestConclusionEmpty: 'No published AI conclusion yet. Start the first analysis from the timeline below.', latestConclusionLoading: 'Reading the latest AI conclusion…', latestConclusionUnavailable: 'The latest conclusion is unavailable. Try again later.', openDetail: 'Read in full',
            conclusionDirection: { label: 'Direction', bullish: 'Bullish', bearish: 'Bearish', range: 'Range-bound', undecided: 'No call yet', mixed: 'Conflicting signals' },
            directions: { title: 'Operation direction', horizons: { short: 'Short term (0-24h)', medium: 'Medium term (1-7d)', long: 'Long term (1-4w)' }, unknownHorizon: 'Other horizon', confidence: { label: 'Confidence', low: 'low', medium: 'medium', high: 'high' } },
            /**
             * Reader-facing names for the analysis identifiers. The model prompt keeps its own
             * Chinese vocabulary (the main process must not import renderer code);
             * analysisModelVocabulary.test.ts compares both so they cannot drift apart.
             */
            readableNames: {
              domain: { macro: 'Macro', capital: 'Capital', sentiment: 'Sentiment', funding: 'Funding', 'cross-asset': 'Cross-asset' },
              metric: {
                'current-usd': 'Current', 'change-1d-usd': '1 day change', 'change-7d-usd': '7 day change', 'change-30d-usd': '30 day change',
                'etf-net-flow-usd': 'ETF net flow', 'funding-rate-percent': 'Funding rate', 'fear-greed-index': 'Fear & Greed',
                'price-return-15m': '15-minute price return', 'price-return-2h': '2-hour price return',
                'price-return-24h': '24-hour price return', 'price-return-3d': '3-day price return',
                'relative-return-2h': '2-hour relative return (BTC vs ETH)', 'cpi-12-month-percent': 'CPI 12-month rate', score: 'Score',
                'dollar-index-level': 'Dollar index', 'dollar-index-return-15m': 'Dollar index 15-minute change',
                'dollar-index-return-1h': 'Dollar index 1-hour change', 'dollar-index-return-4h': 'Dollar index 4-hour change',
                'dollar-index-return-24h': 'Dollar index 24-hour change', 'gold-price-usd-oz': 'Gold price',
                'us-10y-yield': 'US 10-year yield', 'us-10y-yield-change-1d': 'US 10-year 1-day change',
                'us-10y-real-yield': 'US 10-year real yield', 'us-10y-real-yield-change-1d': 'US 10-year real yield 1-day change',
                'us-2y-yield': 'US 2-year yield', 'us-2y-yield-change-1d': 'US 2-year 1-day change',
                'us-10y-breakeven-inflation': 'US 10-year breakeven inflation', 'us-10y-2y-term-spread': '10Y-2Y term spread',
                'event-name': 'Event', 'lifecycle-state': 'Lifecycle', 'scheduled-date': 'Scheduled date', 'scheduled-at': 'Scheduled time',
                'official-release-date': 'Official release date', actual: 'Actual', previous: 'Previous', consensus: 'Consensus', 'event-excerpt': 'Event excerpt'
              },
              subject: {
                stablecoins: 'Stablecoins', BTC: 'BTC', ETH: 'ETH', market: 'Market', all: 'All', 'btc-vs-eth': 'BTC vs ETH',
                'consumer-price-index': 'Consumer price index', 'employment-situation': 'Employment situation', fomc: 'FOMC',
                pce: 'PCE', 'core-pce': 'Core PCE', gdp: 'GDP',
                'economic-indicator': 'Economic indicator', 'financial-event': 'Financial event', 'central-bank-activity': 'Central bank activity',
                'usd-index': 'Dollar index', gold: 'Gold', 'us-treasury': 'US Treasury rates'
              },
              // 唯一 owner 见文件头 `registeredEventNames`。
              eventName: registeredEventNames['en-US'],
              lifecycleState: { scheduled: 'Scheduled', released: 'Released', cancelled: 'Cancelled' },
              comparability: { comparable: 'Comparable', 'not-comparable': 'Not comparable' },
              caveat: {
                'max-items-truncated': 'Evidence count truncated', 'source-health-unavailable': 'Source health unavailable', 'query-unavailable': 'Query unavailable',
                'query-empty': 'Query returned nothing', 'evidence-unavailable': 'Evidence unavailable', 'not-comparable': 'Not comparable with other data',
                'macro-calendar-unavailable': 'Economic calendar unavailable', 'macro-calendar-empty': 'Economic calendar empty',
                'macro-calendar-consensus-unavailable': 'Market consensus missing', 'macro-calendar-query-not-wired': 'Economic calendar not wired',
                'observed-unverified': 'Source identity unverified', 'provider-title-is-display-name': 'Event name is the provider title',
                'provider-surprise-not-comparable': 'Surprise not computable', 'provider-observation-identity-missing': 'Calendar observation has no stable identity',
                'provider-observation-page-unavailable': 'Calendar observation page unavailable', 'provider-observation-pages-truncated': 'Calendar observation pages truncated',
                'provider-observations-truncated': 'Calendar observations truncated', 'etf-unavailable': 'ETF data unavailable',
                'sentiment-not-computed-as-of': 'Sentiment not computed yet', 'domain-not-requested': 'Domain not requested', 'query-not-run': 'Query not run',
                'official-time-not-published': 'Official time not published', 'official-timezone-not-published': 'Official timezone not published',
                'official-period-not-published-in-ics': 'Official period not published', 'official-value-revised': 'Official value revised',
                'manual-ics-import': 'Manual calendar import', 'bls-python-schedule': 'BLS automatic schedule', 'bea-official-rss-release-page': 'BEA official release page',
                'us-cash-session': 'US cash session only', 'tokenized-index-proxy': 'Tokenised index proxy',
                'official-daily-close': 'Official daily close, may lag several trading days', 'synthetic-dollar-index': 'Synthesised dollar index (not the official ICE index)',
                'provider-time-series': 'Provider time series (bars on the provider cadence)', 'query-stale': 'Reading expired; not stated as current',
                'macro-rates-mixed-observation-dates': 'Two daily series disagree on the observation date; no difference stated'
              },
              term: { consensus: 'Market consensus', actual: 'Actual', previous: 'Previous', stablecoins: 'Stablecoins' }
            }
          },
          calendarCard: {
            title: 'What to watch', todaySection: 'Recently released, value moved', upcomingSection: 'Upcoming',
            empty: 'No high-importance events in the next 7 days', unavailable: 'Calendar data is unavailable', refresh: 'Refresh',
            awaitingData: 'Scheduled time has passed; waiting for the value',
            reactionWindow: '±30 min',
            openCalendar: 'Open the economic calendar', switchToAgent: 'Switch to the market agent', switchToCalendar: 'Switch to the calendar card',
            openEventInCalendar: 'Open this event in the calendar',
            collapseAgent: 'Collapse the agent', expandAgent: 'Open the market agent', closeAgent: 'Close', agentTitle: 'Market agent', clearConversation: 'Clear', copyEvent: 'Copy', eventContext: { heading: 'Selected event', state: 'State', released: 'Released', upcoming: 'Not yet released', cancelled: 'Cancelled', missing: 'not published', related: 'Same hour', factsHeading: 'Facts held now', factsUnavailable: 'Nothing is held for this event; do not infer from that', factsPartial: 'These facts are incomplete; name what is missing', factsEvidence: 'Evidence' }, importanceHigh: 'High importance', timePending: 'Time TBD'
          },
          analysisTimeline: {
            retryAnalysis: 'Retry analysis', attemptFailed: 'Last analysis was not published',
            failureReasons: { 'analysis-invalid-output-schema': 'Model output did not match the required format. Retry.', 'analysis-missing-evidence': 'The analysis output did not match the frozen evidence, so it was not published. Retry; if it keeps failing, check sources.', 'analysis-provider-not-ready': 'Model is not ready. Check model settings.', 'analysis-provider-error': 'Model invocation failed. Check the connection and retry.', 'analysis-timeout': 'Model invocation timed out. Retry.', 'analysis-cancelled': 'The analysis was interrupted (app closed or task cancelled). Retry.' },
                        triggerStatus: { label: 'Latest decision', since: 'since', slotOpen: 'open ', slotDelayed: 'caught up late', reasons: { 'significance-confirmed': 'Data changed significantly; analysis started', 'significance-below-threshold': 'No significant change; not analysed', 'provider-surprise-confirmed': 'A provider calendar release landed far from the market expectation (not an official value); analysis started', 'semantic-no-op': 'Identical to last time; not analysed', 'interval-active': 'Less than 30 minutes since the last analysis; coalesced', 'hour-budget-exhausted': 'Hourly analysis limit reached', 'day-budget-exhausted': 'Daily analysis limit reached', 'schedule-reserve-exhausted': 'Session-slot allowance used up for today', 'session-slot-asia': 'Asian open analysis (08:00)', 'session-slot-europe': 'European open analysis (16:00)', 'session-slot-us': 'US open analysis (24:00)', 'invalid-significance-input': 'Decision input was invalid; not analysed', 'manual-request': 'You triggered it from the panel', 'severity-confirmed': 'High-importance intelligence; analysis started', 'medium-score-confirmed': 'Mid-level intelligence crossed the threshold; analysis started', 'market-reaction-confirmed': 'A comparable market reaction was confirmed; review started', 'restart-initial-compensated': 'First analysis re-run after a process restart', 'restart-review-compensated': 'Review re-run after a process restart' } },
loadMore: 'Load more', selectEntry: 'Select a timeline entry to view details.',
            settings: 'Settings', settingsTitle: 'AI analysis settings', analysisEnabled: 'Enable AI analysis',
            analysisEnabledHint: 'When off, nothing is analysed automatically and no model is called.', analysisModel: 'Analysis model', modelFollowDefault: 'Follow the default assistant model', followsDefaultPrefix: 'Following default: ',
            enableAnalysis: 'Enable AI analysis', analysisOffHint: 'AI analysis is off. Published analyses are kept; new ones start once it is enabled.',
            refusalModelUnconfigured: 'No usable default assistant model. Choose an analysis model first.', refusalModelUnavailable: 'That model cannot be called right now. Pick another one.',
            refusalFailed: 'Could not save. Retry.', saving: 'Saving…', save: 'Save', cancel: 'Cancel',
            entry: 'Message analysis / timeline', description: 'Review published summaries, predictions, and evidence coverage',
            workspaceLabel: '— MARKET ANALYSIS', title: 'AI intelligence analysis', back: 'Back to Agents', loading: 'Loading message analysis…', unavailable: 'Analysis detail is unavailable.', empty: 'No published message analysis yet.', requestInitialAnalysis: 'Generate first analysis', refreshAnalysis: 'Analyze now', initialAnalysisQueued: 'First analysis queued; this panel updates when it finishes.', initialAnalysisUnavailable: 'No eligible published intelligence is available for analysis.', initialAnalysisFailed: 'The first-analysis job failed to start. Refresh and try again.', analysisRefreshAlreadyAvailable: 'The latest analysis is already available.', analysisRefreshFailed: 'The re-analysis request did not go through. Try again.', analysisServiceNotReady: 'The analysis service is still starting up. Try again shortly.', timeline: 'Analysis timeline', detail: 'Analysis detail', dismissError: 'Dismiss message',
            eventGroup: 'Event group', analysisRun: 'Analysis run', summaryVersion: 'Summary version', evidenceCount: 'Evidence count', asOf: 'As of', dataCutoff: 'Data limits', conclusion: 'AI conclusion', confirmedFacts: 'Confirmed facts', transmission: 'Transmission view', marketReaction: 'Market reaction', noMarketReaction: 'No comparable market evidence is available; direction is not judged.', supportingEvidence: 'Supporting evidence', counterEvidence: 'Counter-evidence', catalysts: 'Next catalysts', auditInfo: 'View audit information', prediction: 'Predictions', noPrediction: 'This summary has no predictions.', conditions: 'Conditions', invalidation: 'Invalidation', verificationDue: 'Verification due', agentUnavailable: 'The follow-up Agent will be enabled in the next phase.',
            status: { published: 'Published', stale: 'Stale', superseded: 'Superseded', pending: 'Pending', confirmed: 'Confirmed', 'partially-confirmed': 'Partially confirmed', invalidated: 'Invalidated', expired: 'Expired', 'insufficient-data': 'Insufficient data' }
          },
          newsSentiment: {
            title: 'Key sentiment',
            all: 'All',
            loading: 'Loading news sentiment…',
            empty: 'No data yet',
            unavailable: 'News sentiment is unavailable.',
            retry: 'Retry',
            refresh: 'Refresh',
            labels: { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral', mixed: 'Mixed' },
            counts: '{count} items',
            breakdown: '{bull} bullish · {bear} bearish · {flat} neutral',
            engine: { model: 'Model', rules: 'Rules' },
            bodyLimited: 'Some items are headline-only',
            openAll: 'Open all sentiment',
            settings: 'Sentiment settings',
            drawer: {
              title: 'News sentiment',
              filters: { direction: 'Direction', source: 'Source', scope: 'Scope', all: 'All' },
              scope: { market: 'Market', BTC: 'BTC', ETH: 'ETH' },
              columns: { time: 'Time', title: 'Title', polarity: 'Direction', source: 'Source', symbols: 'Symbols' },
              detail: { evidence: 'Evidence quote', strength: 'Strength', confidence: 'Confidence', strengthLevels: { weak: 'weak', medium: 'medium', strong: 'strong' }, body: 'Body excerpt', noBody: 'Judged from the headline and summary only', translatingBody: 'Translating body…', translationFailed: 'Body translation failed; showing the original.', translateBody: 'Translate body', engine: 'Engine', prompt: 'Prompt', original: 'Original', openOriginal: 'Open original' },
              emptyFiltered: 'No items match these filters.',
              clearFilters: 'Clear filters',
              loadMore: 'Load more',
              settings: 'Settings'
            },
            settingsModal: {
              title: 'Sentiment settings',
              modelScoring: 'Use a model to judge news direction',
              model: 'Judging model',
              followFast: 'Follow fast model: {name}',
              fastUnset: 'No fast model is configured in the model service',
              hint: 'The model only decides direction; translation still follows the source translation preferences.',
              judgeHint: '“Follow” follows the fast model; the translation model is a separate setting.',
              translation: { label: 'Translation', on: 'Auto-translate is on', off: 'Auto-translate is off', open: 'Open translation preferences', modelLabel: 'Translation model', followDefault: 'Follow model service default' },
              rescore: 'Rescore existing items', rescoring: 'Queueing…', rescored: 'Queued. Refresh once it finishes.', rescoreFailed: 'Could not queue the rescore. Try again.',
              rebuild: 'Refetch all bodies', rebuilding: 'Clearing and rebuilding…', rebuilt: 'Bodies and judgments cleared; refetching now. Refresh shortly.', rebuildFailed: 'Rebuild failed. Try again.',
              retryTranslation: 'Translate all missing', translateAll: 'Translate all', translating: 'Translating…', translationStatus: { waiting: 'Waiting', translating: 'Translating', translated: 'Translated', failed: 'Failed', contextMenu: 'Right-click for actions', translateOne: 'Translate this item', retranslateOne: 'Retranslate' }, translationQueued: 'Translation retry queued. Refresh once it finishes.', translationRetryFailed: 'Could not queue the translation retry.',
              save: 'Save',
              cancel: 'Cancel',
              saved: 'Saved',
              failed: 'Could not save'
            }
          },
          analysisDrawer: { title: 'Analysis timeline', open: 'Analysis timeline', close: 'Close' },
          dashboard: {
            workspaceLabel: '— CRYPTO INTELLIGENCE',
            title: 'Crypto market checklist',
            description: 'Read capital, macro, crypto risk appetite, then leverage. Keep partial when coverage is missing; do not fill it as neutral.',
            backToAgents: 'Back to Agents',
            configureSources: 'Configure intelligence sources',
            crossAsset: {
              title: 'Nasdaq 100 / QQQ proxy × BTC × ETH', subtitle: 'Binance QQQUSDT, the tokenised perpetual proxy (24/7, default, labelled “Proxy”); the real Nasdaq 100 index (USTEC, US cash session) answers only when that leg cannot',
              chart: 'Common-anchor returns',
              eventLine: 'Event',
              eventLineIdentityUnconfirmed: 'An official calendar release falls in the same minute; not confirmed to be the same event, so both names are kept',
              eventsCollapsed: '{count} events folded',
              readingMarket: 'BTC↔ETH move together; what carries information is how they move against QQQ and the dollar — that is what says where the driver comes from.',
              readingEvent: 'Read sideways at one instant: dollar up with gold down and BTC following = a discount-rate move; gold up with BTC down = BTC trading as the risk asset.',
              // The row is named after the instrument that actually answers it, so a price and its name
              // can never disagree. `assets.index` is the row's default instrument, and the name an
              // unanswered row carries because that is what it would display.
              assets: { index: 'QQQ', btc: 'BTC', eth: 'ETH' },
              indexNames: { real: 'Nasdaq 100', proxy: 'QQQ' },
              noData: 'No data', windowNoData: '—', forming: 'Live, unclosed',
              refresh: 'Update history', loading: 'Loading market data…', unavailable: 'Market data unavailable',
              quote: 'Nasdaq 100 latest close', closed: 'Closed returns', observed: 'Trade time', analysis: 'Closed data through',
              observations: 'Cross-market observations', correlations: '24h · 5m return correlation', indexBtc: 'Nasdaq 100 ↔ BTC', indexEth: 'Nasdaq 100 ↔ ETH',
              proxyTag: 'Proxy', proxyCaveat: 'A tokenised synthetic: Binance QQQUSDT perpetual (24/7), not the standard Nasdaq 100 index. It is the default reading of this row; the real index takes over only when it cannot answer.',
              indexCaveat: 'The real Nasdaq 100 index (RealMarketAPI · USTEC); new five-minute bars appear only during the US cash session.',
              marketClosed: 'Market closed', marketClosedHint: 'Outside the US cash session (09:30–16:00 New York) no new five-minute bar is printed; this is the last bar that closed.',
              lastClosedBar: 'Last closed bar',
              proxyMarketState: 'Tokenised proxy trades 24/7',
              statusTitle: 'Market status', statusColumns: { asset: 'Asset', latest: 'Latest', '15m': '15m', '1h': '1h', '24h': '24h', '7d': '7d' },
              assetLabels: { dxy: 'Dollar DXY', gold: 'Gold XAU', us10y: 'US 10Y', realRate: 'Real rate' },
              syntheticTag: 'Synthetic', syntheticCaveat: 'This dollar index is synthesised from the ICE basket with published weights; it is not the official ICE DXY.',
              notConnected: 'Not connected', notConnectedHint: 'No data source admitted yet; it appears here once connected',
              dailyFrequency: 'Daily', bpUnit: 'bp',
              dailyChangeWithDate: 'Daily {change} (as of {date})',
              // The block's own rhythm, next to its heading rather than inside a figure cell: an
              // official daily close arrives once per trading day, so a row that has not moved is
              // waiting for the source, not stuck.
              dailyCadence: 'published once per trading day; unchanged until the next close',
              dailyChangeUnknownWithDate: 'Daily — (as of {date})',
              termSpread: 'Term spread',
              // The expectation is its own series and can be a day ahead of these rows; the date
              // therefore travels with the value instead of being inherited from the row.
              inflationExpectationWithDate: 'Inflation expectation {value}% (as of {date})',
              dailyMixedDates: 'Two daily series disagree on the observation date; no difference stated',
              dailyCaveat: 'Official daily close: the level of a trading day, and no explanation of intraday moves.',
              // The cross-market reading (design 142), in the same plain words as the Chinese copy.
              reading: {
                title: 'How to read',
                scenarios: {
                  'risk-off': 'Money is hiding', 'discount-rate': 'Money got expensive', 'risk-on': 'Money is taking risk (still insured)',
                  'risk-on-recovery': 'No longer afraid', 'crypto-specific': 'Only crypto moved'
                },
                stories: {
                  'risk-off': 'the dollar and gold are being bought, stocks and BTC fall together',
                  'discount-rate': 'the dollar rises, gold falls, stocks and BTC fall together',
                  'risk-on': 'the dollar falls; gold, stocks and BTC rise together',
                  'risk-on-recovery': 'the dollar falls, gold is sold, stocks and BTC rise together',
                  'crypto-specific': 'the dollar, gold and stocks barely moved; BTC moved on its own'
                },
                verdict: 'Like: {scenario} · {story}',
                refuted: 'Unlike {scenario} ({leg} {direction})',
                nearestMiss: 'Closest was {scenario}, but {leg} did not move that way',
                noDriverNone: 'Every line is inside its own usual range — nothing is pushing',
                noDriverOne: 'Only {direction}; the rest are inside their own usual range',
                noDriverSeveral: 'Several lines are moving on their own ({detail}), but they do not form a scenario',
                directions: { up: 'up {value}', down: 'down {value}', flat: 'unchanged' },
                legs: { dxy: 'the dollar', gold: 'gold', index: 'the index', btc: 'BTC' },
                correlation: 'ρ {value} · {window}·{interval} · {samples}/{expected}',
                correlationUnavailable: 'ρ unavailable (too few samples); this reading has no correlation backing',
                relative: 'BTC−index {btcMinusIndex} · ETH−BTC {ethMinusBtc}',
                undetermined: {
                  'window-not-judged': 'Not judged on this window: the correlation is always the 24-hour one — switch back to 24H',
                  'legs-missing': 'Not enough data to judge: {leg} has no value in this window',
                  stale: 'Not enough data to judge: {leg} stopped updating',
                  'no-match': 'No recognisable combination: these lines do not fit any of the five scenarios'
                },
                notices: {
                  'index-proxy': 'the index leg is the tokenised proxy', 'dxy-synthetic': 'the dollar is a synthetic index', 'gold-synthetic': 'gold is a synthetic quote'
                }
              },
              statusReads: { dxy: 'A rising dollar is a crypto headwind', gold: 'Falling with BTC = discount-rate driven', us10y: 'Nominal cost of money (convention open)', realRate: 'The most direct link to BTC', index: 'Risk appetite', btc: 'Two natures: risk and liquidity', eth: 'Follows BTC with more beta' },
              btcIndex: 'BTC − Nasdaq 100 · 1h', ethBtc: 'ETH − BTC · 1h', pp: 'pp', unit: 'USDT', samples: 'Samples', coverage: 'History coverage',
              states: { disabled: 'Disabled', connecting: 'Connecting', live: 'Live', stale: 'Delayed', limited: 'Resource limited', unavailable: 'Unavailable', missing: 'No data' },
              liveStateLabels: { disabled: 'Disabled', connecting: 'Connecting', live: 'Live', stale: 'Delayed', unavailable: 'Live unavailable' },
              liveHint: 'The live price comes from an unclosed price stream; all four windows still use closed bars. Observed at',
              facts: { up: 'Nasdaq 100 and BTC rose over the last hour', down: 'Nasdaq 100 and BTC fell over the last hour', diverging: 'Nasdaq 100 and BTC diverged over the last hour', mixed: 'Nasdaq 100 and BTC directions differ or changes are small', unavailable: 'Insufficient or delayed data; no current assessment' },
              relativeFacts: { stronger: 'ETH outperformed BTC over 1h', weaker: 'ETH underperformed BTC over 1h', flat: 'ETH and BTC matched over 1h', unavailable: 'Insufficient or delayed data; no current assessment' }
            },
            sourceConfiguration: {
              title: 'Configure dashboard sources', close: 'Close', sourceList: 'Dashboard sources', configure: 'Configure in data sources', runNow: 'Run now', provider: 'Provider', readiness: 'Readiness', back: 'Back to sources', pending: 'Pending connection', pendingHint: 'This source is not connected yet and cannot be configured.', openFullSettings: 'Open full settings',
              marketConnection: { funding: 'Funding rates', market: 'Cross-market data', pending: 'Testing', passed: 'Passed', partial: 'Partial', failed: 'Failed', busy: 'Another request is running', limited: 'Rate limited', unavailable: 'Unavailable', rest: 'History', ws: 'Stream', assets: { index: 'QQQ', btc: 'BTC', eth: 'ETH' }, visibility: 'Market data updates live while the dashboard is visible; the collection preset controls funding only.' },
              loading: 'Loading source settings…', unavailable: 'Source settings are unavailable.', enabled: 'Enabled', disabled: 'Disabled', collectionPreset: 'Collection preset', testConnection: 'Test connection', saveFailed: 'Saving failed. Try again.', apiKey: { label: 'API Key', save: 'Save API Key', emptyHint: 'Enter an API key to save it.', savedHint: 'A credential is saved; enter a new API key to replace it.' }, requestBudget: 'Request budget: {maxRequests} requests / {windowSeconds} seconds',
              connection: { succeeded: 'Connection verified.', failed: 'Connection could not be verified. Try again.' },
              blsSchedule: {
                action: 'Sync official BLS schedule', pending: 'Syncing official BLS schedule…', confirmation: 'Sync the current-year official BLS schedule?',
                feedback: {
                  schedule: { updated: 'Schedule updated', unchanged: 'Schedule is current', unavailable: 'Schedule unavailable' },
                  cpi: { updated: 'CPI values updated', current: 'CPI values are current', 'not-required': 'CPI catch-up not required', unavailable: 'CPI values unavailable' },
                  employment: { updated: 'Employment values updated', current: 'Employment values are current', 'not-required': 'Employment catch-up not required', unavailable: 'Employment values unavailable' }
                }
              },
              schedule: { macro: 'Every {hours} hours after the last completed run; startup catch-up; Run now available.', manual: 'Manual only; enabling does not start collection.', interval: 'Every {minutes} minutes after the last completed run; initial run on enable.' },
              presets: { manual: 'Manual', balanced: 'Balanced', frequent: 'Frequent' },
              marketCalendar: {
                title: 'Market calendar', description: 'Collected by a product job; events stay unverified until an official link exists.', refresh: 'Refresh now', refreshing: 'Refreshing the market calendar…', succeeded: 'Market calendar refreshed.', failed: 'Market calendar refresh failed.',
                feeds: { 'macro-calendar-0xrouter-economic-data': 'Economic data', 'macro-calendar-0xrouter-financial-events': 'Financial events', 'macro-calendar-0xrouter-central-bank-activities': 'Central bank activities' },
                owner: 'Market · unverified'
              },
              groups: { 'macro-calendar': 'Macro calendar', 'macro-regulation': 'Macro and regulation', 'crypto-market': 'Crypto market', 'aggregate-data-provider': 'Aggregate data providers' },
              sources: {
                'macro-calendar-fed': { name: 'Federal Reserve Board (Fed)', description: 'Official Federal Reserve Board (Fed) schedule', status: 'Schedule settings' },
                'macro-calendar-bea': { name: 'Bureau of Economic Analysis (BEA)', description: 'Official Bureau of Economic Analysis (BEA) schedule', status: 'Schedule settings' },
                'macro-calendar-bls': { name: 'Bureau of Labor Statistics (BLS)', description: 'Official BLS release schedule', status: 'Official schedule' },
                'zero-x-router-market-calendar': { name: '0xRouter market calendar', description: 'Economic data, financial events and central bank activities; collected by a product job and marked unverified.', status: 'Market calendar' },
                'macro-calendar-coinmarketcal': { name: 'CoinMarketCal', description: 'Event calendar; not connected yet.', status: 'Pending connection' },
                'fred-rates-liquidity': { name: 'FRED Rates & Liquidity', description: 'Official daily closes: US 2Y/10Y Treasury yields, the 10Y real yield and 10Y breakeven inflation; needs a FRED API key.', status: 'Source settings' },
                'fear-greed': { name: 'Alternative.me Fear & Greed', description: 'Market risk appetite', status: 'Source settings' },
                'btc-funding-rate': { name: 'Binance Futures Positioning', description: 'BTC / ETH perpetual funding rates', status: 'Source settings' },
                'stablecoin-capital-conditions': { name: 'DeFiLlama Stablecoin Capital Conditions', description: 'Verified USD stablecoin capital conditions', status: 'Source settings' },
                'zero-x-router-aggregate-provider': { name: '0xRouter', description: 'Aggregate data provider configuration', status: 'Source settings' },
                'twelve-data-market': { name: 'Twelve Data', description: 'Synthetic dollar index (ICE basket), gold, offshore yuan and the stablecoin peg; free tier 8 requests/minute, 800/day.', status: 'Source settings' },
                'realmarketapi-market': { name: 'RealMarketAPI (real DXY)', description: 'The real ICE dollar index (DXY), collected every 5 minutes; falls back to the ICE-basket synthesis when unconfigured or stale.', status: 'Source settings' }
              }
            },
            macroReleaseDynamics: {
              title: 'Macro Release Dynamics',
              loading: 'Loading macro release dynamics…',
              unavailable: 'Macro release dynamics are unavailable.',
              upcoming: 'Upcoming',
              released: 'Last released',
              noUpcoming: 'No upcoming official schedule',
              noReleased: 'No released official value',
              today: 'Today',
              inDays: 'In {days} days',
              inDaysHours: 'In {days} days {hours} hours',
              lessThanOneHour: 'Less than one hour',
              prior: 'Prior',
              eventCount: '{count} events',
              overflowAnnouncement: '{count} additional events; open calendar for the full group',
              calendarAction: 'Open calendar',
              sourceName: 'Economic Calendar',
              sourceStates: { loading: 'Loading', available: 'Schedule available', empty: 'No official schedule', unavailable: 'Schedule unavailable' },
              manageSettings: 'Manage macro calendar settings'
            },
            fearGreed: {
              title: 'Fear & Greed',
              loading: 'Loading Fear & Greed Index…',
              empty: 'No collected Fear & Greed observation.',
              unavailable: 'Fear & Greed Index is unavailable.',
              score: 'Index score',
              observedAt: 'Observed at',
              sourceName: 'Fear & Greed Index',
              sourceStates: { loading: 'Loading', available: 'Index available', empty: 'No observation', unavailable: 'Index unavailable' },
              manageSettings: 'Manage Fear & Greed settings',
              buckets: { 'extreme-fear': 'Extreme fear', fear: 'Fear', neutral: 'Neutral', greed: 'Greed', 'extreme-greed': 'Extreme greed' }
            },
            fundingRate: {
              title: 'Perpetual funding rate',
              pairTitle: 'Perpetual funding rate · Binance USDT perpetual',
              loading: 'Loading perpetual funding rates…',
              empty: 'No collected perpetual funding-rate observation.',
              unavailable: 'Perpetual funding rates are unavailable.',
              observedAt: 'Observed at',
              sourceName: 'Binance Futures Positioning',
              sourceStates: { loading: 'Loading', available: 'Funding rate available', empty: 'No observation', unavailable: 'Funding rate unavailable' },
              manageSettings: 'Manage Binance Futures Positioning settings',
              assets: { btc: 'BTC', eth: 'ETH' },
              paymentDirections: { 'long-pays-short': 'Longs pay shorts', 'short-pays-long': 'Shorts pay longs', neutral: 'Neutral' }
            },
            capitalConditions: {
              title: 'Capital conditions', loading: 'Loading capital conditions…', empty: 'No verified capital-conditions snapshot.', unavailable: 'Capital conditions are unavailable.',
              stablecoinSupply: 'Stablecoin supply', change7d: '7D net change', btcEtfLatest: 'Latest BTC ETF', ethEtfLatest: 'Latest ETH ETF', observedAt: 'Observed at', etfFlow: 'Market flows', etfUnavailable: 'Market flows are unavailable.', funds: 'Capital', btc: 'BTC ETF', eth: 'ETH ETF',
              flowDirections: { inflow: 'Net inflow', outflow: 'Net outflow', zero: 'Flat' }, singleDay: '1 day', consecutiveDays: '{count} consecutive days', valueUnavailable: '—',
              refresh: 'Re-collect sources', refreshFailed: 'Re-collection failed. Try again shortly.'
            },
            positioning: { title: 'Market sentiment', fearGreed: 'Fear & Greed', observedAt: 'Observed at', gaugeMarkers: { fear: 'Extreme fear', neutral: 'Neutral', greed: 'Extreme greed' } },
            macroMarket: {
              sourceName: 'Macro market (Twelve Data)',
              sourceStates: {
                loading: 'Loading', available: 'Available', 'awaiting-collection': 'Waiting for the first collection',
                disabled: 'Disabled', 'credential-missing': 'API key not configured', unavailable: 'Unavailable'
              },
              manageSettings: 'Manage macro market settings'
            },
            // One row per feed in Source status. `{tag}` is the panel's own synthetic/proxy label.
            feedStatus: {
              rowNames: {
                dollar: 'US dollar index (DXY)',
                gold: 'Gold (XAU/USD · Twelve Data)',
                rates: 'Treasury yields (10Y / real · FRED daily)',
                index: 'Cross-asset index (Nasdaq 100)'
              },
              sourceNames: {
                'realmarketapi-market': 'RealMarketAPI',
                'twelve-data-market': 'Twelve Data',
                'fred-rates-liquidity': 'FRED daily',
                'binance-futures-positioning': 'Binance cross-market data'
              },
              states: {
                loading: 'Loading', ok: 'Collecting normally', unconfigured: 'Not configured',
                'configured-disabled': 'Configured but disabled', failed: 'Collection failed',
                'stale-fallback': 'Stale, fell back', proxy: 'Proxy in use',
                'awaiting-collection': 'Waiting for the first collection', unavailable: 'Unavailable'
              },
              detail: {
                recent: 'last {time}',
                asOf: 'as of {date}',
                indexReal: 'real index {name}',
                unconfigured: 'Not configured {source}; {usage}',
                disabled: '{source} is configured but disabled; {usage}',
                failed: '{source} collection failed ({code}); {usage}',
                failedNoCode: '{source} collection failed; {usage}',
                staleFallback: 'the real DXY has not updated for {minutes} min; {usage}',
                staleFallbackNoPoint: 'the real DXY has no data point; {usage}',
                proxyInUse: '{usage} QQQUSDT (not the standard index)',
                awaiting: 'Configured; waiting for the first collection',
                unavailable: 'source status is unreadable'
              },
              usage: { synthetic: 'falling back to the {tag} value', proxy: 'using the {tag} value', none: 'no data yet' },
              relative: { justNow: 'just now', minutes: '{count} min ago', hours: '{count} h ago', days: '{count} d ago' },
              // Anomaly first: healthy feeds share one line, so the link text no longer repeats a feed name.
              summary: '✓ {count} feeds collecting normally ({names})',
              manage: 'Manage ›',
              manageSources: 'Manage sources ›'
            },
            context: { sourceStatus: { title: 'Source status' } }
          },
          calendar: {
            unifiedDay: { total: '{count} events today', grouped: 'Grouped by type', groupCount: '{type} · {count} events', empty: 'No events today', timePending: 'TBD', more: '{count} more', loading: 'Loading', incomplete: 'Partially loaded', back: 'Back to day list', storageUnavailable: 'Storage limited; existing data retained', coverage: 'Query: UTC {month}; up to 200 official events; adjacent-month coverage may be incomplete' },
            calendarSettings: 'Configure calendar',
            calendarPanel: { title: 'Calendar sources', configure: 'Configure in data sources', loading: 'Loading calendar sources…', unavailable: 'No calendar sources are available for this panel.', pending: 'Pending', enabled: 'Enabled', disabled: 'Disabled' },
            market: { refreshOutcome: { succeeded: 'Refresh succeeded', failed: 'Refresh failed', unattempted: 'Not refreshed this session' }, refreshTrigger: { manual: 'Manual', automatic: 'Automatic' }, attemptFailure: { 'input-invalid': 'Invalid request', 'credential-not-configured': 'No credential configured', 'response-unavailable': 'Source did not respond', 'archive-unavailable': 'Evidence archive unavailable', 'parse-unavailable': 'Parsing limited', 'storage-unavailable': 'Storage unavailable', 'storage-pressure': 'Storage limited' }, collectedAt: 'Data collected', retainedData: 'Showing previous data', automaticRefresh: 'Updates automatically every {interval} min', officialActual: 'Official actual', officialPrevious: 'Official previous', sourceAdvanced: 'This source has updated since; the figures and time below belong to the observation above.', linkedTimeOfficial: 'Calendar time: official', linkedTimeProvider: 'Calendar time: 0xRouter', linkedTimePending: 'Calendar time: pending', missingValue: 'Unavailable', importance: { high: 'High', medium: 'Medium', low: 'Low' }, locale: 'en' as const, refresh: 'Refresh market calendar', loading: 'Loading market events…', pending: 'Refreshing market calendar…', completed: 'Market calendar updated', partial: 'Some sources failed; existing data retained', unavailable: 'Refresh incomplete; existing data may be stale', queryUnavailable: 'Market events unavailable', settings: 'Manage 0xRouter source', unknownCountry: 'Country not specified', consensus: 'Market consensus', providerPrevious: 'Previous (0xRouter)', providerActual: 'Actual (0xRouter)', comparison: 'Not comparable yet', source: '0xRouter', observed: 'Source observed', time: 'Published', more: 'More market events', kinds: { 'economic-indicator': 'Economic indicators', 'financial-event': 'Financial events', 'central-bank-activity': 'Central bank activities' }, statuses: { success: 'Collected', 'success-empty': 'No events this time', 'all-skipped': 'Parsing limited', partial: 'Partially available', unavailable: 'No available collection' } },
            eventStatus: { label: 'Release status', 'data-received': 'Data received', upcoming: 'Not yet scheduled time', 'awaiting-data': 'Not yet published', 'storage-limited': 'Storage limited', 'time-pending': 'Time pending', 'elapsed-unconfirmed': 'Scheduled time elapsed', cancelled: 'Cancelled' },
            workspaceLabel: '— MACRO / ECONOMIC CALENDAR',
            title: 'Economic calendar',
            month: 'Current month',
            monthNavigation: { previous: 'Previous month', next: 'Next month', current: 'Back to current month', picker: 'Choose month' },
            status: { loading: 'Loading economic calendar…', empty: 'No imported or collected official schedule is available for this month.' },
            emptyState: { title: 'No official schedule is imported or collected', manageAction: 'Manage Macro Calendar' },
            failures: { 'calendar-query-unavailable': 'Economic calendar is unavailable.', 'query-input-invalid': 'Economic calendar query is invalid.', 'event-not-found': 'Event detail was not found.' },
            backToDashboard: 'Back to crypto dashboard',
                        weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            importance: { high: 'High' },
            states: { scheduled: 'Scheduled', released: 'Released', cancelled: 'Cancelled' },
            categories: { inflation: 'Inflation', employment: 'Employment', growth: 'Growth', 'monetary-policy': 'Monetary policy', consumption: 'Consumption' },
            // 与 zh-CN 同一口径：已注册的引用分析侧词表，`unknown` 是兜底词。
            events: { ...registeredEventNames['en-US'], unknown: 'Official macro event' },
            abbreviations: {
              fomc: 'FOMC', cpi: 'CPI', 'core-cpi': 'Core CPI', 'nonfarm-payrolls': 'NFP', unemployment: 'Unemployment',
              'average-hourly-earnings': 'Wages', pce: 'PCE', 'core-pce': 'Core PCE', gdp: 'GDP', unknown: 'Macro'
            },
            details: { title: 'Event detail', category: 'Category', period: 'Period', source: 'Source', time: 'Release time', importance: 'Importance', state: 'State', actual: 'Actual', previous: 'Previous', unavailable: 'No official value', scheduledDateOnly: 'Official time not published', conventionTime: 'Convention default', editedTime: 'Edited',
              editTime: { label: 'Release time (editable)', save: 'Save', cancel: 'Cancel', restore: 'Restore published/convention', saved: 'Your time has been saved.', rejected: 'Not saved: the time or date is not valid.', ambiguous: 'That instant occurs twice in this timezone (daylight saving). Pick another.', hint: 'An edit stores your date and time and overrides the published and convention values.' } },
            sources: { federalReserve: 'Federal Reserve Board (Fed)', bea: 'Bureau of Economic Analysis (BEA)', blsManualIcs: 'Bureau of Labor Statistics (BLS, manual ICS)', blsAutomaticSchedule: 'Bureau of Labor Statistics (BLS, automatic annual schedule)' },
            sourceMarkers: { federalReserve: 'Fed', bea: 'BEA', blsManualIcs: 'BLS', blsAutomaticSchedule: 'BLS' },
            periods: { officialNotPublished: 'Official period not published' },
            caveats: { 'official-value-revised': 'Revised', 'official-time-not-published': 'Official release time has not been published.', 'official-timezone-not-published': 'Official release timezone has not been published.', 'official-period-not-published-in-ics': 'The BLS ICS does not provide a measurement period.', 'manual-ics-import': 'This BLS schedule was imported from a local ICS file.', 'bls-python-schedule': 'This BLS schedule was synchronized by local Python requests.' },
            moreEvents: '+{count} more',
            dayEvents: { title: 'Events on {date}', listLabel: 'All events for this day', close: 'Close', moreAriaLabel: '+{count} events' },
            manualImport: {
              action: 'Import BLS ICS',
              title: 'Import BLS ICS schedule',
              filename: 'File',
              actions: { confirm: 'Import to calendar', cancel: 'Cancel', close: 'Close' },
              status: { importing: 'Importing local ICS file…' },
              counts: { totalEvents: 'BLS calendar events', supportedReleaseGroups: 'Supported release groups', generatedEvents: 'Generated calendar events', unsupportedEvents: 'Unsupported events', insertedCount: 'Inserted schedules', rescheduledCount: 'Rescheduled events', unchangedCount: 'Unchanged schedules' },
              results: { imported: 'BLS schedule imported into the calendar.', unchanged: 'This BLS schedule matches the current calendar.' },
              failures: { 'invalid-file': 'Select a complete BLS ICS file.', 'unsupported-calendar': 'This ICS file is not a supported BLS release calendar.', 'no-supported-events': 'This BLS ICS file contains no currently supported release schedules.', 'persistence-failed': 'The BLS schedule could not be saved. Please try again.' }
            },
            blsRefresh: {
              action: 'Refresh BLS data',
              title: 'Refresh BLS release data',
              confirmation: 'This requests official BLS data and updates the matching complete release family: CPI and Core CPI, or Nonfarm Payrolls, Unemployment Rate, and Average Hourly Earnings.',
              confirm: 'Refresh', cancel: 'Cancel', pending: 'Refreshing BLS data…',
              updated: 'BLS data for the matching complete release family was refreshed.', unchanged: 'BLS data for the matching complete release family is already current.', unavailable: 'Official BLS data is unavailable for the matching complete release family. No values were saved.'
            },
            blsScheduleSync: {
              schedule: { updated: 'BLS schedule updated', unchanged: 'BLS schedule is current', unavailable: 'BLS schedule unavailable' },
              cpi: { updated: 'CPI values updated', current: 'CPI values are current', 'not-required': 'CPI catch-up not required', unavailable: 'CPI values unavailable' },
              employment: { updated: 'Employment values updated', current: 'Employment values are current', 'not-required': 'Employment catch-up not required', unavailable: 'Employment values unavailable' }
            },
            fomcRefresh: {
              publishedAt: 'Official publication time', retained: 'Refresh failed; showing previous official value',
              action: 'Fetch official value',
              confirmation: 'This requests the official Fed FOMC decision and updates verified values for this event.',
              pending: 'Fetching official Fed value…',
              updated: 'Official Fed value was fetched.', unchanged: 'Official Fed value is already current.', unavailable: 'Official Fed value is unavailable. No values were saved.'
            }
          },
          drawer: {
            title: 'Activate Crypto Agent',
            subtitle: 'This is a static source preset. It does not save or start collection.',
            tiers: { required: 'Required', recommended: 'Recommended', optional: 'Optional' },
            sources: {
              'fear-greed': { name: 'Fear & Greed Index', description: 'Market risk appetite and crowding.' },
              'spot-momentum': { name: 'Spot market momentum', description: 'BTC / ETH spot trend and trading context.' },
              'funding-rate': { name: 'Perpetual funding rate', description: 'Derivatives leverage and crowding.' },
              'macro-calendar': { name: 'Macro calendar (CPI / NFP / FOMC)', description: 'Macro event windows and repricing risk.' },
              'stablecoin-defi': { name: 'Stablecoins & DeFi', description: 'On-chain liquidity and capital context.' },
              'regulation-exchange': { name: 'Regulation & exchanges', description: 'Regulatory, announcement, and infrastructure status.' },
              'industry-news': { name: 'Industry news', description: 'Industry narratives and context.' }
            },
            detailTitle: 'Selected source',
            detailFallback: 'No source selected',
            sourceListTitle: 'Static intelligence sources',
            sourceListStatus: '7 / 7 preset',
            sourceDetails: {
              'fear-greed': { scope: 'Risk appetite / market crowding', adapter: 'Metric REST', endpoint: 'Static preview', cadence: 'Every 10 min' },
              'spot-momentum': { scope: 'BTC / ETH spot trend', adapter: 'Market feed', endpoint: 'Static preview', cadence: 'Every 5 min' },
              'funding-rate': { scope: 'Derivatives crowding', adapter: 'Derivatives feed', endpoint: 'Static preview', cadence: 'Every 5 min' },
              'macro-calendar': { scope: 'CPI / NFP / FOMC', adapter: 'Calendar feed', endpoint: 'Static preview', cadence: 'Daily' },
              'stablecoin-defi': { scope: 'On-chain liquidity', adapter: 'On-chain feed', endpoint: 'Static preview', cadence: 'Hourly' },
              'regulation-exchange': { scope: 'Announcements and infrastructure status', adapter: 'Event feed', endpoint: 'Static preview', cadence: 'Every 15 min' },
              'industry-news': { scope: 'Industry narrative and context', adapter: 'News feed', endpoint: 'Static preview', cadence: 'Hourly' }
            },
            detailFields: { scope: 'Scope', adapter: 'Adapter', endpoint: 'Connection', cadence: 'Cadence', status: 'Static preview: no save, test, or collection is performed.' },
            unverified: 'Not enabled',
            activate: 'Prewarm and activate'
          }
        },
        views: {
          overview: 'Overview',
          timeline: 'Timeline',
          sentiment: 'Sentiment'
        },
        filtersPanel: {
          timeRange: 'Time range',
          sourceGroup: 'Source group',
          scope: 'Relevance scope',
          symbol: 'Symbol',
          symbolPlaceholder: 'BTC',
          horizon: 'Sentiment horizon',
          includeBackfill: 'Show historical backfill',
          layer: 'Intelligence layer',
          direction: 'Impact direction',
          eventFamily: 'Event family',
          sourceReliability: 'Source reliability',
          timeRanges: {
            '24h': '24 hours',
            '7d': '7 days',
            '30d': '30 days'
          },
          sourceGroups: {
            all: 'All sources',
            exchange: 'Exchange',
            regulator: 'Regulator',
            media: 'Media',
            social: 'Social'
          },
          scopes: {
            both: 'Exposure + Watchlist',
            'active-exposure': 'Exposure Only',
            watchlist: 'Watchlist Only',
            all: 'All Relevant'
          },
          horizons: {
            '15m': '15 minutes',
            '1h': '1 hour',
            '4h': '4 hours',
            '24h': '24 hours'
          },
          layers: {
            all: 'All layers',
            macro: 'Macro',
            industry: 'Industry',
            asset: 'Asset',
            exchange: 'Exchange',
            project: 'Project',
            infrastructure: 'Infrastructure'
          },
          directions: {
            all: 'All directions',
            bullish: 'Bullish',
            bearish: 'Bearish',
            neutral: 'Neutral',
            mixed: 'Mixed'
          },
          eventFamilies: {
            all: 'All events',
            'text-event': 'Text event',
            'metric-event': 'Metric event',
            mixed: 'Mixed event'
          },
          reliabilities: {
            all: 'All reliability',
            official: 'Official',
            'exchange-api': 'Exchange API',
            aggregator: 'Aggregator',
            'page-extract': 'Page extract',
            community: 'Community'
          }
        },
        overview: {
          highImpact: 'High-impact events',
          sentimentSummary: 'Sentiment summary',
          alertChanges: 'Alert-relevant changes',
          sourceFreshness: 'Source freshness',
          empty: 'No data yet',
          columns: {
            title: 'Event',
            source: 'Source',
            alertStatus: 'Alert status'
          }
        },
        console: {
          statusStrip: {
            matchingEvents: 'Matching events',
            effectiveSignals: 'Effective signals',
            liveSources: 'Live sources',
            needsAttention: 'Needs attention',
            filterSummary: 'Active filters',
            fearGreed: 'Fear & Greed',
            fearGreedNotCollected: 'Not collected',
            emptyHint: {
              'no-sources-enabled': 'No runnable intelligence sources are enabled. Open source settings to enable collection.',
              'enabled-never-run': 'Sources are enabled but waiting for the first collection run.',
              'source-failed': 'Recent collection failed. Open runtime status to inspect failed sources.',
              'filters-too-narrow': 'Current filters are too narrow and hide available events. Clear filters.',
              'no-sentiment-signal': 'Events exist but no calculable sentiment signals were formed. Open the timeline.',
              'no-recent-events': 'No events match the current time range.'
            },
            filterTokens: {
              timeRange: { '24h': '24h', '7d': '7d', '30d': '30d', all: 'All time' },
              sourceGroup: { all: 'All sources', exchange: 'Exchange', regulator: 'Regulator', media: 'Media', social: 'Social' },
              scope: { all: 'All relevant', both: 'Positions + watchlist', 'active-exposure': 'Positions only', watchlist: 'Watchlist only' },
              layer: {
                all: 'All layers',
                macro: 'Macro',
                industry: 'Industry',
                asset: 'Asset',
                exchange: 'Exchange',
                project: 'Project',
                infrastructure: 'Infrastructure'
              },
              direction: { all: 'All directions', bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral', mixed: 'Mixed' },
              horizon: { '15m': '15m', '1h': '1h', '4h': '4h', '24h': '24h' },
              symbol: {},
              eventFamily: { 'text-event': 'Text events', 'metric-event': 'Metric events', mixed: 'Mixed events' },
              sourceReliability: {
                official: 'Official',
                'exchange-api': 'Exchange API',
                aggregator: 'Aggregator',
                'page-extract': 'Page extract',
                community: 'Community'
              }
            }
          },
          layerDesk: {
            title: 'Three-layer desk',
            collectionState: 'Collection state',
            latestEvent: 'Latest event',
            noRecentEvent: 'No recent event',
            lastSuccess: 'Last success',
            readiness: 'Coverage',
            readinessCounts: { live: 'Live', fixtureReady: 'Fixture', planned: 'Planned' },
            plannedCoverage: 'Planned coverage',
            fixtureCoverage: 'Fixture coverage',
            fearGreedTitle: 'Fear & Greed Index',
            fearGreedNotCollected: 'Not collected',
            collectionStates: {
              healthy: 'Healthy',
              degraded: 'Degraded',
              failed: 'Failed',
              pending: 'Pending',
              paused: 'Paused',
              'none-enabled': 'Not enabled'
            },
            readinessLabels: {
              live: 'Live',
              'fixture-ready': 'Fixture-ready',
              planned: 'Planned'
            }
          },
          recentEvents: {
            title: 'Recent effective events',
            empty: 'No events to show right now.',
            columns: {
              event: 'Event',
              layer: 'Layer',
              direction: 'Direction',
              source: 'Source',
              time: 'Time'
            }
          },
          sourceCoverage: {
            title: 'Source coverage',
            v2Required: 'V2',
            columns: {
              source: 'Source',
              layer: 'Layer',
              state: 'State',
              items: 'Events',
              impacts: 'Impacts'
            },
            productionStates: {
              fresh: 'Fresh',
              stale: 'Stale',
              pending: 'Pending',
              failed: 'Failed',
              disabled: 'Disabled',
              'fixture-only': 'Fixture-only',
              planned: 'Planned'
            },
            readinessLabels: {
              live: 'Live',
              'fixture-ready': 'Fixture-ready',
              planned: 'Planned'
            }
          },
          fearGreedBuckets: {
            'extreme-fear': 'Extreme fear',
            fear: 'Fear',
            neutral: 'Neutral',
            greed: 'Greed',
            'extreme-greed': 'Extreme greed'
          },
          fearGreedInterpretation: {
            'extreme-fear': 'Risk appetite is weak. Can imply capitulation, but not an automatic long signal.',
            fear: 'Defensive mood. Risk assets may need stronger catalysts.',
            neutral: 'No strong crowding signal from this index.',
            greed: 'Risk appetite is elevated. Watch crowding and leverage.',
            'extreme-greed': 'Crowding risk is high. Treat as mixed or correction-risk input.'
          },
          attentionKinds: {
            'source-failed': 'Source collection failed',
            'source-pending': 'Source pending first run',
            'credential-missing': 'Missing API credential',
            'planned-source-visible': 'Planned source (roadmap only)',
            'fixture-ready-source-visible': 'Fixture-ready source (not production data)'
          },
          filterTokens: {
            timeRange: { '24h': '24h', '7d': '7d', '30d': '30d', all: 'All time' },
            sourceGroup: { all: 'All sources', exchange: 'Exchange', regulator: 'Regulator', media: 'Media', social: 'Social' },
            scope: { all: 'All relevant', both: 'Positions + watchlist', 'active-exposure': 'Positions only', watchlist: 'Watchlist only' },
            layer: {
              all: 'All layers',
              macro: 'Macro',
              industry: 'Industry',
              asset: 'Asset',
              exchange: 'Exchange',
              project: 'Project',
              infrastructure: 'Infrastructure'
            },
            direction: { all: 'All directions', bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral', mixed: 'Mixed' },
            horizon: { '15m': '15m', '1h': '1h', '4h': '4h', '24h': '24h' },
            symbol: {},
            eventFamily: { 'text-event': 'Text events', 'metric-event': 'Metric events', mixed: 'Mixed events' },
            sourceReliability: {
              official: 'Official',
              'exchange-api': 'Exchange API',
              aggregator: 'Aggregator',
              'page-extract': 'Page extract',
              community: 'Community'
            }
          }
        },
        detailContext: {
          contextTitle: 'Workspace context',
          filterSummary: 'Active filters',
          matchingEvents: 'Matching events',
          effectiveSignals: 'Effective signals',
          latestSuccess: 'Latest successful collection',
          needsAttention: 'Needs attention',
          plannedCoverage: 'Planned capabilities',
          fearGreed: 'Fear & Greed Index',
          fearGreedScore: 'Index score',
          fearGreedClassification: 'Classification',
          fearGreedUpdatedAt: 'Updated at',
          fearGreedSource: 'Source',
          fearGreedReadiness: 'Readiness',
          fearGreedCollectionState: 'Collection state',
          fearGreedNotCollected: 'Not collected',
          fearGreedIncludedInAggregate: 'Included in aggregate',
          fearGreedIncluded: 'Included',
          fearGreedExcluded: 'Not included',
          fearGreedStateLabels: {
            live: 'Collected',
            pending: 'Collection pending',
            failed: 'Collection failed',
            'not-collected': 'Not collected'
          },
          fearGreedReadinessLabels: {
            live: 'Live',
            'fixture-ready': 'Fixture-ready',
            planned: 'Planned'
          },
          actions: {
            clearFilters: 'Clear filters',
            openRuntime: 'Runtime status',
            openTimeline: 'Open timeline',
            openSettings: 'Source settings'
          }
        },
        timelineView: {
          empty: 'No timeline events yet.',
          retryAssessment: 'Retry',
          columns: {
            event: 'Event',
            source: 'Source',
            eventType: 'Type',
            publishedAt: 'Published',
            detectedAt: 'Detected',
            symbols: 'Symbols',
            assessmentStatus: 'Assessment',
            alertStatus: 'Alert status',
            layer: 'Layer',
            direction: 'Direction',
            confidence: 'Confidence',
            impactScope: 'Impact scope',
            revision: 'Updated',
            noSymbols: 'Market-wide'
          }
        },
        sentimentView: {
          empty: 'No sentiment aggregates yet.',
          columns: {
            scope: 'Scope',
            horizon: 'Horizon',
            score: 'Score',
            label: 'Label',
            signals: 'Signals',
            layerBreakdown: 'Layer contribution'
          }
        },
        detailPanel: {
          empty: 'Select a row to view details.',
          sources: 'Sources',
          latestRevision: 'Latest revision',
          latestAssessment: 'Latest assessment',
          rawEvidence: 'Raw evidence',
          sentimentScope: 'Sentiment scope',
          sentimentScore: 'Sentiment score',
          supportingEvents: 'Supporting events',
          translationStatus: 'Translation status',
          translatedAt: 'Translated at',
          retryTranslation: 'Retry translation',
          impacts: 'Impact assessment',
          metricEvent: 'Metric event',
          transmissionLogic: 'Transmission logic',
          evidence: 'Evidence',
          forecastMissing: 'Forecast missing; compared against previous value',
          forecast: 'Forecast',
          previous: 'Previous',
          surprise: 'Surprise',
          confidence: 'Confidence',
          magnitude: 'Magnitude',
          expected: 'Expected',
          clusters: 'clusters',
          items: 'items',
          supportingEvidence: 'Supporting evidence',
          impactRules: 'Impact rules',
          omittedSupportingItems: '{count} more items not shown'
        },
        translation: {
          translated: 'Translated',
          original: 'Original',
          statuses: {
            translated: 'Translated',
            pending: 'Pending',
            failed: 'Failed',
            stale: 'Stale',
            'not-required': 'Not required'
          }
        },
        operations: {
          open: 'Runtime status',
          title: 'Collection runtime status',
          close: 'Close',
          empty: 'No source runtime data yet.',
          lastSuccess: 'Last success',
          lastFailure: 'Last failure',
          failures: 'Consecutive failures',
          runtimeStatuses: {
            healthy: 'Healthy',
            degraded: 'Degraded',
            failed: 'Failed',
            paused: 'Paused',
            pending: 'Pending collection'
          }
        },
        display: {
          eventTypes: {
            news: 'News',
            announcement: 'Announcement',
            incident: 'Incident',
            maintenance: 'Maintenance',
            regulation: 'Regulation',
            macro: 'Macro',
            'exchange-status': 'Exchange status',
            'system-status': 'System status',
            'exchange-announcement': 'Exchange announcement',
            blog: 'Blog'
          },
          aggregateLabels: {
            positive: 'Positive',
            negative: 'Negative',
            neutral: 'Neutral',
            mixed: 'Mixed'
          },
          scopeTypes: {
            'market-wide': 'Market-wide',
            'risk-assets': 'Risk assets',
            'crypto-market': 'Crypto market',
            sector: 'Sector',
            symbol: 'Symbol',
            watchlist: 'Watchlist',
            'active-position': 'Active position',
            exchange: 'Exchange'
          },
          layers: {
            macro: 'Macro',
            industry: 'Industry',
            asset: 'Asset',
            exchange: 'Exchange',
            project: 'Project',
            infrastructure: 'Infrastructure'
          },
          directions: {
            bullish: 'Bullish',
            bearish: 'Bearish',
            neutral: 'Neutral',
            mixed: 'Mixed'
          },
          reliabilities: {
            official: 'Official',
            'exchange-api': 'Exchange API',
            aggregator: 'Aggregator',
            'page-extract': 'Page extract',
            community: 'Community'
          },
          eventFamilies: {
            'text-event': 'Text',
            'metric-event': 'Metric',
            mixed: 'Mixed'
          }
        },
        filters: {
          both: 'Exposure + Watchlist',
          'active-exposure': 'Exposure Only',
          watchlist: 'Watchlist Only',
          all: 'All Relevant'
        },
        columns: {
          time: 'Time',
          title: 'Event',
          relevance: 'Relevance',
          alertStatus: 'Alert Status'
        },
        enums: {
          relevance: {
            'active-futures-position': 'Futures position',
            'active-spot-exposure': 'Spot exposure',
            watchlist: 'Watchlist',
            'position-and-watchlist': 'Exposure + watchlist',
            'market-wide-critical': 'Market-wide critical',
            'related-sector': 'Related sector',
            irrelevant: 'Irrelevant'
          },
          alertStatus: {
            none: 'Not evaluated',
            suppressed: 'Suppressed',
            'timeline-only': 'Timeline only',
            notify: 'Notified'
          },
          assessmentStatus: {
            pending: 'Not evaluated',
            queued: 'Queued for assessment',
            evaluating: 'Assessing',
            evaluated: 'Evaluated',
            failed: 'Assessment failed',
            'model-not-ready': 'Model not ready'
          }
        },
        sourceHealth: {
          collectionGap: 'Collection gap',
          supportsHistoricalBackfill: 'Historical backfill supported'
        }
      }
    },
    settings: {
      macroCalendar: {
        title: 'Macro Calendar',
        description: 'Enable fixed official schedule collection.',
        loading: 'Loading…',
        unavailable: 'Settings are unavailable. Try again.',
        runNow: 'Run now', testConnection: 'Test connection', testingConnection: 'Testing…', connection: { succeeded: 'Connection verified.', failed: 'Connection could not be verified. Try again.' },
        schedule: { macro: 'Every {hours} hours after the last completed run; startup catch-up; Run now available.' },
        runNowFeedback: { queued: 'The run request was queued; collection completion is not yet confirmed.', skipped: 'This run was not queued. Confirm the provider is enabled, then try again.', failed: 'The run request could not be submitted. Try again.', 'completed-succeeded': 'Collection completed. Open the calendar to view the refreshed schedule.', 'completed-failed': 'Collection did not complete successfully. Review provider health and try again later.' },
        failureCount: 'Consecutive failures',
        lastCompletedAt: 'Last completed',
        providers: { 'macro-calendar-fed': 'Federal Reserve Board (Fed)', 'macro-calendar-bea': 'Bureau of Economic Analysis (BEA)' },
        blsCard: { title: 'Bureau of Labor Statistics (BLS)', description: 'Official release schedule and employment values.', status: 'Official collection' },
        blsSchedule: {
          action: 'Sync official BLS schedule', pending: 'Syncing the official BLS schedule…',
          feedback: {
            schedule: { updated: 'Schedule updated', unchanged: 'Schedule is current', unavailable: 'Schedule unavailable' },
            cpi: { updated: 'CPI updated', current: 'CPI current', 'not-required': 'CPI not required', unavailable: 'CPI unavailable' },
            employment: { updated: 'Employment updated', current: 'Employment current', 'not-required': 'Employment not required', unavailable: 'Employment unavailable' }
          }
        },
        pendingFeeds: { title: 'Pending connection', hint: 'Not connected yet and not configurable.', coinMarketCal: 'CoinMarketCal' },
        marketCalendar: {
          title: 'Market calendar', description: 'Collected by a product job; events stay unverified until an official link exists.', refresh: 'Refresh now', refreshing: 'Refreshing the market calendar…', succeeded: 'Market calendar refreshed.', failed: 'Market calendar refresh failed.', owner: 'Market · unverified',
          feeds: { 'macro-calendar-0xrouter-economic-data': 'Economic data', 'macro-calendar-0xrouter-financial-events': 'Financial events', 'macro-calendar-0xrouter-central-bank-activities': 'Central bank activities' }
        },
        health: { 'never-run': 'Never run', healthy: 'Healthy', degraded: 'Needs attention', failed: 'Failed' }
      },
      intelligenceSources: {
        sourceCategories: { macro: 'Macro', crypto: 'Crypto market', aggregate: 'Aggregate data providers', system: 'System & status' },
        sourceNames: {
          'macro-calendar-fed': 'Federal Reserve official schedule', 'federal-reserve-rss': 'Federal Reserve press releases',
          'macro-calendar-bea': 'BEA official releases', 'bea-economic-series': 'BEA economic data',
          'macro-calendar-bls': 'BLS official schedule', 'bls-economic-series': 'BLS economic data',
          'fred-rates-liquidity': 'Treasury rates and liquidity', fred: 'FRED (deprecated)',
          'treasury-fiscal-data': 'Treasury fiscal data', 'sec-rss': 'SEC regulatory notices', 'cftc-rss': 'CFTC regulatory notices',
          'binance-announcements': 'Binance announcements', 'binance-api-updates': 'Binance API updates',
          'binance-spot-market': 'Binance spot market', 'binance-futures-positioning': 'Binance futures positioning',
          'binance-asset-page': 'Binance asset page', 'okx-latest-announcements': 'OKX latest announcements',
          'okx-api-announcements': 'OKX API announcements', 'coingecko-market': 'CoinGecko market data',
          'defillama-stablecoins': 'DeFiLlama stablecoins', 'defillama-tvl': 'DeFiLlama TVL',
          'alternative-fear-greed': 'Fear and greed index', 'coindesk-rss': 'CoinDesk news',
          'ethereum-foundation-blog': 'Ethereum Foundation blog', cryptopanic: 'CryptoPanic news',
          coinmarketcal: 'CoinMarketCal news (legacy)', 'macro-calendar-coinmarketcal': 'CoinMarketCal event calendar',
          '0xrouter-aggregate-provider': '0xRouter aggregate market data',
          'macro-calendar-0xrouter-economic-data': '0xRouter economic data',
          'macro-calendar-0xrouter-financial-events': '0xRouter financial events',
          'macro-calendar-0xrouter-central-bank-activities': '0xRouter central bank activities',
          'realmarketapi-market': 'RealMarketAPI dollar index', 'twelve-data-market': 'Twelve Data macro market data',
          'coinbase-status': 'Coinbase status', 'kraken-status': 'Kraken status',
          'kraken-system-status': 'Kraken system status', 'solana-status': 'Solana status',
          'github-releases': 'GitHub releases'
        },
        providerNames: {
          fed: 'Federal Reserve', bea: 'Bureau of Economic Analysis', bls: 'Bureau of Labor Statistics', fred: 'FRED',
          treasury: 'US Treasury', sec: 'US SEC', cftc: 'US CFTC',
          binance: 'Binance', okx: 'OKX', coingecko: 'CoinGecko', defillama: 'DeFiLlama',
          'alternative-me': 'Alternative.me', coindesk: 'CoinDesk', 'ethereum-foundation': 'Ethereum Foundation',
          cryptopanic: 'CryptoPanic', coinmarketcal: 'CoinMarketCal', '0xrouter': '0xRouter',
          realmarketapi: 'RealMarketAPI', 'twelve-data': 'Twelve Data', coinbase: 'Coinbase',
          kraken: 'Kraken', solana: 'Solana', github: 'GitHub'
        },
        readinessLabels: { live: 'Available', 'fixture-ready': 'Fixture data', planned: 'Not connected' },

        sourceFilters: { all: 'All', calendar: 'Calendar', dashboard: 'Dashboard', pending: 'Pending', advanced: 'Advanced' },
        sourceBadges: { pending: 'Pending', advanced: 'Advanced', agent: 'Analyst', panel: 'Panel', calendar: 'Calendar', proxy: 'Proxy required' },
        proxyNotice: {
          title: 'A working local proxy (VPN) is required',
          body: 'This source blocks requests from mainland China networks, so “Test connection” and “Refresh market calendar” keep failing unless traffic goes through a proxy (the API key is not the problem). Open a VPN or local proxy that can reach overseas networks, then set “Proxy mode” to “Custom proxy” under Settings → Basic settings with the same local address (for example http://127.0.0.1:7888), and try again. A browser reaching the site does not mean this app can: app requests only use the proxy configured here.',
          action: 'Open proxy settings'
        },
        agentNames: { crypto: 'Crypto', stocks: 'Stocks', futures: 'Futures' },
        panelNames: { dashboard: 'Dashboard', 'economic-calendar': 'Calendar' },
        providerSummary: '{total} capabilities · {enabled} enabled',
        credentialsRequired: 'API key required',
        website: 'Website',
        signup: 'Sign up / Get key',
        inviteNote: 'If this source helps, signing up through my invite link buys the author an ice cream 🍦',
        testConnection: 'Test connection',
        jobRegistered: 'Auto job registered',
        jobNotRegistered: 'No auto job',
        connectionSucceeded: 'Connection verified.',
        connectionFailed: 'Connection could not be verified.',
        connectionUnsupported: 'This source is collected by a local sync job and has no connection test.',
        apiKey: { label: 'API Key', save: 'Save and verify', emptyHint: 'Enter an API key and save it.', savedHint: 'Saved; enter a new key to replace it.', revealFailed: 'Could not read the full key. Restart the app and try again.' },
        calendarSources: {
          title: 'Macro calendar', official: 'Official collection', market: 'Market calendar', pending: 'Pending connection', hint: 'Manage in the macro calendar',
          feeds: {
            'macro-calendar-fed': 'Federal Reserve Board (Fed)',
            'macro-calendar-bea': 'Bureau of Economic Analysis (BEA)',
            'macro-calendar-bls': 'Bureau of Labor Statistics (BLS)',
            'macro-calendar-0xrouter-economic-data': '0xRouter market calendar',
            'macro-calendar-coinmarketcal': 'CoinMarketCal'
          }
        },
        title: 'Intelligence Sources',
        loading: 'Loading…',
        saving: 'Saving…',
        saved: 'Saved',
        disabledSaved: 'Disabled',
        enabledManualHint: 'Enabled. Manual mode does not collect automatically. Click Run Now.',
        enabledAutoCollectQueued: 'Enabled. The first collection run was queued automatically.',
        loadFailed: 'Load failed. Try again.',
        saveFailed: 'Save failed. Try again.',
        runFailed: 'Run now failed. Try again.',
        runQueued: 'Collection queued. Waiting for result…',
        runSucceeded: 'Collection succeeded.',
        testFailed: 'Credential test failed. Try again.',
        replayFailed: 'Replay request failed. Try again.',
        focusMarkets: {
          title: 'Default Coverage',
          description:
            'Each source has built-in coverage and works with its default rules. You usually do not need to change this; customize only when overriding collection scope.',
          defaultSummary: 'Current source',
          customize: 'Advanced customize',
          customizeDone: 'Done',
          saving: 'Saving…',
          plannedHint: 'Planned',
          markets: {
            'global-macro': 'Global Macro',
            'digital-assets': 'Digital Assets',
            'cn-a-shares': 'A-shares',
            'us-equities': 'US Equities',
            'china-futures': 'China Futures',
            fx: 'FX',
            commodities: 'Commodities'
          }
        },
        focusGroups: {
          globalMacro: 'Macro & regulation',
          digitalAssets: 'Crypto market',
          aggregateProviders: 'Aggregate data providers',
          multiMarketDynamic: 'Multi-Market / Dynamic',
          plannedMarkets: 'Planned Markets',
          pending: 'Pending connection',
          macroCalendar: 'Macro calendar'
        },
        groups: {
          'exchange-announcement': 'Exchange Announcements',
          'exchange-status': 'Exchange And Infra Status',
          'official-source': 'Official Sources',
          'mainstream-news': 'Mainstream News',
          'macro-regulation': 'Macro And Regulation'
        },
        layers: {
          macro: 'Macro Intelligence',
          industry: 'Industry Intelligence',
          asset: 'Asset Micro',
          exchange: 'Exchange',
          project: 'Project',
          infrastructure: 'Infrastructure'
        },
        readiness: {
          title: 'Implementation Status',
          layer: 'Intelligence layer',
          status: 'Collection status',
          plannedHint: 'This source has no collection adapter yet. Enabling it will not run until the items below are implemented.',
          fixtureReadyHint: 'This source is fixture-ready only. Use replay to validate; production enable, schedule, and run-now are disabled.',
          statuses: {
            live: 'Collectable',
            'fixture-ready': 'Fixture verified',
            planned: 'Planned'
          }
        },
        sources: {
          'binance-announcements': 'Binance Announcements',
          'binance-api-updates': 'Binance API Updates',
          'binance-spot-market': 'Binance Spot Market',
          'binance-futures-positioning': 'Binance Futures Positioning',
          'binance-asset-page': 'Binance Asset Page',
          'okx-latest-announcements': 'OKX Latest Announcements',
          'okx-api-announcements': 'OKX API Announcements',
          'coindesk-rss': 'CoinDesk RSS',
          cryptopanic: 'CryptoPanic',
          coinmarketcal: 'CoinMarketCal',
          'coingecko-market': 'CoinGecko Market',
          'ethereum-foundation-blog': 'Ethereum Foundation Blog',
          'github-releases': 'GitHub Releases',
          'sec-rss': 'SEC RSS',
          'cftc-rss': 'CFTC RSS',
          'federal-reserve-rss': 'Federal Reserve RSS',
          'bls-economic-series': 'BLS Macro Series',
          'bea-economic-series': 'BEA Macro Series',
          'fred-rates-liquidity': 'FRED Rates And Liquidity',
          'realmarketapi-market': 'RealMarketAPI Real DXY',
          'treasury-fiscal-data': 'Treasury Fiscal Data',
          fred: 'FRED',
          'alternative-fear-greed': 'Fear And Greed Index',
          'defillama-stablecoins': 'DeFiLlama Stablecoins',
          'defillama-tvl': 'DeFiLlama TVL',
          'kraken-system-status': 'Kraken SystemStatus',
          'coinbase-status': 'Coinbase Status',
          'kraken-status': 'Kraken Status',
          'solana-status': 'Solana Status'
        },
        adapters: {
          'html-page-poller': 'HTML Page Poller',
          'rss-poller': 'RSS Poller',
          'rest-api-poller': 'REST API Poller',
          'statuspage-poller': 'Statuspage Poller',
          'websocket-stream-consumer': 'WebSocket Stream Consumer'
        },
        status: {
          enabled: 'Enabled',
          disabled: 'Disabled'
        },
        executionModes: {
          polling: 'Polling',
          websocket: 'WebSocket'
        },
        header: {
          runNow: 'Run Now',
          refreshHealth: 'Refresh Health',
          replay: 'Replay Window',
          adapter: 'Adapter',
          executionMode: 'Execution Mode'
        },
        collectionPolicy: {
          title: 'Collection Policy',
          enabled: 'Enable',
          collectionPreset: 'Collection Preset',
          manualPresetNote: 'Manual mode does not collect automatically after enable. Use Run Now.',
          plannedNotConfigurable: 'This source is not implemented yet and cannot be enabled or configured.',
          productOwnedNote: 'A product-owned job collects this source; the enable switch below controls it, while the collection preset and scope policy do not apply.',
          includeInSentiment: 'Include In Sentiment',
          scopePolicy: 'Scope Policy',
          presets: {
            manual: 'Manual',
            balanced: 'Balanced',
            frequent: 'Frequent'
          },
          scopePolicies: {
            all: 'All',
            'watchlist-priority': 'Watchlist Priority',
            'active-position-priority': 'Active Position Priority'
          }
        },
        credentials: {
          title: 'Credentials',
          credentialRef: 'Credential Reference',
          testCredentials: 'Save And Verify Connection',
          saveApiKey: 'Save API Key',
          requestBudget: 'Request budget: {maxRequests} requests / {windowSeconds} seconds',
          placeholder: 'Enter API key'
        },
        beaUserIdGuide: {
          title: 'BEA UserID',
          action: 'Get UserID',
          modalTitle: 'Get a BEA UserID',
          steps: {
            required: 'A BEA UserID is free and required for PCE and GDP actual-value collection.',
            register: 'Click below to open the official BEA registration page.',
            keep: 'Complete registration and keep the issued UserID.'
          },
          configureInMacroCalendar: 'After registration, configure the UserID in Settings > Macro Calendar.',
          openRegistration: 'Open BEA registration'
        },
        sourceSpecific: {
          title: 'Source-Specific Options',
          empty: 'No extra visible fields for this source.'
        },
        retentionReplay: {
          title: 'Retention And Replay',
          rawArchiveEnabled: 'Enable Raw Archive',
          retentionMode: 'Retention Mode',
          autoReplayAfterParserUpgrade: 'Auto Replay After Parser Upgrade',
          retentionModes: {
            compact: 'Compact',
            balanced: 'Balanced',
            extended: 'Extended'
          }
        },
        health: {
          title: 'Source Health',
          runtimeStatus: 'Runtime Status',
          lastSuccessAt: 'Last Success',
          lastFailureAt: 'Last Failure',
          consecutiveFailures: 'Consecutive Failures',
          lastRunSummary: 'Last Run Summary',
          empty: 'None',
          statuses: {
            healthy: 'Healthy',
            degraded: 'Degraded',
            failed: 'Failed',
            paused: 'Paused'
          }
        },
        actions: {
          save: 'Save'
        },
        collectionHint: {
          title: 'Manual collection required',
          body: 'Manual mode does not pull data automatically. Run Now before expecting items on the Intelligence page.',
          action: 'Run Now'
        },
        translationPreferences: {
          title: 'Translation Preferences',
          autoTranslateEnabled: 'Auto translate',
          targetLocale: 'Target locale',
          translationModel: 'Translation model',
          translateTitle: 'Translate titles',
          translateSummary: 'Translate summaries',
          translateEvidenceExcerpt: 'Translate evidence excerpts',
          translateBody: 'Translate article bodies',
          queueMissing: 'Translate current filter results',
          saving: 'Saving…',
          saved: 'Saved',
          saveFailed: 'Save failed. Try again.',
          queueFailed: 'Failed to queue translation job.',
          queueQueued: 'Translation job queued.',
          followModelServiceDefault: 'Follow model-service default',
          defaultModelNotConfigured: 'No default translation model configured',
          defaultModelUnavailable: 'Default translation model is unavailable',
          moduleStatus: 'Translation jobs',
          pendingCount: 'Pending',
          failedCount: 'Failed',
          translatedCount: 'Translated',
          lastJobAt: 'Last job',
          targetLocales: {
            'follow-app': 'Follow app language',
            'zh-CN': 'Chinese (Simplified)',
            'en-US': 'English'
          }
        }
      }
    }
  }
} as const

export type ProductText = typeof productText
export type IntelligencePageText = ProductText[keyof ProductText]['pages']['intelligence']
export type IntelligenceSourcesText = ProductText[keyof ProductText]['settings']['intelligenceSources']
