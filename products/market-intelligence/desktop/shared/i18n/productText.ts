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
import { miText } from './text/mi'
import { registeredEventNames } from '../../../contracts/indicatorNames'
import { dailyBriefingText } from './text/pages/dailyBriefing'
import { releaseTimeWords } from './text/releaseTimeWords'
import { macroCalendarText } from './text/settings/macroCalendar'
import { intelligenceSourcesText } from './text/settings/intelligenceSources'


/**
 * Market Intelligence 产品文案（i18n）。
 */
/**
 * Where the sentences shared by every module-signal card live.
 *
 * The failure codes are named in the contract; this is the path they are appended to, so two cards
 * cannot end up with two spellings of "we could not read".
 */
export const moduleSignalReadCopyBase = 'pages.intelligence.portal.dashboard.signalRead'

export const productText = {
  'zh-CN': {
    // 卡片空态的产品句（唯一出处）：键名与平台 `ui.state.*` 同形，由 `StateView` 的产品句入口按
    // 调用方给的键解析；`{time}` 由调用方用平台时间格式化器算好后作为参数传入。旧的
    // `newsSentiment.emptyStates` 已在迁移时删除，同一句话不再有两个出处。
mi: miText['zh-CN'],
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
          sampleMode: {
            watermark: '示例数据',
            banner: {
              title: '示例模式',
              replay: '真实历史数据 · 离线回放',
              scenario: '场景时间 {time}（不是当前时间）',
              noUpdate: '不会自动更新',
              exit: '退出示例',
              connect: '接入真实数据'
            }
          },
          dailyBriefingGeneratedBanner: {
            title: '今日简报已生成',
            generatedAt: '生成时间 {time}',
            pendingTitle: '今日简报未生成',
            pendingHint: '打开日报会补生成',
            dismiss: '知道了'
          },
          moduleLabel: 'MARKET INTELLIGENCE / AGENTS',
          /**
           * 「拿不到」与「确实没有」是两件事，两种界面的共同用词只有这一组。
           * 没有配置是读者要做的事（去设置配置），读不到是系统这边的事（再试一次）；
           * 共用一句，读者就分不清该动手还是该等。
           */
          data: {
            temporarilyUnavailable: '暂时读不到',
            drawerUnavailable: '这项数据暂时读不到，不是你没有',
            retry: '再试一次',
            sourcesNotConfigured: '还没有配置来源',
            sourcesNotEnabled: '来源没有启用',
            configureSources: '去设置配置',
            enableSources: '去启用'
          },
          agents: {
            crypto: { name: '数字货币市场解读员', lens: 'CRYPTO MARKET LENS', sourceSummary: '7 个静态情报源' },
            stocks: { name: '股票市场解读员', lens: 'EQUITIES MARKET LENS', sourceSummary: '数据源待接入' },
            futures: { name: '期货市场解读员', lens: 'FUTURES MARKET LENS', sourceSummary: '数据源待接入' }
          },
          states: { available: '配置激活', comingSoon: '准备中' },
          sourceSummary: { count: '{count} 个静态情报源', pending: '数据源待接入' },
          actions: { activate: '配置并激活', openDashboard: '打开看板', unavailable: '—' },
          activation: {
            states: { unactivated: '未激活', 'waiting-data': '数据准备中', active: '已激活', sample: '示例中' },
            progress: '已启用 {enabled}/{total}',
            actions: { configure: '配置激活', progress: '查看激活进度', open: '打开看板', openSample: '打开示例看板', sampleSwitch: '示例模式' },
            previewHint: '用真实历史数据离线回放；进入后可随时退出，不写入你的数据。',
            drawer: {
              title: '激活数字货币解读 Agent',
              subtitle: '启用下列全部来源；配齐后示例模式仍可随时开关。',
              capabilitiesTitle: '必需能力',
              capabilities: { market: '市场行情', sentiment: '市场情绪', funding: '资金费率' },
              capabilityStates: { missing: '未启用', enabled: '等待数据', ready: '已就绪' },
              groupsTitle: '来源',
              tiers: { required: '必需', recommended: '推荐', optional: '可选' },
              pending: '待接入',
              enableRecommended: '启用全部来源',
              enabling: '正在启用…',
              failed: '启用失败，请重试。',
              close: '关闭'
            }
          },
          analysisWorkspace: {
            openAgent: '完整 Agent 面板', stop: '停止', approvalRequired: '等待工具审批，请打开完整 Agent 面板处理；也可停止本次运行。',
            title: '数字货币解读 Agent', chat: '分析对话', dashboard: '市场看板', view: '切换工作区', selectedAnalysis: '已绑定选中分析', selectedEvent: '选中事件', selectedNews: '选中舆情', contextAnalysis: '引用分析',
            newConversation: '市场解读对话', newChatAction: '新对话', sessionHistory: '历史会话', deleteSession: '删除会话', deleteSessionConfirm: '删除这个会话？', cancel: '取消', noSessions: '还没有历史会话', untitledSession: '未命名会话', loading: '正在加载 Agent…', noSelection: '当前市场 · 可选择下方分析节点追问', clearSelection: '返回当前市场',
            empty: '向市场解读员提问，或选择下方时间轴中的分析。', input: '输入问题', placeholder: '想了解哪些市场变化？', followUpPlaceholder: '针对选中的分析继续提问…',
            send: '发送', sending: '分析中', resize: '调整日历与舆情高度', failed: '发送未完成，请检查会话记录和模型配置后再试。', modelRequired: '请在通用 Agent 设置中为数字货币市场解读员选择可用模型。',
            roles: { user: '你', assistant: '市场解读员', system: '系统' }, messageStates: { pending: '处理中', error: '运行失败', paused: '已暂停' },
            closeDetail: '关闭详情', detailUnavailable: '该节点的分析详情暂不可用。', readTrace: '最近一次读取', conclusionBlocks: { change: '本次变化', 'causal-chain': '因果链', condition: '判断前提', macro: '宏观侧', evidence: '证据强弱', 'data-gap': '数据缺口' }, changeFacts: '发生变化的字段', changeStructural: '结构性变化', changeDomainAdded: '新增缺失域', changeDomainRemoved: '恢复缺失域', changeCaveatAdded: '新增数据限制', changeCaveatRemoved: '解除数据限制', changeEvidenceAdded: '新增证据', changeEvidenceRemoved: '移除证据', changeObservationsAdded: '新增观测', changeObservationsRemoved: '退出窗口',
            changeSummary: '本次数据变化', noChange: '本次无新变化（与上一次读取一致）。', latestConclusion: '最新 AI 结论', latestConclusionHint: '点击下方时间轴节点可在左侧查看该节点的完整结论，不影响当前绑定。', latestConclusionEmpty: '暂无已发布的 AI 结论。可在下方时间轴生成首次分析。', latestConclusionLoading: '正在读取最新 AI 结论…', latestConclusionUnavailable: '最新结论详情暂不可用，请稍后重试。', openDetail: '查看完整结论',
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
                'etf-net-flow-usd': 'ETF 净流入', 'etf-net-flow-5d-usd': 'ETF 5 日累计净流入', 'etf-net-flow-20d-usd': 'ETF 20 日累计净流入', 'funding-rate-percent': '资金费率', 'fear-greed-index': '恐惧与贪婪指数',
                'open-interest-notional-usd': 'Binance 永续持仓名义额', 'open-interest-change-24h-pct': '持仓 24 小时变化', 'positioning-state': '持仓与费率组合态',
                'divergence-escalation': '需解读的背离组合', 'divergence-liquidity-leverage': '背离·弹药收缩而空头加仓', 'divergence-flows-price': '背离·现货流出而价格未跌', 'divergence-narrative-price': '背离·看空消息未计价',
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
                'policy-next-meeting-date': '下次会议日期', 'policy-implied-probability': '下次会议市场定价概率',
                'policy-implied-probability-change-24h': '概率 24 小时变化', 'policy-target-range': '政策目标区间',
                'policy-sep-median-current-year': 'SEP 本年中位', 'policy-sep-median-path': 'SEP 中位路径',
                'policy-last-decision-vote': '上次决议票型',
                'event-name': '事件', 'lifecycle-state': '生命周期', 'scheduled-date': '计划日期', 'scheduled-at': '计划时间',
                'official-release-date': '官方发布日期', actual: '实际值', previous: '前值', consensus: '市场预期', surprise: '预期差（实际−预期）', 'event-excerpt': '事件摘要', 'news-sentiment': '新闻舆情'
              },
              subject: {
                stablecoins: '稳定币', BTC: 'BTC', ETH: 'ETH', market: '市场', all: '全部', 'btc-vs-eth': 'BTC 相对 ETH',
                'consumer-price-index': '消费者物价指数', 'employment-situation': '就业形势', fomc: '美联储议息',
                pce: 'PCE 物价', 'core-pce': '核心 PCE', gdp: 'GDP',
                'economic-indicator': '经济指标', 'financial-event': '金融事件', 'central-bank-activity': '央行活动',
                'usd-index': '美元指数', gold: '黄金', 'us-treasury': '美债利率',
                'no-change': '维持不变', 'hike-25': '加息 25bp', 'hike-50-plus': '加息 50bp 以上',
                'cut-25': '降息 25bp', 'cut-50-plus': '降息 50bp 以上'
              },
              // 唯一 owner 见文件头 `registeredEventNames`。
              eventName: registeredEventNames['zh-CN'],
              lifecycleState: { scheduled: '待公布', released: '已公布', cancelled: '已取消' },
              positioningState: {
                'deleveraging': '去杠杆 · 多头减仓', 'short-crowded': '空头拥挤', 'long-crowded': '多头拥挤',
                'refilling': '杠杆回补 · 未拥挤', neutral: '中性', mixed: '方向分歧'
              },
              comparability: { comparable: '可比', 'not-comparable': '不可比' },
              caveat: {
                'max-items-truncated': '证据条数已截断', 'source-health-unavailable': '来源健康度不可用', 'query-unavailable': '查询不可用',
                'query-empty': '查询结果为空', 'evidence-unavailable': '证据不可用', 'not-comparable': '与其他数据不可比',
                'news-sentiment-unavailable': '新闻舆情不可用',
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
                'macro-rates-mixed-observation-dates': '两条日频序列观察日不一致，不计算差值',
                'policy-path-unavailable': '政策路径数据不可用', 'policy-path-facts-truncated': '政策路径事实已截断',
                'policy-path-24h-change-unavailable': '概率 24 小时变化尚未可得', 'policy-path-sep-unavailable': 'SEP 中位数不可用',
                'policy-path-target-range-unavailable': '政策目标区间不可用', 'policy-path-source-url-invalid': '政策路径来源链接无效',
                'odds-are-market-pricing': '预测市场盘口，不是官方预期', 'projections-from-latest-sep-meeting': 'SEP 属最近一次发布会议'
              },
              term: { consensus: '市场预期值', actual: '实际值', previous: '前值', stablecoins: '稳定币' }
            }
          },
          calendarCard: {
            title: '接下来要看的', todaySection: '最近已公布（有变化）', upcomingSection: '待发布',
            empty: '未来 7 天无高重要性事件', unavailable: '日历数据暂不可用', refresh: '刷新',
            loading: '正在读取日历…', staleNotice: '最新一次读取没有完成，下面是上一次的读数。',
            releasedEmpty: '最近 {days} 天内没有已公布的事件',
            awaitingData: '已到发布时刻，等待实际值',
            // 「±30 分」反应那一行的标签（原型 ④）。三条线的名字用跨资产那份词表。
            reactionHint: '这次发布前后各 30 分钟的相对变化（不是因果判断）',
            dxy: '美元',
            // 卡片左栏只有 84px：这里用比日历页更短的分类标签，长标签会溢出到卡片外被裁掉。
            categories: { 'economic-indicator': '经济指标', 'financial-event': '金融事件', 'central-bank-activity': '央行活动' },
            openCalendar: '打开经济日历', switchToAgent: '切换到市场解读 Agent', switchToCalendar: '切换到日历卡片',
            openEventInCalendar: '在日历中打开该事件：{name}',
            collapseAgent: '收起 Agent', expandAgent: '打开市场解读 Agent', closeAgent: '关闭', agentTitle: '市场解读 Agent', clearConversation: '清空', copyEvent: '复制 {name}', eventContext: { heading: '选中事件', state: '状态', released: '已公布', upcoming: '待公布', cancelled: '已取消', missing: '未公布', related: '同期事件', factsHeading: '系统当前事实', factsUnavailable: '系统当前没有这条事件的数据，请勿据此推断', factsPartial: '以下事实不完整，缺失处请直说缺失', factsEvidence: '证据引用' }, importanceHigh: '高重要性', timePending: '时间待定',
            surprise: { beat: '超预期', miss: '低于预期', inline: '符合预期', unavailable: '无一致预期', notComparable: '预期差不可比' }
          },
          analysisTimeline: {
            retryAnalysis: '重试分析', attemptFailed: '上次分析未发布',
            failureReasons: { 'analysis-invalid-output-schema': '模型输出格式不符合要求，请重试。', 'analysis-invalid-json': '模型返回的不是合法 JSON（可能被截断），本次未发布，请重试。', 'analysis-missing-evidence': '分析输出与冻结证据不一致，已拒绝发布，请重试；若持续失败请检查情报来源。', 'analysis-provider-not-ready': '模型未就绪，请检查模型服务配置。', 'analysis-provider-error': '模型调用失败，请检查连接后重试。', 'analysis-timeout': '模型调用超时，请重试。', 'analysis-cancelled': '分析被中断（应用关闭或任务取消），请重试。' },
            /**
             * 牌子上的「分析到哪一步」。状态只有六句，`skipped` / `failed` / `stopped` 各自再带原因：
             * 前两个的原因来自两张不同的码表（账本的 signal-* / 运行的 analysis-*），第三个是中性
             * 停下的三句。码本身不上屏，查不到才落「原因没记录」。
             */
            triggerStatus: { label: '最近一次判定', since: '起', slotOpen: '开盘 ', slotDelayed: '延迟补跑', reasons: { 'significance-confirmed': '数据变化显著，已开始分析', 'significance-below-threshold': '数据无显著变化，本次未分析', 'provider-surprise-confirmed': 'provider 日历的发布显著偏离市场预期（非官方值），已开始分析', 'semantic-no-op': '数据与上次相同，本次未分析', 'interval-active': '距上次分析不足 30 分钟，已合并', 'same-release-coalesced': '同一次发布的其它指标已经分析过，这次不再重复', 'same-release-abandoned': '同一次发布的分析没成，补位次数已经用完，这条不再单独分析', 'hour-budget-exhausted': '本小时分析次数已达上限', 'day-budget-exhausted': '今天分析次数已达上限', 'global-day-budget-exhausted': '今天各类自动分析的总次数已达上限', 'schedule-reserve-exhausted': '今日盘口分析额度已用尽', 'session-slot-asia': '亚洲盘开盘分析（08:00）', 'session-slot-europe': '欧洲盘开盘分析（16:00）', 'session-slot-us': '美洲盘开盘分析（24:00）', 'invalid-significance-input': '判定输入异常，本次未分析', 'manual-request': '你在界面上手动触发', 'severity-confirmed': '这条情报达到高重要性门槛，已开始分析', 'medium-score-confirmed': '这条情报达到中等级别门槛，已开始分析', 'market-reaction-confirmed': '已确认出现可比行情反应，已开始复盘', 'restart-initial-compensated': '进程重启后补跑缺失的首次分析', 'restart-review-compensated': '进程重启后补跑缺失的复盘', 'signal-high-triggered': '规则触发，已开始分析', 'signal-medium-triggered': '规则触发，已开始分析', 'signal-cooldown-active': '同一规则刚分析过，这次不重复', 'signal-low-marker-only': '这类情况只在看板标注，不单独分析', 'signal-calendar-owned': '宏观日历已经在处理，不重复分析', 'signal-freeze-unavailable': '分析没排上队，这次没有执行' } },
            loadMore: '加载更多', selectEntry: '选择一个时间轴节点查看详情。',
            // 时间轴跨事件组：同一屏出现多个事件时，每行标出它属于哪条事件、在说什么，
            // 否则相隔几十秒的两条结论（一条消息面、一条宏观）看起来像重复发布。
            groupTypes: { macro: '宏观', 'market-reaction': '行情反应', capital: '资金面', sentiment: '消息面', funding: '资金费率', 'cross-asset': '跨资产' },
            settings: '设置', settingsTitle: 'AI 分析设置', analysisEnabled: '开启 AI 分析',
            analysisEnabledHint: '关闭后不再自动分析，也不会调用模型。', analysisModel: '分析模型', modelFollowDefault: '跟随默认助手模型', followsDefaultPrefix: '跟随默认：',
            enableAnalysis: '开启 AI 分析', analysisOffHint: 'AI 分析已关闭。历史分析仍保留，开启后才会生成新的分析。',
            refusalModelUnconfigured: '没有可用的默认助手模型，请先在设置里选择分析模型。', refusalModelUnavailable: '所选模型当前不可用，请换一个模型。',
            refusalFailed: '保存失败，请重试。', saving: '保存中…', save: '保存', cancel: '取消',
            entry: '消息分析 / 时间轴', description: '查看已发布的分析摘要、预测与证据覆盖',
            workspaceLabel: '— MARKET ANALYSIS', title: 'AI 情报分析', back: '返回 Agent', loading: '正在加载消息分析…', unavailable: '分析详情暂不可用。', empty: '暂无已发布的消息分析。', requestInitialAnalysis: '生成首次分析', refreshAnalysis: '立即分析', initialAnalysisQueued: '首次分析已入队，完成后会自动更新。', initialAnalysisUnavailable: '当前没有符合条件的已发布情报可分析。', initialAnalysisFailed: '首次分析任务启动失败，请刷新后重试。', analysisRefreshAlreadyAvailable: '已有最新分析，无需重新分析。', analysisStillRunning: '分析仍在运行：已停止等待，完成后会自动出现在列表里。', analysisRefreshFailed: '重新分析请求未成功，请稍后重试。', analysisServiceNotReady: '分析服务正在启动，请稍后重试。', timeline: '分析时间轴', detail: '分析详情', dismissError: '关闭提示',
            eventGroup: '事件组', analysisRun: '分析运行', summaryVersion: '摘要版本', evidenceCount: '证据数量', asOf: '分析时点', dataCutoff: '数据限制', conclusion: 'AI 结论', confirmedFacts: '已确认事实', transmission: '传导判断', marketReaction: '市场反应', noMarketReaction: '当前没有可比行情证据，暂不判断市场方向。', supportingEvidence: '支撑证据', counterEvidence: '反向证据', catalysts: '后续关注', auditInfo: '查看审计信息', prediction: '预测', noPrediction: '该摘要暂无预测。', conditions: '条件', invalidation: '失效条件', verificationDue: '验证截止', agentUnavailable: '追问 Agent 将在下一阶段启用。',
            status: { published: '已发布', stale: '已过期', superseded: '已替代', pending: '待验证', confirmed: '已确认', 'partially-confirmed': '部分确认', invalidated: '已失效', expired: '已到期', 'insufficient-data': '数据不足' }
          },
          newsSentiment: {
            title: '重点舆情',
            // 原来这里叫「全部」，但查询一次最多返回 100 条：窗口名必须说出上限，否则读者以为
            // 看到的是全部历史。`MI-5-D6`。
            windowAll: '最近 100 条',
            loading: '正在读取舆情…',
            unavailable: '舆情暂时不可用。',
            staleRead: '这次刷新没读出来，下面是上一次的读数。',
            retry: '重试',
            refresh: '刷新',
            labels: { bullish: '偏多', bearish: '偏空', neutral: '中性', mixed: '分歧' },
            engine: { model: '模型', rules: '规则' },
            neutralFilter: { label: '中性', all: '带中性', exclude: '不带中性' },
            // 仅用于「整行即动作」那两处的可访问名（`aria-label`），不显示在界面上。
            openItem: '打开这条舆情：{title}',
            // 与「数据已过期 · 最后更新 {time}」同一个字段（latestKnownItemAt）、同一个格式化器，
            // 两处永远指向同一时刻。
            updatedAt: '更新于 {time}',
            settings: '舆情设置',
            drawer: {
              title: '舆情',
              filters: { direction: '方向', source: '来源', scope: '对象', all: '不限' },
              scope: { market: '全市场', BTC: 'BTC', ETH: 'ETH' },
              columns: { time: '时间', title: '标题', polarity: '方向', source: '来源', symbols: '标的' },
              detail: { evidence: '证据引文', translated: '译文', strength: '强度', confidence: '置信', strengthLevels: { weak: '低', medium: '中', strong: '高' }, body: '正文摘录', noBody: '仅依据标题与摘要判断', translatingBody: '正在翻译正文…', translationFailed: '正文翻译失败，先显示原文。', translateBody: '翻译正文', engine: '引擎', prompt: '提示词', original: '原文', openOriginal: '原文链接' },
              emptyFiltered: '当前筛选没有结果。',
              moreActions: '更多操作',
              translationStatus: { waiting: '等待翻译', queue: '正在翻译 {done}/{total}', translating: '翻译中', translated: '已翻译', failed: '翻译失败', contextMenu: '右键更多操作', translateOne: '翻译此条', retranslateOne: '重新翻译' },
              clearFilters: '清除筛选',
              loadMore: '加载更多',
              settings: '设置'
            },
            availability: {
              missing: '还没有配置来源',
              disabled: '来源没有启用',
              unreadable: '暂时读不到',
              actionConfigure: '去配置',
              actionEnable: '去启用',
              actionRetry: '再试一次',
              reasonAria: '为什么这样显示',
              reasonMissing: '四个新闻源都不在已配置的来源里。',
              reasonDisabled: '四个新闻源都没有启用；启用之后这里才有内容。',
              reasonFailed: '四个新闻源都启用着，但这次采集失败。',
              reasonNeverRan: '四个新闻源都启用着，但还没有跑过一次。'
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
              rebuild: '重新抓取所有正文', rebuilding: '正在清空并重建…', rebuilt: '已清空正文与判断并重新抓取，稍后刷新。', rebuildFailed: '重建失败，请重试。',
              rebuiltWithCopy: '旧库已原样留存一份副本，新库已建好。刷新本页即可使用新库。',
              retryTranslation: '翻译缺失项', translateAll: '批量翻译正文', cancelTranslate: '取消翻译', translating: '正在翻译…', translationQueued: '已提交翻译重试，完成后刷新查看。', translationRetryFailed: '翻译重试提交失败。',
              save: '保存',
              cancel: '取消',
              saved: '已保存',
              failed: '保存失败'
            }
          },
          analysisDrawer: { title: '分析时间轴', open: '分析时间轴', close: '关闭' },
          dashboard: {
            signalAnalysis: {
              label: '分析到哪一步',
              states: {
                published: '分析已出，可以在时间轴里看到',
                skipped: '这次没有分析',
                failed: '分析了但没成'
                // 没有 `stopped` 这一行：这一支**直接返回原因句**，外层状态句永远不上屏。
              },
              /** 读者自己在设置里关了自动分析：这句优先于任何运行状态，且不给按钮（卡片没有设置路由）。 */
              offByReader: '你关闭了自动分析，这条信号不会自动分析',
              stoppedReasons: {
                'run-cancelled': '这次运行被取消了',
                'run-superseded': '这次已被更新的一次取代，不用等',
                'run-unrecognized': '这次运行的状态读不出来',
                'run-expired': '这次分析跑过，但已经超过保存期，看不到结果'
              },
              reasonUnknown: '原因没记录',
              separator: '：'
            },
            workspaceLabel: '— CRYPTO INTELLIGENCE',
            title: '数字货币市场检查表',
            description: '按资金、宏观、加密风险偏好、杠杆顺序阅读；没有覆盖时保留 partial，不以中性填补。',
            /** 标题旁那颗 ⓘ 的读屏名：句子本身是 `description`，这里只给它一个短名字。 */
            descriptionLabel: '这张看板怎么读',
            configureSources: '配置情报源',
            /** 临时入口：打开静态配置抽屉（0.4.3 预览版）。 */
            configDrawer: {
              title: '设置',
              /** 抽屉某屏渲染崩了：这一块没能显示（不是「读取失败」，读者没做任何动作）。 */
              screenCrashed: '这一块没能显示出来，可以重试。',
              sourceUnavailable: '取不到（原因见详情）',
              unreadable: '读不到',
              discard: {
                title: '有改动没保存，要丢掉吗？',
                body: '关掉之后没保存的改动都不保留。',
                confirm: '丢掉改动',
                cancel: '继续编辑'
              },
              values: {
                save: '保存',
                saving: '保存中…',
                autoUnknown: '未知',
                autoUnknownReason: '排期是否注册读不到',
                modelFollowsDefault: '跟随平台默认模型',
                modelServiceConfigured: '已配置',
                modelServiceUnconfigured: '未配置',
                autoOn: '开',
                autoOff: '关',
                sentimentRuleOnly: '规则判断',
                sentimentFollowsFastModel: '跟随快速模型',
                sentimentUnknownReason: '评分模型设置读不到'
              },
              openModelService: '去模型服务',
              /* 「采集与数据 › 舆情」右边那张入口卡：标题用 menus.processing，短标只写「全局」。 */
              scopeGlobal: '全局',
              processingEntryAria: '打开内容处理设置（翻译偏好、情绪评分）',
              processingEntryHint: '翻译偏好 · 情绪评分',
              menus: {
                sources: '数据源', sourcesData: '采集与数据', processing: '内容处理', analysis: 'AI 分析',
                briefing: '日报', notifications: '通知', runLog: '运行日志'
              },
              groups: {
                thisSource: '这一条源',
                status: '状态',
                policy: '采集策略',
                sentimentScoring: '情绪评分'
              },
              rows: {
                enabled: '启用',
                capabilities: '能力与凭据',
                policyNote: '采集由谁负责',
                sentimentModel: '用哪个模型',
                sentimentModelSwitch: '用模型判断情绪',
                analysisSwitch: '是否分析',
                analysisModel: '分析用哪个模型',
                publishAt: '生成时刻',
                window: '统计窗口',
                editions: '一次生成几期',
                briefingModel: '日报用哪个模型',
                briefingLanguages: '生成语言',
                autoGeneration: '自动生成',
                channels: '通道事件通知',
                pushStrength: '最低强度',
                calendar: '日历事件通知',
                leadTime: '提前多久',
                importance: '哪些重要性',
                landedFilter: '通知条件',
                countries: '哪些国家的数据',
                reach: '通知方式',
                masterSwitch: '通知总开关',
                timeZone: '时区',
                language: '语言',
                theme: '显示风格',
                proxy: '代理模式',
                sourcesEnabled: '启用',
                preset: '采集预设',
                healthBadge: '健康',
                apiKey: 'API Key',
                capabilityBoard: '看板能力',
                capabilityCalendar: '日历能力',
                testConnection: '测试连接',
                runNow: '立即运行',
                sourceFields: '来源特定字段',
                focusMarkets: '关注市场',
                retention: '保留与回放',
                syncRuns: '运行记录',
                calendarFeeds: '宏观日历源',
                autoTranslate: '自动翻译',
                targetLocale: '目标语言',
                translationModel: '翻译模型',
                retentionMode: '原始归档与保留',
                generationLanguage: '生成语言',
                aiEditing: '使用 AI 编辑',
                aiBackfill: '允许补查缺失结论',
                modelServiceJump: '模型服务',
                notificationJump: '通知',
                notifyEvents: '情报事件订阅',
                notifyEventSignal: '信号触发',
                notifyEventBriefing: '日报就绪',
                notifyEventSentiment: '舆情',
                notifyEventCalendar: '日历',
                notifyTiers: '四档提醒',
                quietHours: '免打扰时段',
              }
            },
            /** One sentence per failure code, shared by every card that reads module signals. */
            signalRead: {
              'query-failed': '这条信号有没有被分析过，这次没查到。上面的数字不受影响。',
              'invalid-as-of': '这个时间点查不到这条信号有没有被分析过。上面的数字不受影响。',
              // 给读者看的是「读不到」，不是我们内部的判定原因：格式、契约这些词他既不懂也做不了。
              'contract-invalid': '这条信号有没有被分析过，这次没查到（不是没有分析过）。上面的数字不受影响。',
              ariaLabel: '这条信号有没有被分析过，这次没查到；上面的数字不受影响',
            },
            crossAsset: {
              title: '纳斯达克 100 / QQQ 代理 × BTC × ETH 联动', subtitle: 'Binance QQQUSDT 代币化永续代理（24/7，默认，带「代理」标签）；该腿不可用时回落到真实纳斯达克 100 指数（USTEC · 美股现金时段）',
              chart: '同起点收益率',
              // 窗口切换的选项与整组的可访问名：与界面上原来的 1H/24H/7D 逐字一致，只是改成键。
              rangeLabel: '收益率窗口',
              ranges: { '1h': '1H', '24h': '24H', '7d': '7D' },
              // 图表工具条那颗「?」的三行说明：与原来逐字一致，只是改成模板 + 参数，不再在调用点拼句子。
              hintAnalysis: '闭合数据截至 {time}',
              hintCoverage: '历史覆盖 {coverage}',
              hintCorrelations: '{correlations} · 样本 {indexBtc} · {indexEth}',
              hintListSep: ' · ',
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
              enableData: '启用数据', refresh: '更新历史', loading: '正在加载行情…', unavailable: '行情暂不可用',
              /* 实时报价那条腿自己的状态词（用户 2026-11-11）：「无数据」会被读成「这个资产没有数据」，
                 而它实际说的只是实时 trade 流这一条腿。原因一律进 ⓘ，正文不铺解释句。 */
              quoteLeg: { missing: '实时报价未连接', stale: '实时报价已过期' },
              quoteLegReasons: { missing: '这笔资产在实时 trade 流里一条成交都没收到（流可能没连上）。', stale: '最后一笔成交已超过 15 秒，实时报价按过期处理。' },
              /* 图上没画出来的那条线：图例照样列出，名字后面标一句，否则读者以为线被藏了。 */
              lineNotDrawn: '未绘制',
              lineNotDrawnReason: '线要求本窗内每个点都有连续的 5 分钟 K 线；这一段没凑齐，所以这条线没画。',
              staleRead: '这次刷新没读出来，下面是上一次的读数。',
              // 界面设计 2026-11-09 的条件①：这句要说清「重启之后才生效」与「怎么重启」，不能只写「版本不一致」。
              contractMismatch: '界面与主进程的版本不一致，当前数据无法读取。重启之后才会生效：点下面的「重启应用」，或完全退出观潮再打开——只刷新页面不够。',
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
              // 同一句话里本来就并列的两段（同一张表相邻两个读数）合成一个键：` · ` 是句子的一部分，
              // 不是调用点拼出来的结构。只有一段时各走单段键，不为少一行硬合。
              dailySpreadAndInflation: '期限利差 {spread} · 通胀预期 {inflation}%（截至 {date}）',
              dailySpreadOnly: '期限利差 {spread}',
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
                  'window-not-judged': '这个窗口不做解读：相关性固定按 24 小时算，切回 24H',
                  'legs-missing': '数据不足，暂不判：{leg}这条腿在该窗口没有数据',
                  stale: '数据不足，暂不判：{leg}的数据已停止更新',
                  'no-match': '看不出是哪一种：几条线没走出能被认出的组合'
                },
                notices: {
                  'index-proxy': '纳指取的是代币化代理', 'dxy-synthetic': '美元为合成指数', 'gold-synthetic': '黄金为合成报价'
                }
              },
              statusReads: { dxy: '美元↑ 对加密逆风', gold: '与 BTC 同跌 = 贴现率驱动', us10y: '名义资金成本', realRate: '与 BTC 关系最直接', index: '风险偏好', btc: '双重属性：风险 + 流动性', eth: '跟随 BTC，弹性更大' },
              btcIndex: 'BTC − 纳斯达克 100 · 1h', ethBtc: 'ETH − BTC · 1h', pp: 'pp', unit: 'USDT', samples: '样本', coverage: '历史覆盖',
              states: { disabled: '未启用', connecting: '连接中', live: '实时', stale: '延迟', limited: '资源受限', unavailable: '不可用', missing: '无数据' },
              liveStateLabels: { disabled: '未启用', connecting: '连接中', live: '实时', stale: '延迟', unavailable: '实时不可用' },
              liveHint: '实时价来自未闭合的价格流，四个窗口仍按已闭合K线计算；观测时间 {time}',
              facts: { up: '纳斯达克 100 与 BTC 近 1h 同向上涨', down: '纳斯达克 100 与 BTC 近 1h 同向下跌', diverging: '纳斯达克 100 与 BTC 近 1h 走势分化', mixed: '纳斯达克 100 与 BTC 近 1h 方向不一致或变化较小', unavailable: '数据不足或延迟，暂不判断' },
              relativeFacts: { stronger: 'ETH 近 1h 较 BTC 强', weaker: 'ETH 近 1h 较 BTC 弱', flat: 'ETH 近 1h 与 BTC 持平', unavailable: '数据不足或延迟，暂不判断' }
            },
            sourceConfiguration: {
              title: '配置看板来源', close: '关闭', sourceList: '看板来源', configure: '在数据源中配置', runNow: '立即运行', provider: '提供方', readiness: '就绪状态', back: '返回来源', pending: '待接入', pendingHint: '该数据源尚未接入，暂不可配置。', openFullSettings: '完整设置',
              marketConnection: { funding: '资金费率', market: '跨市场行情', pending: '测试中', passed: '通过', partial: '部分通过', failed: '失败', busy: '正在执行其他请求', limited: '请求受限', unavailable: '不可用', rest: '历史', ws: '实时', assets: { index: 'QQQ', btc: 'BTC', eth: 'ETH' }, visibility: '行情在看板可见时实时更新；采集预设仅控制资金费率。' },
              loading: '正在加载来源设置…', unavailable: '来源设置暂时不可用。', enabled: '启用', disabled: '未启用', collectionPreset: '采集预设', testConnection: '测试连接', saveFailed: '保存失败，请重试。', apiKey: { label: 'API Key', reveal: '显示密钥', hide: '隐藏密钥', save: '保存 API Key', emptyHint: '输入 API Key 后即可保存。', savedHint: '凭据已保存；输入新的 API Key 可替换。' }, requestBudget: '请求额度：{maxRequests} 次 / {windowSeconds} 秒',
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
                'policy-path-market': { name: 'FOMC 决议市场', description: 'Polymarket 对下一次 FOMC 会议各结果档的定价；只存衍生读数与链接。', status: '来源设置' },
                'twelve-data-market': { name: 'Twelve Data', description: '美元（ICE 篮子合成）、黄金与稳定币溢价；免费额度 8 次/分钟、800 次/天。', status: '来源设置' },
                'realmarketapi-market': { name: 'RealMarketAPI', description: '真实 ICE 美元指数（DXY）；每 5 分钟采集一次，未配置或数据失效时回退到 ICE 篮子合成值。', status: '来源设置' }
              }
            },
            macroReleaseDynamics: {
              calendarAction: '打开日历',
              sourceName: '经济日历',
              sourceStates: { loading: '加载中', available: '日程读到', empty: '本月无日程', unavailable: '日程读不到' },
              manageSettings: '管理宏观日历设置'
            },
            fearGreed: {
              title: '恐惧与贪婪',
              loading: '正在加载恐惧与贪婪指数…',
              empty: '暂无已采集的恐惧与贪婪指数。',
              score: '指数得分',
              observedAt: '观测时间',
              sourceName: '恐惧与贪婪指数',
              sourceStates: { loading: '加载中', available: '指数读到', stale: '指数偏旧 · 截至 {time}', empty: '暂无观测值', unavailable: '指数读不到' },
              manageSettings: '管理恐惧与贪婪设置',
              buckets: { 'extreme-fear': '极度恐惧', fear: '恐惧', neutral: '中性', greed: '贪婪', 'extreme-greed': '极度贪婪' }
            },
            positioning: {
              title: '永续持仓与资金费率',
              pairTitle: '永续持仓与资金费率 · Binance USDT 永续',
              loading: '正在加载永续持仓与资金费率…',
              empty: '暂无已采集的永续持仓观测值。',
              unavailable: '永续持仓数据暂时不可用。',
              contractMismatch: '这块数据的格式来自另一个版本，这次读不出来。完全退出观潮后重新打开才会恢复——刷新页面不够。',
              observedAt: '观测时间',
              /** 「最新读数」：7 天窗口把读数折进小时点时，真实最新读数比曲线末点更晚（见 `newestReadingAt`）。 */
              newestReading: '最新读数',
              stale: '数据已滞后',
              staleSuffix: ' · {stale}',
              missingValue: '—',
              notional: '持仓名义额',
              rateLabel: '资金费率 · 8h',
              oiShort: '持仓',
              rateShort: '费率',
              settledAt: '费率结算于',
              legendLine: '线 = 持仓名义额',
              legendBar: '柱 = 8h 资金费率',
              sourceMissing: '还没有配置来源',
              sourceDisabled: '来源没有启用（{source}）',
              sourceUnreadable: '暂时读不到',
              actionConfigure: '去配置',
              actionEnable: '去启用',
              actionRetry: '再试一次',
              /** 标题行那一颗：这张卡要用的源里有没配好的，就出现（用户 2026-11-11）。 */
              enableData: '启用数据',
              sourceReasonClock: '本机时钟不合法，读数时刻不成立。',
              sourceReasonQuery: '这次请求没有返回结果。',
              sourceReasonLabel: '读出失败的原因',
              // 一条腿读不到时的整句：另半张图照常画，这句只说少了哪条腿、为什么。
              fundingMissingLeg: '{asset} 资金费率历史未知（{reason}）',
              fundingMissingReasons: { 'series-missing': '这次没有读到', 'value-invalid': '读到的值不合契约' },
              change1h: '1h',
              change24h: '24h',
              window7d: '7 天',
              window24h: '24 小时',
              /** The group's accessible name; the visible labels stay on the two options. */
              windowGroup: '时间窗口',
              stateWhy: '依据：持仓 24h {change}，费率 {now}（3 个 8h 周期前 {ago}）',
              states: {
                'deleveraging': '去杠杆 · 多头减仓',
                'short-crowded': '空头拥挤',
                'long-crowded': '多头拥挤',
                'refilling': '杠杆回补 · 未拥挤',
                'neutral': '中性',
                'mixed': '方向分歧'
              },
              liquidationChip: '疑似强平 {asset} {pct} · 量 {multiple}×',
              liquidationChipLong: '疑似多头爆仓 {asset} {pct} · 量 {multiple}×',
              liquidationChipShort: '疑似空头爆仓 {asset} {pct} · 量 {multiple}×',
              // 强平判定的三种说法：脚注区一行，互斥。三句都不用警告色——它们说结论，不是报错。
              liquidationNoteNoHit: '强平判定（近 24 小时）没有命中',
              liquidationNoteUnreadable: '强平判定暂时读不到',
              liquidationNoteInsufficient: '强平判定数据不齐，这次不下结论',
              liquidationHiddenHits: '图上还有 {count} 次疑似爆仓没有标出',
              markLong: '疑似多头爆仓 {pct}',
              markShort: '疑似空头爆仓 {pct}',
              markLongMany: '疑似多头爆仓 ×{count}',
              markShortMany: '疑似空头爆仓 ×{count}',
              markMixedMany: '疑似爆仓 ×{count}',
              signalHover: '{rule}｜窗口 {window}｜{kind}',
              signalKindInferred: '推断值',
              window15m: '15 分钟',
              signalDetailsTitle: '信号读数',
              signalDetailsRule: '规则',
              /** The rule's own words; the internal id never reaches the reader. */
              signalDetailsRuleName: '持仓骤降',
              signalDetailsWindow: '窗口',
              signalDetailsDrop: '持仓降幅',
              signalDetailsVolume: '成交量为均值',
              signalDetailsObservedAt: '观测时间',
              signalDetailsNote: '这是推断值，不是交易所强平数据。',
              /** Four one-look bullets: the popover is a glance, not a document. */
              helpBullets: [
                '线是持仓名义额（1 小时），柱是资金费率（8 小时）；两者都只代表 Binance 一家。',
                '费率转负有两种可能：多头走完，或空头在堆。看持仓是否同向变化才分得清。',
                '标记＝15 分钟内持仓骤降，三条同时成立；它是推断值，不是交易所强平数据。',
                '两条线各自缩放，高低不能直接比；能比的是线末读数与左侧卡片上的数字。'
              ],
              /** The longer notes: opened below the card, never inside the bubble. */
              helpDetailsLabel: '口径说明',
              helpDetails: [
                '只标 15 分钟内的骤降，不标慢慢跌：连续阴跌时没有任何一个 15 分钟桶够得上阈值，所以图上最大的那段常常一个标记都没有。看总量看两条线的高低，看速度才看标记。',
                '标记上的「量 3.4×」是该 15 分钟成交量相对过去 24 小时同长度桶均量的倍数：1× 为平常，门槛 2×。季度展期、大额移仓也会满足那三条。',
                '窗口：7 天把 15 分钟数据折叠成每小时 1 点；24 小时用 15 分钟原生点。',
                '六档判定：持仓 24h ≤ −5% 且费率回落 = 去杠杆；≥ +5% 且费率 < 0 = 空头拥挤；≥ +5% 且费率 > +0.03% = 多头拥挤；≥ +5% 且费率在 0 ~ +0.03% = 杠杆回补；|Δ| < 5% = 中性；其余不给标签。把鼠标放在标签上可以看到该资产的两个依据数字。'
              ],

              noRate: '该时段无费率',
              sourceName: 'Binance Futures Positioning',
              sourceStates: { loading: '加载中', available: '持仓读到了', stale: '持仓偏旧 · 截至 {time}', partial: '持仓读到，费率历史只有一支', empty: '暂无观测值', unavailable: '持仓读不到' },
              manageSettings: '管理 Binance Futures Positioning 设置',
              assets: { btc: 'BTC', eth: 'ETH' },
              paymentDirections: { 'long-pays-short': '多头付费', 'short-pays-long': '空头付费', neutral: '中性' },
              // The brief's small line has ~280px; the full English wording does not fit. Same meaning,
              // same keys; the Chinese values are the full ones because there is nothing shorter to say.
              paymentDirectionsCompact: { 'long-pays-short': '多头付费', 'short-pays-long': '空头付费', neutral: '中性' },
              // The arrow a signed change prints. A glyph in the copy table, not in the component: the two
              // languages may disagree later, and a literal in a card is a word nobody can edit.
              changeArrows: { up: '↑', down: '↓' }
            },
            divergence: {
              title: '跨面板背离',
              chip: '背离：资金-杠杆',
              chipTip: '资金-杠杆背离｜窗口 7 日 / 24 小时｜事实',
              chipDetailsOpen: '看数据',
              chipDetailsTitle: '背离读数',
              chipFreshLabel: '新鲜期',
              chipFresh: '在新鲜期内',
              chipAsOf: '截至 {at}',
              chipWhyLabel: '为什么算背离',
              chipWhy: '稳定币 7 天在减少、持仓 24 小时在增加，费率同时为负：三条同时成立才判为背离。',
              helpLabel: '这张卡怎么来的',
              withheldGroup: '（{count} 对）',
              /** Joiners and placeholders live here: a fullwidth colon on an English screen is a typo. */
              withheldListSep: '、',
              labelSep: '：',
              missingValue: '—',

              unavailableTrace: '背离读数暂不可用',
              loading: '正在比对三对数据…',
              empty: '今日三对均未出现背离：资金、杠杆与价格指向同一方向。',
              unavailable: '暂时比不了：需要的几组数字没同时拿到，先不给结论。',
              withheldTitle: '未比对的配对',
              withheldReasons: {
                // No space after the leg name: Chinese does not separate a noun from its particle,
                // and the placeholder substituted a label that already ended in one.
                'window-mismatch': '{leg}的时间对不上（数据截至 {at}）',
                'leg-missing': '没有取到{leg}',
                'leg-stale': '{leg}太旧了',
                'leg-unavailable': '{leg}读取失败，不是没数据'
              },
              sentimentNoScoredItems: '{leg}：今天没有明确表态的标题',
              legAsOf: '{leg}截至 {at}',
              legs: {
                stablecoin: '稳定币 7 天', etf: 'ETF 3 日净流', 'open-interest': '持仓 24 小时',
                funding: '费率', price: '价格 24 小时', sentiment: '舆情看空占比'
              },
              /** 卡面那一行摘要：五态逐字（界面设计 v2，2026-11-08）。都不带句末句号。 */
              summary: {
                divergence: '今天有一组数据方向相反',
                quiet: '今天资金、杠杆与价格方向一致，没有背离',
                divergenceWithheldOne: '今天有一组方向相反；另有 1 组暂时判不了：{reason}',
                divergenceWithheldMany: '今天有一组方向相反；另有 {count} 组暂时判不了',
                quietWithheldOne: '今天资金、杠杆与价格一致；另有 1 组暂时判不了：{reason}',
                quietWithheldMany: '今天资金、杠杆与价格一致；另有 {count} 组暂时判不了',
                allWithheld: '今天三组都暂时判不了'
              },
              /* 「当前值 / 规则」那一行的三种写法。绝对值那条不写 `|OI|`——数学记号读者未必认，
                 所以 atMost 且阈值为正时读作「不超过」。三种模板只在这一处拼，界面复核后改这里。 */
              /* 收进 ⓘ 的四句（界面 2026-11-08 定稿逐字）。旧的两组说明（helpBullets / helpDetails）
                 已被这四句取代，实现侧只渲染这里。 */
              notes: [
                '固定阈值判出，没有模型：同一组数字每次结论相同；只有两组数据方向相反才出现。',
                '方向互冲、或某条腿贴着阈值，会被标出来交给右侧 AI 解释。',
                '「舆情」是模型给标题打的标签（24 小时内明确表态的标题里看空的占比），不是交易所数据。',
                '对时间：按天数据超 36 小时、或某腿滞后超自己节奏，就不下结论，并写明是哪条腿。'
              ],
              /* 「截至」那一行只用短名：窗口（7 天 / 24 小时）腿行里已有；每条腿各带自己的日期。 */
              /* 展开区标题。为什么用「本次读数」而不是「三组读数」/「本次判读」：展开区里既有判出来的读数，
                 也有「没判成、所以没有读数」的组——「三组」会错（有时不是三组），「判读」像内部说法。 */
              detailTitle: '本次读数',
              legNames: {
                stablecoin: '稳定币', etf: 'ETF', 'open-interest': '持仓',
                funding: '费率', price: '价格', sentiment: '舆情'
              },
              boundAtLeast: '规则 ≥ {threshold}',
              boundAtMostNegative: '规则 ≤ {threshold}',
              boundAtMostAbsolute: '规则 变动不超过 {threshold}',
              directions: { bearish: '偏空', bullish: '偏强' },
              /** 观察态的中性标签：消息偏空、价格没动。它不是方向色标签，所以单独一个键。 */
              observedLabel: '消息偏空 · 价格没动',
              invalidationLabel: '失效条件',
              pairNames: { 'liquidity-leverage': '弹药 × 空头', 'flows-price': '现货 × 价格', 'narrative-price': '舆情 × 价格' },
              pairs: {
                'liquidity-leverage': {
                  mechanism: '可动用稳定币在减少，永续空头却仍在加仓；价格一旦反弹，空头回补会放大涨幅。',
                  invalidation: '稳定币 7 天转正，或持仓 24 小时内回落 3% 以上。'
                },
                'flows-price': {
                  mechanism: '现货 ETF 在净流出、杠杆在退，价格却没跌，说明有现货在承接。',
                  invalidation: 'ETF 转为净流入，或价格补跌 1% 以上。'
                },
                'narrative-price': {
                  // 机制句已删（界面设计 2026-11-08 §九）：观察态用中性标签 + 一句事实，不再写
                  // 「要么…要么…」这种把两种可能并排放的句子。失效条件保留。
                  invalidation: '价格或持仓出现 1% 以上的方向性移动。'
                }
              }
            },
            policyPath: {
              title: '利率路径',
              range: '政策区间',
              meeting: '下次会议',
              daysAway: '{days} 天',
              projection: 'SEP',
              probability: '{month} 月加息概率',
              outcomeLead: '{month} 月{outcome}',
              longerRun: '长期',
              outcomes: { 'no-change': '维持利率', 'hike-25': '加息 25bp', 'hike-50-plus': '加息 50bp 以上', 'cut-25': '降息 25bp', 'cut-50-plus': '降息 50bp 以上' },
              basisNote: '盘口取 Polymarket 当前主档（上面写着的那一档）的买卖中间价；五档按合计归一化（合计通常略高于 1，多出的是场所抽水）。24h 是同一档前后的百分点差。这是交易者当下愿意成交的价格，不是模型预测，也不代表实际结果。',
              probabilityLabel: '加息概率',
              lastVote: '上次',
              sepMedian: 'SEP 中位',
              sepPath: 'SEP 中位数路径', decision: '上次决议', basis: '盘口与口径', close: '关闭',
              odds: '加息 25bp', change24h: '24h', range30d: '近 30 日', quote: '买卖',
              openSource: '原文', median: '中位', sepRange: '区间', previous: '上一季', vote: '票型', dissents: '反对票', venue: '场所', asOf: '截至', empty: '官方日历已同步会议日期；决议与盘口还没有采到。',
              unchanged: '维持',
              voteHint: '{for} 票赞成、{against} 票反对',
              dissentNote: '反对票的姓名与主张在下方「上次决议」里列出',
              preferred: { raise: '主张加息', lower: '主张降息', maintain: '主张维持' },
              change24hPending: '盘口序列还不满 24 小时，攒够后自动显示',
              sepSteps: 'SEP 中位 {direction} 区间中点约 {steps} 次 25bp',
              sepStepsLevel: 'SEP 中位与当前区间中点一致',
              distributionTitle: '当前分布',
              rangeLower: '下限', rangeUpper: '上限',
              shortOutcomes: { 'no-change': '维持', 'hike-25': '加息 25', 'hike-50-plus': '加息 50+', 'cut-25': '降息 25', 'cut-50-plus': '降息 50+' },
              compareNow: '现在', compareDay: '上一日', compareWeek: '上一周',
              compareHint: '「—」表示该时点还没有观测（序列不满一天或一周），不是 0。',
              topRest: '其余 {value}',
              directions: { hike: '加息≥25bp', hold: '维持', cut: '降息≥25bp' },
              phasePreMeeting: '距决议 {days} 天',
              phaseSettlement: '已决议',
              markerRepricing: '重定价 {value}pp',
              markerIntraday: '盘中 {value}pp',
              upgradeGapAbove: '委员会中位比区间中点高 {steps} 次 25bp',
              upgradeGapBelow: '委员会中位比区间中点低 {steps} 次 25bp',
              upgradeGapLevel: '委员会中位与区间中点一致',
              upgradeCompare: '上季同项 {previousSteps} 次 · 中位 {median}% vs 区间中点 {midpoint}%',
              upgradeCompareNoPrevious: '中位 {median}% vs 区间中点 {midpoint}%',
              upgradeQuote: '买卖 {bid} / {ask} · 近 30 日 {min}–{max}%',
              upgradeQuoteOnly: '买卖 {bid} / {ask}',
              settlementActual: '{date} 实际',
              settlementPriced: '决议前 1 小时定价 {value}%',
              settlementOutcomeLine: '实际落在 {actual} 档 · 之前主档「{priced}」',
              settlementPricedConclusion: '已定价',
              settlementHawkish: '相对定价偏鹰 +{value}pp',
              settlementDovish: '相对定价偏鸽 -{value}pp',
              settlementConclusionMissing: '结算结论不可得（决议前 1 小时无观测）',
              judgedLabel: '已判定 · 上次相对定价',
              judgedPriced: '已定价',
              judgedHawkish: '偏鹰 +{value}pp',
              judgedDovish: '偏鸽 -{value}pp',
              settlementTitle: '上次决议结算',
              settlementActualLabel: '实际',
              settlementPricingBefore: '决议前 1 小时：',
              settlementPricingAfter: '决议后 {hours} 小时（不是决议前的定价）：',
              settlementOther: '其他',
              settlementPricedDetail: '（实际档当时只被定价 {value}）',
              settlementStatementLink: '声明原文',
              settlementConclusionLabel: '结论',
              newTargetRange: '新目标区间',
              voteTally: '票型',
              decisionHike: '加息',
              decisionCut: '降息',
              settledMinutes: '结算后 {minutes} 分钟',
              settledHours: '结算后 {hours} 小时',
              detail: '详情',
              live: '实时',
              delayed: '延迟',
              stale: '陈旧',
              unavailable: '数据不可用',
              loading: '正在加载利率路径…'
            },
            capitalConditions: {
              title: '资金面', loading: '正在加载资金面…', empty: '暂时没有可用的资金面数据。',
              /* 形状/版本不符**不给重试**：点了必然再失败，比没有按钮更坏。这句只说读者能做的动作。 */
              contractMismatch: '这块数据的格式来自另一个版本，这次读不出来。完全退出观潮后重新打开才会恢复——刷新页面不够。',
              /* The row name is drawn as two lines; the scope keeps its own brackets (and, in
                 English, the space before them), so the spoken name is the plain concatenation. */
              stablecoin: '稳定币', stablecoinScope: '（USDT + USDC）', asset: '资产', totalSupply: '总供给',
              change1d: '1D', change7d: '7D', change30d: '30D',
              latest: '最新', windowDays: '{days} 日', coverage: '仅 {days} 天', streakColumn: '连续',
              streak: '{flow} · {count} 日', streakSingle: '{flow} · 1 日',
              shortFlowDirections: { inflow: '净流入', outflow: '净流出', zero: '持平' },
              observedAt: '观测时间', etfFlow: '市场资金流', chartWindow: '最近 7 个交易日 · 单位：百万美元',
              fundsColumn: '稳定币净流入', fundsScope: '全部美元稳定币', btc: 'BTC ETF', eth: 'ETH ETF', etfScope: '美国现货 ETF',
              infoAria: '本卡口径说明',
              chartScopeNoteMain: '稳定币净流入 = 全部美元稳定币总供给的逐日变化（不含当天）；',
              chartScopeNoteEtf: 'BTC / ETH 是美国现货 ETF 的净流，不是同一批钱。',
              columnScopeNote: '列口径：稳定币列＝全部美元稳定币；BTC / ETH 列＝美国现货 ETF。',
              notComparable: '与卡片「{row}」行不可相互核对：那行含今天。',
              etfUnknown: '未知',
              etfMissingSourceUnreadable: '这次没读到，这一支暂时没有数据',
              etfMissingAssetMissing: '这一支完全没有数据',
              etfMissingValueMissing: '最新一天没有净流入数据',
              etfComparisonUnaligned: '两支窗口不等长，对比列不可比',
              etfComparisonLagging: '落后 {days} 个交易日',
              expandDaily: '查看逐日数据',
              dailyDialogTitle: '市场资金流 · 逐日数据',
              dailyCaption: '逐日数值', dailyUnits: '百万美元 · 按 UTC 日',
              dailyFundsShort: '稳定币', dateColumn: '日期',
              flowNotEnoughDays: '最近 7 天里只有 {days} 天有数据。',
              flowNoDays: '这 7 天没有可用的资金流数据。',
              a11yAmountYi: '{value} 亿美元', a11yAmountWan: '{value} 万', a11yNoFlow: '没有净流入', a11yLabel: '{direction} {amount}', a11yCell: '{amount}，{scope}',
              flowDirections: { inflow: '净流入', outflow: '净流出', zero: '持平' },
              refresh: '重新采集来源', refreshFailed: '重新采集失败，请稍后重试。', staleRead: '这次刷新没读出来，下面是上一次的读数。',
              /* 现货牌子的三种状态与详情。规则名与窗口一律用白话，详情里不出现内部标识。 */
              signalChip: '三日净流出 {amount}', signalInsufficient: '数据不齐',
              signalInsufficientReason: '数据不齐：三日累计拿不到',
              signalTooltip: '{rule}｜窗口 {window}｜{kind}', signalRuleName: 'ETF 净流出', signalRuleWindow: '3 个交易日', signalKindObserved: '来源报告的事实',
              signalAriaAlert: '{chip}，{asset}',
              /* 牌子现在是入口：可见文字在前，后面说明点开会发生什么（label-in-name）。 */
              signalChipOpen: '{chip}，打开口径与来源',
              signalDetailTitle: 'ETF 三日净流出', signalDetailRule: '规则', signalDetailWindow: '窗口',
              signalDetailCumulative: '三日累计', signalDetailCoverage: '覆盖', signalCoverage: '{covered}/{required} 个交易日',
              signalDetailTradingDay: '数据所属交易日（UTC）', signalDetailObservedAt: '观测时间',
              signalDetailNote: '这是来源报告的净流事实，不是本机推算；数据所属交易日与观测时间不是同一件事。',
              signalDetailDialogTitle: 'ETF 三日净流出 · 口径与来源',
              /* 说明图标的读屏名：它解释的那个东西 + 「说明」，不念整段说明、不念「更多信息」。 */
              signalDetailHelpLabel: '口径与来源说明', signalInsufficientHelpLabel: '数据不齐说明',
              signalDetailGroupAnalysis: '这次分析', signalDetailGroupReadings: '读数', signalDetailGroupTime: '时间与来源'
            },
            sentiment: { title: '市场情绪', fearGreed: '恐惧与贪婪', observedAt: '观测时间', gaugeMarkers: { fear: '极恐', neutral: '中性', greed: '极贪' } },
            macroMarket: {
              sourceName: '宏观市场（Twelve Data）',
              sourceStates: {
                loading: '加载中', available: '可用', 'awaiting-collection': '等待首次采集',
                disabled: '未启用', 'credential-missing': '未配置 API Key', unavailable: '不可用'
              },
              manageSettings: '管理宏观市场设置'
            },
            /**
             * 格级/源级的两种「不读」结局。三句话不许混：未启用（没选中/源停用）、暂时读不到
             * （源状态读不到）、读不到（源启用但没数据，走各卡自己的读不到句）。
             */
            cellState: {
              notEnabled: '数据未被启用',
              sourceUnknown: '暂时读不到',
              sourceStale: '来源状态：上一次成功的读数 · {time}'
            },
            dailyBriefing: dailyBriefingText['zh-CN']
          },
          calendar: {
            /* 架构师定的停用说明（逐字，改字要先过情报模块产品经理）。{date} 来自源注册表的
               `lastSuccessfulSyncAt`，不是另抄一份日期。 */
            blsUnavailableNotice: 'BLS 官方日历：当前网络环境无法自动获取（官方站点返回 403），自动同步已停止；库里的 BLS 事件来自上次成功同步（{date}），发布时间未知。',
            /* 官方源不可用时的两种画法共用这一句（Chief 2026-11-08 口径）：整月空 → 错误态；
               官方腿读不到但市场侧有行 → 说明行。「没有」与「拿不到」必须分得开。 */
            officialUnavailableShort: 'BLS 官方日程无法自动获取',
            officialUnavailableNote: '官方站点拒绝了当前网络（403），自动同步已停止。列表里的 BLS 事件来自 {date} 成功同步的内容；要拿到新的官方日程，请从官方站点导出 ICS 后手动导入。',
            unifiedDay: { total: '当日共 {count} 条', grouped: '已按类型分组', groupCount: '{type} · {count} 条', empty: '当日暂无事件', timePending: '待定', more: '还有 {count} 条', loading: '加载中', incomplete: '未完整加载', back: '返回当日列表', storageUnavailable: '存储受限，已有数据保留', coverage: '读取范围：{months}（UTC 月，含网格相邻月）；官方每月最多 200 条' },
            calendarSettings: '配置日历',
            calendarPanel: { title: '日历源', configure: '在数据源中配置', loading: '正在加载日历源…', unavailable: '当前面板没有可配置的日历源。', pending: '待接入', enabled: '已启用', disabled: '未启用' },
            market: { marketReadFailure: { 'input-invalid': '这次读取的请求没有通过校验，刷新一次会重新发起。', 'read-threw': '这次读取没有完成，可以重试。', 'too-large': '这段窗口的事件太多，这次没有读完，可以重试。', 'cursor-loop': '读取没有继续向前，已停下，可以重试。' }, refreshOutcome: { succeeded: '刷新成功', failed: '刷新失败', unattempted: '本次尚未刷新' }, refreshTrigger: { manual: '手动', automatic: '自动' }, attemptFailure: { 'input-invalid': '请求无效', 'credential-not-configured': '未配置凭据', 'response-unavailable': '来源未响应', 'archive-unavailable': '证据归档不可用', 'parse-unavailable': '解析受限', 'storage-unavailable': '存储不可用', 'storage-pressure': '存储受限' }, collectedAt: '数据采集于', retainedData: '显示上次数据', automaticRefresh: '每 {interval} 分钟自动更新', officialActual: '官方公布值', officialPrevious: '官方前值', sourceAdvanced: '该来源此后已更新；以下数值与时间属于上方那条观测。', linkedTimeOfficial: '日历时间：官方', linkedTimeProvider: '日历时间：0xRouter', linkedTimePending: '日历时间：待定', missingValue: '暂无', importance: { high: '高', medium: '中', low: '低' }, locale: 'zh' as const, refresh: '刷新市场日历', loading: '正在读取市场事件…', pending: '正在刷新市场日历…', completed: '市场日历已更新', partial: '部分来源失败，保留已有数据', unavailable: '刷新未完成，已有数据可能过期', queryUnavailable: '市场事件读取受限', settings: '管理 0xRouter 来源', unknownCountry: '未标明国家', consensus: '市场预期', surprise: '预期差', surpriseBeat: '超预期', surpriseMiss: '低于预期', surpriseInline: '符合预期', surpriseUnavailable: '无一致预期', surpriseNotComparable: '预期差不可比', providerPrevious: '前值（0xRouter）', providerActual: '公布值（0xRouter）', comparison: '暂不可比较', source: '0xRouter', observed: '来源观测时间', time: '发布时间', more: '更多市场事件', kinds: { 'economic-indicator': '经济指标', 'financial-event': '财经事件', 'central-bank-activity': '央行活动' }, statuses: { success: '已采集', 'success-empty': '本次无事件', 'all-skipped': '解析受限', partial: '部分事件可用', unavailable: '尚无可用批次', 'no-locale-rows': '来源未提供英文条目' } },
            eventStatus: { label: '发布进度', 'data-received': '数据已获取', upcoming: '未到发布时间', 'awaiting-data': '待发布', 'storage-limited': '存储受限', 'time-pending': '时间待定', 'elapsed-unconfirmed': '计划时间已过', cancelled: '已取消' },
            workspaceLabel: '— MACRO / ECONOMIC CALENDAR',
            title: '经济日历',
            info: '日历说明',
            month: '当前月份',
            monthNavigation: { previous: '上个月', next: '下个月', current: '回到本月', picker: '选择月份' },
            status: { loading: '正在加载经济日历…', empty: '本月没有任何事件。', noSourceEnabled: '日历来源都没有启用' },
            /* 来源没有读者当前语言的内容：这是「没有这种语言」，不是「本月没有事件」。
               它画在月区的说明行里，不进空态（产品 2026-11-09：空态只属于「都读到了、都为空」）。 */
            noLocaleRowsNote: '这几类日历来源只提供中文条目；本月没有可显示的英文内容。',
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
            details: { title: '事件详情', category: '类别', period: '统计周期', source: '来源', time: '发布时间', importance: '重要性', state: '状态', actual: '实际值', previous: '前值', valueNotYet: '尚未公布', valueNotProvided: '源未给出', consensusMissing: '预期值未提供', consensusUnreadable: '暂时读不到', consensusUnreadableReason: '已有观测，但预期字段为空（数据缺口）。', consensusReadFailedReason: '这次没有读到市场观测（读取失败），不是没有预期。', consensusFromMarket: '预期来自市场源', scheduledDateOnly: '官方未公布具体时间', timeNotPublished: releaseTimeWords['zh-CN'], timeNotPublishedReason: '这一场官方没有公布发布时间，所以这里不显示具体时刻。不是我们没读到。', editedTime: '已编辑',
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
              /* 置灰的刷新键自己的行内句：为什么不能刷新、什么时候能好。
                 完整原因码不进正文（读者的说法在这里，码在键旁那颗 ⓘ 里）。 */
              blocked: '暂时不能刷新：官方站点拒绝了当前网络。恢复时间未知。',
              reasonCodeAria: '原因码',
              updated: '已刷新对应完整 BLS 发布组的数据。', unchanged: '对应完整 BLS 发布组的数据已是最新。', unavailable: '对应完整 BLS 发布组的官方数据暂不可用，未保存任何值。'
            },
            blsScheduleSync: {
              schedule: { updated: 'BLS 日程已更新', unchanged: 'BLS 日程已是最新', unavailable: 'BLS 日程暂不可用' },
              cpi: { updated: 'CPI 值已更新', current: 'CPI 值已是最新', 'not-required': 'CPI 暂无需补抓', unavailable: 'CPI 值暂不可用' },
              employment: { updated: '就业值已更新', current: '就业值已是最新', 'not-required': '就业暂无需补抓', unavailable: '就业值暂不可用' }
            },
            recordTimes: {
              // 两行只写字段名与值：说明（「不是发布时间」之类）归 ⓘ，不进正文。
              createdAt: '创建时间',
              actualDetectedAt: '实际值获取时间'
            },
            fomcRefresh: {
              publishedAt: '官方公布时间', retained: '刷新失败，显示上次官方值',
              action: '获取官方值',
              confirm: '获取', cancel: '取消',
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
          sourceFreshness: '来源最近更新时间',
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
            fearGreedTitle: '恐惧与贪婪指数',
            fearGreedNotCollected: '未采集',
            collectionStates: {
              healthy: '健康',
              degraded: '部分可用',
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
          fearGreed: '恐惧与贪婪指数',
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
            degraded: '部分可用',
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
macroCalendar: macroCalendarText['zh-CN'],
intelligenceSources: intelligenceSourcesText['zh-CN']
    }
  },
  'en-US': {
mi: miText['en-US'],
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
          sampleMode: {
            watermark: 'SAMPLE DATA',
            banner: {
              title: 'Sample mode',
              replay: 'Real historical data · replayed offline',
              scenario: 'Scenario time {time} (not now)',
              noUpdate: 'Does not update',
              exit: 'Exit sample',
              connect: 'Connect real data'
            }
          },
          dailyBriefingGeneratedBanner: {
            title: 'Today’s brief is ready',
            generatedAt: 'Generated at {time}',
            pendingTitle: 'Today’s brief is not generated yet',
            pendingHint: 'Open the daily brief to generate it',
            dismiss: 'Got it'
          },
          moduleLabel: 'MARKET INTELLIGENCE / AGENTS',
          /**
           * "Could not read it" and "there is nothing configured" are two different facts.
           * No source configured is the reader's job (configure in settings); a failed read is
           * ours (try again). One shared sentence would leave the reader guessing which to do.
           */
          data: {
            temporarilyUnavailable: 'Temporarily unavailable',
            drawerUnavailable: 'This data is temporarily unavailable — it is not missing from your setup',
            retry: 'Try again',
            sourcesNotConfigured: 'No source configured yet',
            sourcesNotEnabled: 'The source is off',
            configureSources: 'Configure in settings',
            enableSources: 'Enable in settings'
          },
          agents: {
            crypto: { name: 'Crypto Market Analyst', lens: 'CRYPTO MARKET LENS', sourceSummary: '7 static intelligence sources' },
            stocks: { name: 'Equities Market Analyst', lens: 'EQUITIES MARKET LENS', sourceSummary: 'Sources pending' },
            futures: { name: 'Futures Market Analyst', lens: 'FUTURES MARKET LENS', sourceSummary: 'Sources pending' }
          },
          states: { available: 'Configure activation', comingSoon: 'Coming soon' },
          sourceSummary: { count: '{count} static sources', pending: 'Sources pending' },
          actions: { activate: 'Configure and activate', openDashboard: 'Open dashboard', unavailable: '—' },
          activation: {
            states: { unactivated: 'Not activated', 'waiting-data': 'Preparing data', active: 'Active', sample: 'Sample' },
            progress: 'Enabled {enabled}/{total}',
            actions: { configure: 'Configure activation', progress: 'View activation', open: 'Open dashboard', openSample: 'Open sample dashboard', sampleSwitch: 'Sample mode' },
            previewHint: 'Real historical data replayed offline; exit anytime, writes nothing.',
            drawer: {
              title: 'Activate the crypto analyst',
              subtitle: 'Enable every source below; sample mode stays available after activation.',
              capabilitiesTitle: 'Required capabilities',
              capabilities: { market: 'Market data', sentiment: 'Market sentiment', funding: 'Funding rates' },
              capabilityStates: { missing: 'Not enabled', enabled: 'Waiting for data', ready: 'Ready' },
              groupsTitle: 'Sources',
              tiers: { required: 'Required', recommended: 'Recommended', optional: 'Optional' },
              pending: 'Pending',
              enableRecommended: 'Enable all sources',
              enabling: 'Enabling…',
              failed: 'Enabling failed. Try again.',
              close: 'Close'
            }
          },
          analysisWorkspace: {
            openAgent: 'Full Agent panel', stop: 'Stop', approvalRequired: 'Waiting for tool approval. Open the full Agent panel to review, or stop this run.',
            title: 'Crypto analysis Agent', chat: 'Analysis conversation', dashboard: 'Market dashboard', view: 'Switch workspace', selectedAnalysis: 'Selected analysis is bound', selectedEvent: 'Selected event', selectedNews: 'Selected news', contextAnalysis: 'Quoted analysis',
            newConversation: 'Market analysis conversation', newChatAction: 'New chat', sessionHistory: 'History', deleteSession: 'Delete chat', deleteSessionConfirm: 'Delete this conversation?', cancel: 'Cancel', noSessions: 'No conversations yet', untitledSession: 'Untitled session', loading: 'Loading Agent…', noSelection: 'Current market · Select a timeline entry to follow up', clearSelection: 'Current market',
            empty: 'Ask the analyst a question or select an analysis below.', input: 'Your question', placeholder: 'What market changes would you like to understand?', followUpPlaceholder: 'Ask about the selected analysis…',
            send: 'Send', sending: 'Analyzing', resize: 'Resize calendar and sentiment', failed: 'Send did not complete. Check the conversation and model configuration before retrying.', modelRequired: 'Select an available model for the crypto analyst in the shared Agent settings.',
            roles: { user: 'You', assistant: 'Market analyst', system: 'System' }, messageStates: { pending: 'Processing', error: 'Run failed', paused: 'Paused' },
            closeDetail: 'Close details', detailUnavailable: 'Details for this entry are unavailable.', readTrace: 'Last read', conclusionBlocks: { change: 'What changed', 'causal-chain': 'Causal chain', condition: 'Premises', macro: 'Macro', evidence: 'Evidence strength', 'data-gap': 'Data gaps' }, changeFacts: 'Fields that changed', changeStructural: 'Structural changes', changeDomainAdded: 'Missing domains added', changeDomainRemoved: 'Missing domains resolved', changeCaveatAdded: 'Data caveats added', changeCaveatRemoved: 'Data caveats cleared', changeEvidenceAdded: 'Evidence added', changeEvidenceRemoved: 'Evidence removed', changeObservationsAdded: 'Observations added', changeObservationsRemoved: 'Left the window',
            changeSummary: 'What changed', noChange: 'No new change since the previous read.', latestConclusion: 'Latest AI conclusion', latestConclusionHint: 'Select a timeline entry below to read that entry in full on the left; the current binding is unchanged.', latestConclusionEmpty: 'No published AI conclusion yet. Start the first analysis from the timeline below.', latestConclusionLoading: 'Reading the latest AI conclusion…', latestConclusionUnavailable: 'The latest conclusion is unavailable. Try again later.', openDetail: 'Read in full',
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
                'etf-net-flow-usd': 'ETF net flow', 'etf-net-flow-5d-usd': 'ETF 5-day cumulative net flow', 'etf-net-flow-20d-usd': 'ETF 20-day cumulative net flow', 'funding-rate-percent': 'Funding rate', 'fear-greed-index': 'Fear & Greed',
                'open-interest-notional-usd': 'Binance perpetual notional open interest', 'open-interest-change-24h-pct': 'Open interest 24h change', 'positioning-state': 'Positioning and funding state',
                'divergence-escalation': 'Divergence set needing explanation', 'divergence-liquidity-leverage': 'Divergence: money shrinking while shorts build', 'divergence-flows-price': 'Divergence: spot outflow with price holding', 'divergence-narrative-price': 'Divergence: bearish news not priced',
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
                'policy-next-meeting-date': 'Next meeting date', 'policy-implied-probability': 'Market-implied probability for the next meeting',
                'policy-implied-probability-change-24h': 'Probability 24-hour change', 'policy-target-range': 'Policy target range',
                'policy-sep-median-current-year': 'SEP current-year median', 'policy-sep-median-path': 'SEP median path',
                'policy-last-decision-vote': 'Last decision vote',
                'event-name': 'Event', 'lifecycle-state': 'Lifecycle', 'scheduled-date': 'Scheduled date', 'scheduled-at': 'Scheduled time',
                'official-release-date': 'Official release date', actual: 'Actual', previous: 'Previous', consensus: 'Consensus', surprise: 'Surprise (actual − consensus)', 'event-excerpt': 'Event excerpt', 'news-sentiment': 'News sentiment'
              },
              subject: {
                stablecoins: 'Stablecoins', BTC: 'BTC', ETH: 'ETH', market: 'Market', all: 'All', 'btc-vs-eth': 'BTC vs ETH',
                'consumer-price-index': 'Consumer price index', 'employment-situation': 'Employment situation', fomc: 'FOMC',
                pce: 'PCE', 'core-pce': 'Core PCE', gdp: 'GDP',
                'economic-indicator': 'Economic indicator', 'financial-event': 'Financial event', 'central-bank-activity': 'Central bank activity',
                'usd-index': 'Dollar index', gold: 'Gold', 'us-treasury': 'US Treasury rates',
                'no-change': 'No change', 'hike-25': 'Hike 25bp', 'hike-50-plus': 'Hike 50bp or more',
                'cut-25': 'Cut 25bp', 'cut-50-plus': 'Cut 50bp or more'
              },
              // 唯一 owner 见文件头 `registeredEventNames`。
              eventName: registeredEventNames['en-US'],
              lifecycleState: { scheduled: 'Scheduled', released: 'Released', cancelled: 'Cancelled' },
              positioningState: {
                'deleveraging': 'Deleveraging · longs cutting', 'short-crowded': 'Shorts crowded', 'long-crowded': 'Longs crowded',
                'refilling': 'Refilling · not crowded', neutral: 'Neutral', mixed: 'Mixed'
              },
              comparability: { comparable: 'Comparable', 'not-comparable': 'Not comparable' },
              caveat: {
                'max-items-truncated': 'Evidence count truncated', 'source-health-unavailable': 'Source health unavailable', 'query-unavailable': 'Query unavailable',
                'query-empty': 'Query returned nothing', 'evidence-unavailable': 'Evidence unavailable', 'not-comparable': 'Not comparable with other data',
                'news-sentiment-unavailable': 'News sentiment unavailable',
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
                'macro-rates-mixed-observation-dates': 'Two daily series disagree on the observation date; no difference stated',
                'policy-path-unavailable': 'Policy-path data unavailable', 'policy-path-facts-truncated': 'Policy-path facts truncated',
                'policy-path-24h-change-unavailable': '24-hour probability change not available yet', 'policy-path-sep-unavailable': 'SEP median unavailable',
                'policy-path-target-range-unavailable': 'Policy target range unavailable', 'policy-path-source-url-invalid': 'Policy-path source link invalid',
                'odds-are-market-pricing': 'Prediction-market pricing, not an official expectation', 'projections-from-latest-sep-meeting': 'SEP belongs to the latest publishing meeting'
              },
              term: { consensus: 'Market consensus', actual: 'Actual', previous: 'Previous', stablecoins: 'Stablecoins' }
            }
          },
          calendarCard: {
            title: 'What to watch', todaySection: 'Recently released, value moved', upcomingSection: 'Upcoming',
            empty: 'No high-importance events in the next 7 days', unavailable: 'Calendar data is unavailable', refresh: 'Refresh',
            loading: 'Reading the calendar…', staleNotice: 'The latest read did not finish; these are the previous readings.',
            releasedEmpty: 'No released events in the last {days} days.',
            awaitingData: 'Scheduled time has passed; waiting for the value',
            reactionHint: 'Relative change in the 30 minutes around the release (not a causal claim)',
            dxy: 'DXY',
            // The card's left rail is 84px wide. These are shorter than the calendar page's labels:
            // "Economic indicators" overflowed the rail and the card's `overflow: auto` cut the
            // tag's first letters off in English.
            categories: { 'economic-indicator': 'Indicator', 'financial-event': 'Financial event', 'central-bank-activity': 'Central bank' },
            openCalendar: 'Open the economic calendar', switchToAgent: 'Switch to the market agent', switchToCalendar: 'Switch to the calendar card',
            openEventInCalendar: 'Open {name} in the calendar',
            collapseAgent: 'Collapse the agent', expandAgent: 'Open the market agent', closeAgent: 'Close', agentTitle: 'Market agent', clearConversation: 'Clear', copyEvent: 'Copy {name}', eventContext: { heading: 'Selected event', state: 'State', released: 'Released', upcoming: 'Not yet released', cancelled: 'Cancelled', missing: 'not published', related: 'Same hour', factsHeading: 'Facts held now', factsUnavailable: 'Nothing is held for this event; do not infer from that', factsPartial: 'These facts are incomplete; name what is missing', factsEvidence: 'Evidence' }, importanceHigh: 'High importance', timePending: 'Time TBD',
            surprise: { beat: 'Above expectation', miss: 'Below expectation', inline: 'In line', unavailable: 'No consensus', notComparable: 'Surprise not comparable' }
          },
          analysisTimeline: {
            retryAnalysis: 'Retry analysis', attemptFailed: 'Last analysis was not published',
            failureReasons: { 'analysis-invalid-output-schema': 'Model output did not match the required format. Retry.', 'analysis-invalid-json': 'The model reply was not valid JSON (it may have been cut off), so it was not published. Retry.', 'analysis-missing-evidence': 'The analysis output did not match the frozen evidence, so it was not published. Retry; if it keeps failing, check sources.', 'analysis-provider-not-ready': 'Model is not ready. Check model settings.', 'analysis-provider-error': 'Model invocation failed. Check the connection and retry.', 'analysis-timeout': 'Model invocation timed out. Retry.', 'analysis-cancelled': 'The analysis was interrupted (app closed or task cancelled). Retry.' },
            triggerStatus: { label: 'Latest decision', since: 'since', slotOpen: 'open ', slotDelayed: 'caught up late', reasons: { 'significance-confirmed': 'Data changed significantly; analysis started', 'significance-below-threshold': 'No significant change; not analysed', 'provider-surprise-confirmed': 'A provider calendar release landed far from the market expectation (not an official value); analysis started', 'semantic-no-op': 'Identical to last time; not analysed', 'interval-active': 'Less than 30 minutes since the last analysis; coalesced', 'same-release-coalesced': 'Another indicator from the same release was already analysed; this one did not run again', 'same-release-abandoned': 'The analysis for this release did not succeed and its one retry is used up; this indicator was not analysed separately', 'hour-budget-exhausted': 'Hourly analysis limit reached', 'day-budget-exhausted': 'Daily analysis limit reached', 'global-day-budget-exhausted': 'Overall daily analysis limit reached', 'schedule-reserve-exhausted': 'Session-slot allowance used up for today', 'session-slot-asia': 'Asian open analysis (08:00)', 'session-slot-europe': 'European open analysis (16:00)', 'session-slot-us': 'US open analysis (24:00)', 'invalid-significance-input': 'Decision input was invalid; not analysed', 'manual-request': 'You triggered it from the panel', 'severity-confirmed': 'High-importance intelligence; analysis started', 'medium-score-confirmed': 'Mid-level intelligence crossed the threshold; analysis started', 'market-reaction-confirmed': 'A comparable market reaction was confirmed; review started', 'restart-initial-compensated': 'First analysis re-run after a process restart', 'restart-review-compensated': 'Review re-run after a process restart', 'signal-high-triggered': 'A rule fired; analysis started', 'signal-medium-triggered': 'A rule fired; analysis started', 'signal-cooldown-active': 'The same rule was just analysed; skipped this time', 'signal-low-marker-only': 'Marked on the panel only; no separate analysis', 'signal-calendar-owned': 'The macro calendar already covers this; not analysed twice', 'signal-freeze-unavailable': 'The analysis could not be queued; it did not run' } },
loadMore: 'Load more', selectEntry: 'Select a timeline entry to view details.',
            // The list spans event groups: on one screen each row says which event it belongs to,
            // so two conclusions seconds apart do not read as the same one posted twice.
            groupTypes: { macro: 'Macro', 'market-reaction': 'Market reaction', capital: 'Capital flows', sentiment: 'News', funding: 'Funding', 'cross-asset': 'Cross-asset' },
            settings: 'Settings', settingsTitle: 'AI analysis settings', analysisEnabled: 'Enable AI analysis',
            analysisEnabledHint: 'When off, nothing is analysed automatically and no model is called.', analysisModel: 'Analysis model', modelFollowDefault: 'Follow the default assistant model', followsDefaultPrefix: 'Following default: ',
            enableAnalysis: 'Enable AI analysis', analysisOffHint: 'AI analysis is off. Published analyses are kept; new ones start once it is enabled.',
            refusalModelUnconfigured: 'No usable default assistant model. Choose an analysis model first.', refusalModelUnavailable: 'That model cannot be called right now. Pick another one.',
            refusalFailed: 'Could not save. Retry.', saving: 'Saving…', save: 'Save', cancel: 'Cancel',
            entry: 'Message analysis / timeline', description: 'Review published summaries, predictions, and evidence coverage',
            workspaceLabel: '— MARKET ANALYSIS', title: 'AI intelligence analysis', back: 'Back to Agents', loading: 'Loading message analysis…', unavailable: 'Analysis detail is unavailable.', empty: 'No published message analysis yet.', requestInitialAnalysis: 'Generate first analysis', refreshAnalysis: 'Analyze now', initialAnalysisQueued: 'First analysis queued; this panel updates when it finishes.', initialAnalysisUnavailable: 'No eligible published intelligence is available for analysis.', initialAnalysisFailed: 'The first-analysis job failed to start. Refresh and try again.', analysisRefreshAlreadyAvailable: 'The latest analysis is already available.', analysisStillRunning: 'The analysis is still running. Stopped waiting; it will appear here when it finishes.', analysisRefreshFailed: 'The re-analysis request did not go through. Try again.', analysisServiceNotReady: 'The analysis service is still starting up. Try again shortly.', timeline: 'Analysis timeline', detail: 'Analysis detail', dismissError: 'Dismiss message',
            eventGroup: 'Event group', analysisRun: 'Analysis run', summaryVersion: 'Summary version', evidenceCount: 'Evidence count', asOf: 'As of', dataCutoff: 'Data limits', conclusion: 'AI conclusion', confirmedFacts: 'Confirmed facts', transmission: 'Transmission view', marketReaction: 'Market reaction', noMarketReaction: 'No comparable market evidence is available; direction is not judged.', supportingEvidence: 'Supporting evidence', counterEvidence: 'Counter-evidence', catalysts: 'Next catalysts', auditInfo: 'View audit information', prediction: 'Predictions', noPrediction: 'This summary has no predictions.', conditions: 'Conditions', invalidation: 'Invalidation', verificationDue: 'Verification due', agentUnavailable: 'The follow-up Agent will be enabled in the next phase.',
            status: { published: 'Published', stale: 'Stale', superseded: 'Superseded', pending: 'Pending', confirmed: 'Confirmed', 'partially-confirmed': 'Partially confirmed', invalidated: 'Invalidated', expired: 'Expired', 'insufficient-data': 'Insufficient data' }
          },
          newsSentiment: {
            title: 'Key sentiment',
            // The query returns at most 100 rows, so the window names its cap instead of saying "All".
            windowAll: 'Latest 100',
            loading: 'Loading news sentiment…',
            unavailable: 'News sentiment is unavailable.',
            staleRead: 'The refresh failed; the readings below are from the last successful read.',
            retry: 'Retry',
            refresh: 'Refresh',
            labels: { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral', mixed: 'Mixed' },
            engine: { model: 'Model', rules: 'Rules' },
            neutralFilter: { label: 'Neutral', all: 'With neutral', exclude: 'Without neutral' },
            // Accessible name only (aria-label) for the two whole-row actions; it never appears on screen.
            openItem: 'Open this story: {title}',
            updatedAt: 'Updated {time}',
            settings: 'Sentiment settings',

            drawer: {
              title: 'News sentiment',
              filters: { direction: 'Direction', source: 'Source', scope: 'Scope', all: 'Any' },
              scope: { market: 'Market', BTC: 'BTC', ETH: 'ETH' },
              columns: { time: 'Time', title: 'Title', polarity: 'Direction', source: 'Source', symbols: 'Symbols' },
              detail: { evidence: 'Evidence quote', translated: 'Translation', strength: 'Strength', confidence: 'Confidence', strengthLevels: { weak: 'low', medium: 'medium', strong: 'high' }, body: 'Body excerpt', noBody: 'Judged from the headline and summary only', translatingBody: 'Translating body…', translationFailed: 'Body translation failed; showing the original.', translateBody: 'Translate body', engine: 'Engine', prompt: 'Prompt', original: 'Original', openOriginal: 'Open original' },
              emptyFiltered: 'No items match these filters.',
              moreActions: 'More actions',
              translationStatus: { waiting: 'Waiting', queue: 'Translating {done}/{total}', translating: 'Translating', translated: 'Translated', failed: 'Failed', contextMenu: 'Right-click for actions', translateOne: 'Translate this item', retranslateOne: 'Retranslate' },
              clearFilters: 'Clear filters',
              loadMore: 'Load more',
              settings: 'Settings'
            },
            availability: {
              missing: 'No sources configured yet',
              disabled: 'Sources are off',
              unreadable: 'Temporarily unavailable',
              actionConfigure: 'Configure',
              actionEnable: 'Enable',
              actionRetry: 'Try again',
              reasonAria: 'Why this is shown',
              reasonMissing: 'None of the four news sources is configured.',
              reasonDisabled: 'All four news sources are switched off; turn one on to see items here.',
              reasonFailed: 'All four news sources are on, but this collection failed.',
              reasonNeverRan: 'All four news sources are on, but none has run yet.'
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
              rebuiltWithCopy: 'The old store was kept as an unmodified copy and a new one is ready. Refresh this page to start using it.',
              retryTranslation: 'Translate all missing', translateAll: 'Translate all', cancelTranslate: 'Cancel translation', translating: 'Translating…', translationQueued: 'Translation retry queued. Refresh once it finishes.', translationRetryFailed: 'Could not queue the translation retry.',
              save: 'Save',
              cancel: 'Cancel',
              saved: 'Saved',
              failed: 'Could not save'
            }
          },
          analysisDrawer: { title: 'Analysis timeline', open: 'Analysis timeline', close: 'Close' },
          dashboard: {
                        signalAnalysis: {
              label: 'Analysis progress',
              states: {
                published: 'The analysis is out; read it in the timeline',
                skipped: 'Not analysed this time',
                failed: 'Analysed but did not succeed'
                // No `stopped` line: that branch returns the reason sentence directly, so an outer
                // status sentence would never reach the screen.
              },
              offByReader: 'You turned auto-analysis off, so this signal will not be analysed automatically',
              stoppedReasons: {
                'run-cancelled': 'This run was cancelled',
                'run-superseded': 'A newer run replaced this one; nothing to wait for',
                'run-unrecognized': 'The state of this run could not be read',
                'run-expired': 'This analysis ran, but it is past the retention period, so the result cannot be seen'
              },
              reasonUnknown: 'Reason not recorded',
              separator: ': '
            },
            workspaceLabel: '— CRYPTO INTELLIGENCE',
            title: 'Crypto market checklist',
            description: 'Read capital, macro, crypto risk appetite, then leverage. Keep partial when coverage is missing; do not fill it as neutral.',
            /** The ⓘ beside the title: the sentence is `description`, this is only its short name. */
            descriptionLabel: 'How to read this board',
            configureSources: 'Configure intelligence sources',
            configDrawer: {
              title: 'Settings',
              /** 抽屉某屏渲染崩了：这一块没能显示（不是「读取失败」，读者没做任何动作）。 */
              screenCrashed: 'This part could not be shown. Try again.',
              sourceUnavailable: 'Not available (see details)',
              unreadable: 'Could not read',
              discard: {
                title: 'You have unsaved changes. Discard them?',
                body: 'Closing now keeps none of the unsaved edits.',
                confirm: 'Discard changes',
                cancel: 'Keep editing'
              },
              values: {
                save: 'Save',
                saving: 'Saving…',
                autoUnknown: 'Unknown',
                autoUnknownReason: 'Whether the schedule is registered could not be read',
                modelFollowsDefault: 'Follows the platform default model',
                modelServiceConfigured: 'Configured',
                modelServiceUnconfigured: 'Not configured',
                autoOn: 'On',
                autoOff: 'Off',
                sentimentRuleOnly: 'Rules only',
                sentimentFollowsFastModel: 'Follows the fast model',
                sentimentUnknownReason: 'The scoring model settings could not be read'
              },
              openModelService: 'Open model service',
              scopeGlobal: 'Global',
              processingEntryAria: 'Open content processing settings (translation preferences, sentiment scoring)',
              processingEntryHint: 'Translation preferences · Sentiment scoring',
              menus: {
                sources: 'Data sources', sourcesData: 'Collection and data', processing: 'Content processing', analysis: 'AI analysis',
                briefing: 'Daily briefing', notifications: 'Notifications', runLog: 'Run log'
              },
              groups: {
                thisSource: 'This source',
                status: 'Status',
                policy: 'Collection policy',
                sentimentScoring: 'Sentiment scoring'
              },
              rows: {
                enabled: 'Enable',
                capabilities: 'Capabilities and credentials',
                policyNote: 'Who runs collection',
                sentimentModel: 'Which model',
                sentimentModelSwitch: 'Use a model to judge sentiment',
                analysisSwitch: 'Analysis',
                analysisModel: 'Analysis model',
                publishAt: 'Generation time',
                window: 'Statistics window',
                editions: 'Editions per run',
                briefingModel: 'Briefing model',
                briefingLanguages: 'Edition languages',
                autoGeneration: 'Auto-generation',
                channels: 'Channel event alerts',
                pushStrength: 'Minimum strength',
                calendar: 'Calendar alerts',
                leadTime: 'How early',
                importance: 'Importance',
                landedFilter: 'Notification condition',
                countries: 'Countries with data',
                reach: 'Delivery',
                masterSwitch: 'Master switch',
                timeZone: 'Time zone',
                language: 'Language',
                theme: 'Display style',
                proxy: 'Proxy mode',
                sourcesEnabled: 'Enabled',
                preset: 'Collection preset',
                healthBadge: 'Health',
                apiKey: 'API key',
                capabilityBoard: 'Dashboard capability',
                capabilityCalendar: 'Calendar capability',
                testConnection: 'Test connection',
                runNow: 'Run now',
                sourceFields: 'Source-specific fields',
                focusMarkets: 'Markets to watch',
                retention: 'Retention and replay',
                syncRuns: 'Run history',
                calendarFeeds: 'Macro calendar feeds',
                autoTranslate: 'Auto-translate',
                targetLocale: 'Target language',
                translationModel: 'Translation model',
                retentionMode: 'Raw archive and retention',
                generationLanguage: 'Generation language',
                aiEditing: 'Use AI editing',
                aiBackfill: 'Allow follow-up for missing conclusions',
                modelServiceJump: 'Model service',
                notificationJump: 'Notifications',
                notifyEvents: 'Intelligence event subscriptions',
                notifyEventSignal: 'Signal fired',
                notifyEventBriefing: 'Briefing ready',
                notifyEventSentiment: 'Sentiment',
                notifyEventCalendar: 'Calendar',
                notifyTiers: 'Four alert tiers',
                quietHours: 'Quiet hours',
              }
            },
            signalRead: {
              'query-failed': 'We could not check whether this signal has been analysed. The numbers above are unaffected.',
              'invalid-as-of': 'We could not check, at this instant, whether this signal has been analysed. The numbers above are unaffected.',
              'contract-invalid': 'We could not check whether this signal has been analysed (this does not mean it was not). The numbers above are unaffected.',
              ariaLabel: 'Could not check whether this signal has been analysed; the numbers are unaffected',
            },
            crossAsset: {
              title: 'Nasdaq 100 / QQQ proxy × BTC × ETH', subtitle: 'Binance QQQUSDT, the tokenised perpetual proxy (24/7, default, labelled “Proxy”); the real Nasdaq 100 index (USTEC, US cash session) answers only when that leg cannot',
              chart: 'Common-anchor returns',
              rangeLabel: 'Return window',
              ranges: { '1h': '1H', '24h': '24H', '7d': '7D' },
              hintAnalysis: 'Closed data through {time}',
              hintCoverage: 'History coverage {coverage}',
              hintCorrelations: '{correlations} · samples {indexBtc} · {indexEth}',
              hintListSep: ' · ',
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
              enableData: 'Enable data', refresh: 'Update history', loading: 'Loading market data…', unavailable: 'Market data unavailable',
              quoteLeg: { missing: 'Live quote not connected', stale: 'Live quote out of date' },
              quoteLegReasons: { missing: 'No trade for this asset arrived on the live trade stream (the stream may not be connected).', stale: 'The last trade is more than 15 seconds old, so the live quote counts as out of date.' },
              lineNotDrawn: 'not drawn',
              lineNotDrawnReason: 'A line needs five-minute bars at every point in this window; this stretch is not complete, so the line is not drawn.',
              staleRead: 'The refresh failed; the readings below are from the last successful read.',
              // Condition ①: say that a restart is what makes it take effect, and how to restart.
              contractMismatch: 'The interface and the main process are running different versions, so this data cannot be read. A restart is what makes it take effect: press “Restart the app” below, or quit the app completely and open it again; reloading the page is not enough.',
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
              // Two readings of the same table that belong in one sentence; ` · ` is part of the copy.
              dailySpreadAndInflation: 'Term spread {spread} · Inflation expectation {inflation}% (as of {date})',
              dailySpreadOnly: 'Term spread {spread}',
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
                  'window-not-judged': 'This window is not interpreted: the correlation is always the 24-hour one — switch back to 24H',
                  'legs-missing': 'Not enough data to judge: {leg} has no value in this window',
                  stale: 'Not enough data to judge: {leg} stopped updating',
                  'no-match': 'No recognisable combination: these lines do not fit any of the five scenarios'
                },
                notices: {
                  'index-proxy': 'the index leg is the tokenised proxy', 'dxy-synthetic': 'the dollar is a synthetic index', 'gold-synthetic': 'gold is a synthetic quote'
                }
              },
              statusReads: { dxy: 'A rising dollar is a crypto headwind', gold: 'Falling with BTC = discount-rate driven', us10y: 'Nominal cost of money', realRate: 'The most direct link to BTC', index: 'Risk appetite', btc: 'Two natures: risk and liquidity', eth: 'Follows BTC with more beta' },
              btcIndex: 'BTC − Nasdaq 100 · 1h', ethBtc: 'ETH − BTC · 1h', pp: 'pp', unit: 'USDT', samples: 'Samples', coverage: 'History coverage',
              states: { disabled: 'Disabled', connecting: 'Connecting', live: 'Live', stale: 'Delayed', limited: 'Resource limited', unavailable: 'Unavailable', missing: 'No data' },
              liveStateLabels: { disabled: 'Disabled', connecting: 'Connecting', live: 'Live', stale: 'Delayed', unavailable: 'Live unavailable' },
              liveHint: 'The live price comes from an unclosed price stream; all four windows still use closed bars. Observed at {time}',
              facts: { up: 'Nasdaq 100 and BTC rose over the last hour', down: 'Nasdaq 100 and BTC fell over the last hour', diverging: 'Nasdaq 100 and BTC diverged over the last hour', mixed: 'Nasdaq 100 and BTC directions differ or changes are small', unavailable: 'Insufficient or delayed data; no current assessment' },
              relativeFacts: { stronger: 'ETH outperformed BTC over 1h', weaker: 'ETH underperformed BTC over 1h', flat: 'ETH and BTC matched over 1h', unavailable: 'Insufficient or delayed data; no current assessment' }
            },
            sourceConfiguration: {
              title: 'Configure dashboard sources', close: 'Close', sourceList: 'Dashboard sources', configure: 'Configure in data sources', runNow: 'Run now', provider: 'Provider', readiness: 'Readiness', back: 'Back to sources', pending: 'Pending connection', pendingHint: 'This source is not connected yet and cannot be configured.', openFullSettings: 'Open full settings',
              marketConnection: { funding: 'Funding rates', market: 'Cross-market data', pending: 'Testing', passed: 'Passed', partial: 'Partial', failed: 'Failed', busy: 'Another request is running', limited: 'Rate limited', unavailable: 'Unavailable', rest: 'History', ws: 'Stream', assets: { index: 'QQQ', btc: 'BTC', eth: 'ETH' }, visibility: 'Market data updates live while the dashboard is visible; the collection preset controls funding only.' },
              loading: 'Loading source settings…', unavailable: 'Source settings are unavailable.', enabled: 'Enabled', disabled: 'Disabled', collectionPreset: 'Collection preset', testConnection: 'Test connection', saveFailed: 'Saving failed. Try again.', apiKey: { label: 'API Key', reveal: 'Show API key', hide: 'Hide API key', save: 'Save API Key', emptyHint: 'Enter an API key to save it.', savedHint: 'A credential is saved; enter a new API key to replace it.' }, requestBudget: 'Request budget: {maxRequests} requests / {windowSeconds} seconds',
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
                'policy-path-market': { name: 'FOMC decision market', description: 'Polymarket prices for each outcome of the next FOMC meeting; only derived readings and links are stored.', status: 'Source settings' },
                'twelve-data-market': { name: 'Twelve Data', description: 'Synthetic dollar index (ICE basket), gold, offshore yuan and the stablecoin peg; free tier 8 requests/minute, 800/day.', status: 'Source settings' },
                'realmarketapi-market': { name: 'RealMarketAPI (real DXY)', description: 'The real ICE dollar index (DXY), collected every 5 minutes; falls back to the ICE-basket synthesis when unconfigured or stale.', status: 'Source settings' }
              }
            },
            macroReleaseDynamics: {
              calendarAction: 'Open calendar',
              sourceName: 'Economic Calendar',
              sourceStates: { loading: 'Loading', available: 'Schedule read', empty: 'No schedule this month', unavailable: 'Schedule could not be read' },
              manageSettings: 'Manage macro calendar settings'
            },
            fearGreed: {
              title: 'Fear & Greed',
              loading: 'Loading Fear & Greed Index…',
              empty: 'No collected Fear & Greed observation.',
              score: 'Index score',
              observedAt: 'Observed at',
              sourceName: 'Fear & Greed Index',
              sourceStates: { loading: 'Loading', available: 'Index read', stale: 'Index is old · as of {time}', empty: 'No observation', unavailable: 'Index could not be read' },
              manageSettings: 'Manage Fear & Greed settings',
              buckets: { 'extreme-fear': 'Extreme fear', fear: 'Fear', neutral: 'Neutral', greed: 'Greed', 'extreme-greed': 'Extreme greed' }
            },
            positioning: {
              title: 'Perpetual positioning & funding',
              pairTitle: 'Perpetual positioning & funding · Binance USDT perpetual',
              loading: 'Loading perpetual positioning…',
              empty: 'No collected perpetual positioning observation.',
              unavailable: 'Perpetual positioning is unavailable.',
              contractMismatch: 'This data comes from another version of the app, so it cannot be read here. Quit the app completely and open it again to recover; reloading the page is not enough.',
              observedAt: 'Observed at',
              newestReading: 'latest reading',
              stale: 'stale',
              staleSuffix: ' · {stale}',
              missingValue: '—',
              notional: 'Notional open interest',
              rateLabel: 'Funding rate · 8h',
              oiShort: 'OI',
              rateShort: 'rate',
              settledAt: 'Rate settled at',
              legendLine: 'line = notional open interest',
              legendBar: 'bars = 8h funding rate',
              sourceMissing: 'No source configured yet',
              sourceDisabled: 'The source is not enabled ({source})',
              sourceUnreadable: 'Temporarily unreadable',
              actionConfigure: 'Configure',
              actionEnable: 'Enable',
              actionRetry: 'Try again',
              enableData: 'Enable data',
              sourceReasonClock: 'The device clock is not valid, so the read has no instant.',
              sourceReasonQuery: 'The request returned nothing this time.',
              sourceReasonLabel: 'Why the read failed',
              fundingMissingLeg: '{asset} funding-rate history unknown ({reason})',
              fundingMissingReasons: { 'series-missing': 'nothing came back this time', 'value-invalid': 'the value failed its contract' },
              change1h: '1h',
              change24h: '24h',
              window7d: '7 days',
              window24h: '24 hours',
              windowGroup: 'Time window',
              stateWhy: 'Basis: open interest 24h {change}, rate {now} (three 8h periods ago {ago})',
              states: {
                'deleveraging': 'Deleveraging · longs cutting',
                'short-crowded': 'Shorts crowded',
                'long-crowded': 'Longs crowded',
                'refilling': 'Refilling · not crowded',
                'neutral': 'Neutral',
                'mixed': 'Mixed'
              },
              liquidationChip: 'Suspected liquidation {asset} {pct} · vol {multiple}×',
              liquidationChipLong: 'Suspected long liquidation {asset} {pct} · vol {multiple}×',
              liquidationChipShort: 'Suspected short liquidation {asset} {pct} · vol {multiple}×',
              liquidationNoteNoHit: 'Liquidation rule (last 24 hours): no hit.',
              liquidationNoteUnreadable: 'Liquidation read unavailable.',
              liquidationNoteInsufficient: 'Not enough data to judge liquidation this time.',
              liquidationHiddenHits: '{count} more suspected liquidations are not marked on the chart',
              markLong: 'Suspected long liquidation {pct}',
              markShort: 'Suspected short liquidation {pct}',
              markLongMany: 'Suspected long liquidations ×{count}',
              markShortMany: 'Suspected short liquidations ×{count}',
              markMixedMany: 'Suspected liquidations ×{count}',
              signalHover: '{rule} | window {window} | {kind}',
              signalKindInferred: 'inferred',
              window15m: '15 minutes',
              signalDetailsTitle: 'Signal reading',
              signalDetailsRule: 'Rule',
              /** The rule's own words; the internal id never reaches the reader. */
              signalDetailsRuleName: 'Sharp open-interest drop',
              signalDetailsWindow: 'Window',
              signalDetailsDrop: 'Open interest change',
              signalDetailsVolume: 'Volume vs average',
              signalDetailsObservedAt: 'Observed at',
              signalDetailsNote: 'An inferred mark, not exchange liquidation data.',
              /** Four one-look bullets: the popover is a glance, not a document. */
              helpBullets: [
                'The line is notional open interest (hourly), the bars are the funding rate (8-hourly); both cover Binance alone.',
                'A negative rate has two readings: the longs have left, or shorts are piling in. Open interest tells them apart.',
                'A mark means open interest collapsed within 15 minutes on three conditions at once; it is inferred, not exchange liquidation data.',
                'The two lines are scaled to their own ranges, so their heights are not comparable; compare the end readings instead.'
              ],
              /** The longer notes: opened below the card, never inside the bubble. */
              helpDetailsLabel: 'Reading notes',
              helpDetails: [
                'Only a 15-minute collapse is marked, never a slow bleed: during a steady decline no single bucket passes the threshold, so the largest move on the chart often carries no mark at all. Read size from the two lines, speed from the marks.',
                'The “vol 3.4×” on the mark is that 15 minutes against the average of the previous 24 hours of same-length buckets: 1× is ordinary, 2× is the threshold. Quarterly rolls and large position moves also satisfy the three conditions.',
                'Windows: 7 days folds the 15-minute rows to one point per hour; 24 hours keeps the native points.',
                'Six states: open interest 24h ≤ −5% with the rate falling = deleveraging; ≥ +5% with the rate below zero = crowded shorts; ≥ +5% with the rate above +0.03% = crowded longs; ≥ +5% with the rate between zero and +0.03% = refilling; |Δ| < 5% = neutral; anything else is left unlabelled. Hover a label to see the two numbers behind it.'
              ],

              noRate: 'No funding rate in this window',
              sourceName: 'Binance Futures Positioning',
              sourceStates: { loading: 'Loading', available: 'Positioning read', stale: 'Positioning is old · as of {time}', partial: 'Positioning read; funding history has one leg', empty: 'No observation', unavailable: 'Positioning could not be read' },
              manageSettings: 'Manage Binance Futures Positioning settings',
              assets: { btc: 'BTC', eth: 'ETH' },
              paymentDirections: { 'long-pays-short': 'Longs pay shorts', 'short-pays-long': 'Shorts pay longs', neutral: 'Neutral' },
              paymentDirectionsCompact: { 'long-pays-short': 'Longs pay', 'short-pays-long': 'Shorts pay', neutral: 'Neutral' },
              changeArrows: { up: '↑', down: '↓' }
            },
            divergence: {
              title: 'Cross-panel divergence',
              chip: 'Divergence: funding – leverage',
              chipTip: 'Funding–leverage divergence | windows 7 days / 24 hours | observed',
              chipDetailsOpen: 'View data',
              chipDetailsTitle: 'Divergence reading',
              chipFreshLabel: 'Freshness',
              chipFresh: 'within its freshness window',
              chipAsOf: 'as of {at}',
              chipWhyLabel: 'Why this counts as a divergence',
              chipWhy: 'Stablecoins falling over 7 days, open interest rising over 24 hours, and funding negative: all three must hold.',
              helpLabel: 'How this card is produced',
              withheldGroup: ' ({count} pairs)',
              withheldListSep: ', ',
              labelSep: ': ',
              missingValue: '—',
              unavailableTrace: 'Divergence reading unavailable',
              loading: 'Comparing the three pairs…',
              empty: 'None of the three pairs diverged today: money, leverage and price point the same way.',
              unavailable: 'Cannot compare right now: the figures needed did not arrive together, so no conclusion today.',
              withheldTitle: 'Not compared',
              withheldReasons: {
                'window-mismatch': '{leg} covers a different day (data as of {at})',
                'leg-missing': '{leg} was not collected',
                'leg-stale': '{leg} is too old',
                'leg-unavailable': 'reading {leg} failed, which is not the same as no data'
              },
              sentimentNoScoredItems: '{leg}: no headline took a side today',
              legAsOf: '{leg} as of {at}',
              legs: {
                stablecoin: 'Stablecoins 7d', etf: 'ETF net flow 3d', 'open-interest': 'Open interest 24h',
                funding: 'Funding', price: 'Price 24h', sentiment: 'Bearish share'
              },
              /** The one-line summary on the card: five states, verbatim (design v2, 2026-11-08). No final stop. */
              summary: {
                divergence: 'One pair points in opposite directions today',
                quiet: 'Funding, leverage and price all point the same way today; no divergence',
                divergenceWithheldOne: 'One pair points in opposite directions today; one pair could not be judged: {reason}',
                divergenceWithheldMany: 'One pair points in opposite directions today; {count} pairs could not be judged',
                quietWithheldOne: 'Funding, leverage and price all point the same way today; one pair could not be judged: {reason}',
                quietWithheldMany: 'Funding, leverage and price all point the same way today; {count} pairs could not be judged',
                allWithheld: 'None of the three pairs could be judged today'
              },
              notes: [
                'Fixed thresholds, no model: the same numbers always read the same way; a pair shows only when two readings point opposite ways.',
                'Conflicting directions, or a leg right on its threshold, get marked and explained by the AI summary on the right.',
                "Sentiment is a model's label on headlines (share of bearish among those that took a stance in 24h), not exchange data.",
                'Readings are aligned first: a daily figure older than 36h, or a leg lagging its own cadence, gets no verdict — the row says which leg.'
              ],
              detailTitle: 'This reading',
              legNames: {
                stablecoin: 'Stablecoins', etf: 'ETF', 'open-interest': 'Open interest',
                funding: 'Funding', price: 'Price', sentiment: 'Sentiment'
              },
              boundAtLeast: 'rule ≥ {threshold}',
              boundAtMostNegative: 'rule ≤ {threshold}',
              boundAtMostAbsolute: 'rule: within {threshold}',
              directions: { bearish: 'Bearish', bullish: 'Bullish' },
              /** The observed state's neutral label: bad news, price unmoved. Not a direction colour, so its own key. */
              observedLabel: 'Bad news, price unmoved',
              invalidationLabel: 'Invalidated by',
              pairNames: { 'liquidity-leverage': 'Money × shorts', 'flows-price': 'Spot × price', 'narrative-price': 'Narrative × price' },
              pairs: {
                'liquidity-leverage': {
                  mechanism: 'Spendable stablecoins are shrinking while perpetual shorts keep building; a bounce would force them to cover.',
                  invalidation: 'Stablecoins turn positive over 7 days, or open interest falls 3% inside a day.'
                },
                'flows-price': {
                  mechanism: 'Spot funds are bleeding and leverage is coming off, yet price held: something bought the supply.',
                  invalidation: 'ETF flows turn positive, or price falls through 1%.'
                },
                'narrative-price': {
                  // The mechanism sentence is gone (design 2026-11-08 §九): the observed state now
                  // carries a neutral label and one fact, not a sentence that puts two possibilities
                  // side by side. The invalidation sentence stays.
                  invalidation: 'Price or open interest moves more than 1% in either direction.'
                }
              }
            },
            policyPath: {
              title: 'Policy path',
              range: 'Target range',
              meeting: 'Next meeting',
              daysAway: '{days} days',
              projection: 'SEP',
              probability: '{month} hike odds',
              outcomeLead: '{month} · {outcome}',
              longerRun: 'longer run',
              outcomes: { 'no-change': 'Hold', 'hike-25': 'hike 25bp', 'hike-50-plus': 'hike 50bp+', 'cut-25': 'cut 25bp', 'cut-50-plus': 'cut 50bp+' },
              basisNote: 'The odds are the mid of the bucket named above on Polymarket; the five buckets are normalised by their sum (usually slightly above 1, the venue margin), and 24h is that bucket before and after. It is what traders will transact at now, not a model forecast, and not the outcome.',
              probabilityLabel: 'Hike odds',
              lastVote: 'Last',
              sepMedian: 'SEP median',
              sepPath: 'SEP median path', decision: 'Last decision', basis: 'Quotes and basis', close: 'Close',
              odds: 'Hike 25bp', change24h: '24h', range30d: 'Last 30 days', quote: 'Bid / ask',
              openSource: 'Source', median: 'Median', sepRange: 'Range', previous: 'Previous', vote: 'Vote', dissents: 'Dissents', venue: 'Venue', asOf: 'As of', empty: 'Meeting dates are synced; the decision and the odds are not collected yet.',
              unchanged: 'Hold',
              voteHint: '{for} in favour, {against} against',
              dissentNote: 'The dissenters and their preferred action are listed under “Last decision” below',
              preferred: { raise: 'preferred a hike', lower: 'preferred a cut', maintain: 'preferred no change' },
              change24hPending: 'The odds series is younger than 24 hours; this appears once it fills',
              sepSteps: 'The SEP median sits {steps} × 25bp {direction} the range midpoint',
              sepStepsLevel: 'The SEP median matches the current range midpoint',
              distributionTitle: 'Current distribution',
              rangeLower: 'lower', rangeUpper: 'upper',
              shortOutcomes: { 'no-change': 'Hold', 'hike-25': 'Hike 25', 'hike-50-plus': 'Hike 50+', 'cut-25': 'Cut 25', 'cut-50-plus': 'Cut 50+' },
              compareNow: 'Now', compareDay: 'Day ago', compareWeek: 'Week ago',
              compareHint: 'A dash means there is no observation that far back yet, not zero.',
              topRest: 'rest {value}',
              directions: { hike: 'Hike ≥25bp', hold: 'Hold', cut: 'Cut ≥25bp' },
              phasePreMeeting: '{days} days to the decision',
              phaseSettlement: 'Decided',
              markerRepricing: 'Repriced {value}pp',
              markerIntraday: 'Intraday {value}pp',
              upgradeGapAbove: 'The committee median sits {steps} × 25bp above the midpoint',
              upgradeGapBelow: 'The committee median sits {steps} × 25bp below the midpoint',
              upgradeGapLevel: 'The committee median matches the range midpoint',
              upgradeCompare: 'Last quarter {previousSteps} × 25bp · median {median}% vs midpoint {midpoint}%',
              upgradeCompareNoPrevious: 'Median {median}% vs midpoint {midpoint}%',
              upgradeQuote: 'Bid {bid} / ask {ask} · last 30 days {min}–{max}%',
              upgradeQuoteOnly: 'Bid {bid} / ask {ask}',
              settlementActual: 'actual {date}',
              settlementPriced: 'Priced {value}% one hour before',
              settlementOutcomeLine: 'Landed in {actual} · the leading band was "{priced}"',
              settlementPricedConclusion: 'Priced in',
              settlementHawkish: 'vs. pricing: hawkish +{value}pp',
              settlementDovish: 'vs. pricing: dovish -{value}pp',
              settlementConclusionMissing: 'No conclusion (no observation in the hour before)',
              judgedLabel: 'Assessed · last decision vs. pricing',
              judgedPriced: 'Priced in',
              judgedHawkish: 'hawkish +{value}pp',
              judgedDovish: 'dovish -{value}pp',
              settlementTitle: 'Last decision settlement',
              settlementActualLabel: 'Outcome',
              settlementPricingBefore: 'One hour before: ',
              settlementPricingAfter: '{hours}h after the decision (not a pre-decision price):',
              settlementOther: 'other',
              settlementPricedDetail: ' (the realised band was priced at {value} then)',
              settlementStatementLink: 'Statement',
              settlementConclusionLabel: 'Conclusion',
              newTargetRange: 'New target range',
              voteTally: 'Vote',
              decisionHike: 'Hike',
              decisionCut: 'Cut',
              settledMinutes: 'Settled {minutes} min ago',
              settledHours: 'Settled {hours} h ago',
              detail: 'Details',
              live: 'Live',
              delayed: 'Delayed',
              stale: 'Stale',
              unavailable: 'Unavailable',
              loading: 'Loading the policy path…'
            },
            capitalConditions: {
              title: 'Capital conditions', loading: 'Loading capital conditions…', empty: 'Capital-conditions data is not available yet.',
              contractMismatch: 'This data comes from another version of the app, so it cannot be read here. Quit the app completely and open it again to recover; reloading the page is not enough.',
              stablecoin: 'Stablecoins', stablecoinScope: ' (USDT + USDC)', asset: 'Asset', totalSupply: 'Total supply',
              change1d: '1D', change7d: '7D', change30d: '30D',
              latest: 'Latest', windowDays: '{days}-day', coverage: '({days} days only)', streakColumn: 'Streak',
              streak: '{flow} · {count}d', streakSingle: '{flow} · 1d',
              shortFlowDirections: { inflow: 'Inflow', outflow: 'Outflow', zero: 'Flat' },
              observedAt: 'Observed at', etfFlow: 'Market flows', chartWindow: 'Last 7 sessions · USD millions',
              fundsColumn: 'Stablecoin net inflow', fundsScope: 'All USD stablecoins', btc: 'BTC ETF', eth: 'ETH ETF', etfScope: 'US spot ETF',
              infoAria: 'How to read this card',
              chartScopeNoteMain: 'Stablecoin net inflow of all USD stablecoins, no today.',
              chartScopeNoteEtf: 'BTC / ETH are US spot ETF net flows, not the same money.',
              columnScopeNote: 'Column scope: stablecoins = all USD; BTC/ETH = US spot ETF.',
              notComparable: 'Not comparable: {row} row has today.',
              etfUnknown: 'Unknown',
              etfMissingSourceUnreadable: 'could not be read this time, so this asset has no data',
              etfMissingAssetMissing: 'this asset has no data at all',
              etfMissingValueMissing: 'the latest day has no net flow figure',
              etfComparisonUnaligned: 'The two windows do not line up, so the comparison does not hold',
              etfComparisonLagging: 'behind by {days} trading day(s)',
              expandDaily: 'View daily values',
              dailyDialogTitle: 'Market flows · Daily values',
              dailyCaption: 'Daily values', dailyUnits: 'USD millions · UTC days',
              dailyFundsShort: 'Stablecoins', dateColumn: 'Date',
              flowNotEnoughDays: 'Only {days} days have data in the last 7.',
              flowNoDays: 'No usable flow data for these 7 days.',
              a11yAmountMillion: '{value} million US dollars', a11yNoFlow: 'No net inflow', a11yLabel: '{direction} {amount}', a11yCell: '{amount}, {scope}',
              flowDirections: { inflow: 'Net inflow', outflow: 'Net outflow', zero: 'Flat' },
              refresh: 'Re-collect sources', refreshFailed: 'Re-collection failed. Try again shortly.', staleRead: 'The refresh failed; the readings below are from the last successful read.',
              signalChip: 'Three-day net outflow {amount}', signalInsufficient: 'Insufficient data',
              signalInsufficientReason: 'Insufficient data: the three-day total is not available',
              signalTooltip: '{rule} | window {window} | {kind}', signalRuleName: 'ETF net outflow', signalRuleWindow: '3 trading days', signalKindObserved: 'fact reported by the source',
              signalAriaAlert: '{chip}, {asset}',
              signalChipOpen: '{chip}, open scope and source',
              signalDetailTitle: 'ETF three-day net outflow', signalDetailRule: 'Rule', signalDetailWindow: 'Window',
              signalDetailCumulative: 'Three-day total', signalDetailCoverage: 'Coverage', signalCoverage: '{covered}/{required} trading days',
              signalDetailTradingDay: 'Trading day (UTC)', signalDetailObservedAt: 'Observed at',
              signalDetailNote: 'This is a net flow the source reported, not a figure computed here; the trading day and the observation time are different things.',
              signalDetailDialogTitle: 'ETF three-day net outflow · Scope and source',
              signalDetailHelpLabel: 'Scope and source help', signalInsufficientHelpLabel: 'Insufficient data help',
              signalDetailGroupAnalysis: 'This analysis', signalDetailGroupReadings: 'Readings', signalDetailGroupTime: 'Time and source'
            },
            sentiment: { title: 'Market sentiment', fearGreed: 'Fear & Greed', observedAt: 'Observed at', gaugeMarkers: { fear: 'Extreme fear', neutral: 'Neutral', greed: 'Extreme greed' } },
            macroMarket: {
              sourceName: 'Macro market (Twelve Data)',
              sourceStates: {
                loading: 'Loading', available: 'Available', 'awaiting-collection': 'Waiting for the first collection',
                disabled: 'Disabled', 'credential-missing': 'API key not configured', unavailable: 'Unavailable'
              },
              manageSettings: 'Manage macro market settings'
            },
            /** Two policy verdicts; 读不到 stays each card's own sentence. */
            cellState: {
              notEnabled: 'Data is not enabled',
              sourceUnknown: 'Status is temporarily unavailable',
              sourceStale: 'Source status: last successful reading · {time}'
            },
            // One row per feed in Source status. `{tag}` is the panel's own synthetic/proxy label.
            dailyBriefing: dailyBriefingText['en-US']
          },
          calendar: {
            blsUnavailableNotice: 'BLS official calendar: this network cannot fetch it automatically (the official site returns 403) and automatic sync has stopped; the BLS events in the database come from the last successful sync ({date}), and their release times are unknown.',
            officialUnavailableShort: 'The BLS official schedule cannot be fetched',
            officialUnavailableNote: 'The site refuses this network (403), so automatic syncing has stopped. The BLS events listed come from the content synced on {date}; to get the current schedule, export the ICS from the official site and import it.',
            unifiedDay: { total: '{count} events today', grouped: 'Grouped by type', groupCount: '{type} · {count} events', empty: 'No events today', timePending: 'TBD', more: '{count} more', loading: 'Loading', incomplete: 'Partially loaded', back: 'Back to day list', storageUnavailable: 'Storage limited; existing data retained', coverage: 'Reading {months} (UTC months, including the grid\'s neighbouring months); up to 200 official events per month' },
            calendarSettings: 'Configure calendar',
            calendarPanel: { title: 'Calendar sources', configure: 'Configure in data sources', loading: 'Loading calendar sources…', unavailable: 'No calendar sources are available for this panel.', pending: 'Pending', enabled: 'Enabled', disabled: 'Disabled' },
            market: { marketReadFailure: { 'input-invalid': 'This read was rejected as invalid; refreshing sends it again.', 'read-threw': 'This read did not finish; you can retry.', 'too-large': 'This window holds more events than one read can finish; you can retry.', 'cursor-loop': 'The read stopped making progress and was cut off; you can retry.' }, refreshOutcome: { succeeded: 'Refresh succeeded', failed: 'Refresh failed', unattempted: 'Not refreshed this session' }, refreshTrigger: { manual: 'Manual', automatic: 'Automatic' }, attemptFailure: { 'input-invalid': 'Invalid request', 'credential-not-configured': 'No credential configured', 'response-unavailable': 'Source did not respond', 'archive-unavailable': 'Evidence archive unavailable', 'parse-unavailable': 'Parsing limited', 'storage-unavailable': 'Storage unavailable', 'storage-pressure': 'Storage limited' }, collectedAt: 'Data collected', retainedData: 'Showing previous data', automaticRefresh: 'Updates automatically every {interval} min', officialActual: 'Official actual', officialPrevious: 'Official previous', sourceAdvanced: 'This source has updated since; the figures and time below belong to the observation above.', linkedTimeOfficial: 'Calendar time: official', linkedTimeProvider: 'Calendar time: 0xRouter', linkedTimePending: 'Calendar time: pending', missingValue: 'Unavailable', importance: { high: 'High', medium: 'Medium', low: 'Low' }, locale: 'en' as const, refresh: 'Refresh market calendar', loading: 'Loading market events…', pending: 'Refreshing market calendar…', completed: 'Market calendar updated', partial: 'Some sources failed; existing data retained', unavailable: 'Refresh incomplete; existing data may be stale', queryUnavailable: 'Market events unavailable', settings: 'Manage 0xRouter source', unknownCountry: 'Country not specified', consensus: 'Market consensus', surprise: 'Surprise', surpriseBeat: 'Above expectation', surpriseMiss: 'Below expectation', surpriseInline: 'In line', surpriseUnavailable: 'No consensus', surpriseNotComparable: 'Surprise not comparable', providerPrevious: 'Previous (0xRouter)', providerActual: 'Actual (0xRouter)', comparison: 'Not comparable yet', source: '0xRouter', observed: 'Source observed', time: 'Published', more: 'More market events', kinds: { 'economic-indicator': 'Economic indicators', 'financial-event': 'Financial events', 'central-bank-activity': 'Central bank activities' }, statuses: { success: 'Collected', 'success-empty': 'No events this time', 'all-skipped': 'Parsing limited', partial: 'Partially available', unavailable: 'No available collection', 'no-locale-rows': 'The source provides no English items' } },
            eventStatus: { label: 'Release status', 'data-received': 'Data received', upcoming: 'Not yet scheduled time', 'awaiting-data': 'Not yet published', 'storage-limited': 'Storage limited', 'time-pending': 'Time pending', 'elapsed-unconfirmed': 'Scheduled time elapsed', cancelled: 'Cancelled' },
            workspaceLabel: '— MACRO / ECONOMIC CALENDAR',
            title: 'Economic calendar',
            info: 'Calendar details',
            month: 'Current month',
            monthNavigation: { previous: 'Previous month', next: 'Next month', current: 'Back to current month', picker: 'Choose month' },
            status: { loading: 'Loading economic calendar…', empty: 'No events this month.', noSourceEnabled: 'No calendar source is enabled' },
            noLocaleRowsNote: 'These calendar sources provide Chinese items only; there is no English content to show this month.',
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
            details: { title: 'Event detail', category: 'Category', period: 'Period', source: 'Source', time: 'Release time', importance: 'Importance', state: 'State', actual: 'Actual', previous: 'Previous', valueNotYet: 'Not released yet', valueNotProvided: 'Not provided by the source', consensusMissing: 'No consensus provided', consensusUnreadable: 'Temporarily unreadable', consensusUnreadableReason: 'An observation exists, but its expectation field is empty (data gap).', consensusReadFailedReason: 'The market observation could not be read this time — this is not the same as having no expectation.', consensusFromMarket: 'Expectation comes from the market source', scheduledDateOnly: 'Official time not published', timeNotPublished: releaseTimeWords['en-US'], timeNotPublishedReason: 'The official schedule does not publish a release time for this event, so no time is shown here. This is not a read failure on our side.', editedTime: 'Edited',
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
              blocked: 'Refreshing is unavailable: the official site rejects this network; the recovery time is unknown.',
              reasonCodeAria: 'Reason code',
              updated: 'BLS data for the matching complete release family was refreshed.', unchanged: 'BLS data for the matching complete release family is already current.', unavailable: 'Official BLS data is unavailable for the matching complete release family. No values were saved.'
            },
            blsScheduleSync: {
              schedule: { updated: 'BLS schedule updated', unchanged: 'BLS schedule is current', unavailable: 'BLS schedule unavailable' },
              cpi: { updated: 'CPI values updated', current: 'CPI values are current', 'not-required': 'CPI catch-up not required', unavailable: 'CPI values unavailable' },
              employment: { updated: 'Employment values updated', current: 'Employment values are current', 'not-required': 'Employment catch-up not required', unavailable: 'Employment values unavailable' }
            },
            recordTimes: {
              createdAt: 'Created',
              actualDetectedAt: 'Actual value received'
            },
            fomcRefresh: {
              publishedAt: 'Official publication time', retained: 'Refresh failed; showing previous official value',
              action: 'Fetch official value',
              confirm: 'Fetch', cancel: 'Cancel',
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
          sourceFreshness: 'Source last updated',
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
              degraded: 'Partially available',
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
            degraded: 'Partially available',
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
macroCalendar: macroCalendarText['en-US'],
intelligenceSources: intelligenceSourcesText['en-US']
    }
  }
} as const

export type ProductText = typeof productText
export type IntelligencePageText = ProductText[keyof ProductText]['pages']['intelligence']
export type IntelligenceSourcesText = ProductText[keyof ProductText]['settings']['intelligenceSources']
