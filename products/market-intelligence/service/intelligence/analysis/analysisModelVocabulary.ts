import { MARKET_ANALYSIS_CONTEXT_CAVEATS, MARKET_ANALYSIS_MACRO_CALENDAR_POLICY } from '../../../contracts/marketAnalysisContracts'
import type { MarketAnalysisReadableNames } from '../../../contracts/marketAnalysisReadableText'

/**
 * The words the model reads.
 *
 * The prompt is Chinese and the model writes the published conclusion in Chinese, so this
 * vocabulary is Chinese only. It exists because the model must never be handed a raw
 * identifier to copy: asked to "quote the fields that changed", it quoted `change-1d-usd`
 * and `consensus` straight into the published conclusion, which no reader could follow.
 *
 * The renderer's names for the same identifiers are product copy and live in the product i18n
 * registry (`desktop/shared/i18n/productText.ts`), because the main process must not import
 * renderer code. `analysisModelVocabulary.test.ts` keeps the two in step: the id sets must
 * match, and the Chinese text must be identical.
 */
export const analysisModelVocabulary: MarketAnalysisReadableNames = Object.freeze({
  domain: Object.freeze({
    macro: '宏观', capital: '资金面', sentiment: '情绪', funding: '资金费率', 'cross-asset': '跨资产'
  }),
  metric: Object.freeze({
    'current-usd': '当前值',
    'change-1d-usd': '1 日变化',
    'change-7d-usd': '7 日变化',
    'change-30d-usd': '30 日变化',
    'etf-net-flow-usd': 'ETF 净流入',
    'funding-rate-percent': '资金费率',
    'fear-greed-index': '恐惧贪婪指数',
    'price-return-15m': '15 分钟价格收益',
    'price-return-2h': '2 小时价格收益',
    'price-return-24h': '24 小时价格收益',
    'price-return-3d': '3 天价格收益',
    'relative-return-2h': '2 小时相对收益（BTC 相对 ETH）',
    'cpi-12-month-percent': 'CPI 年率',
    score: '评分',
    'event-name': '事件',
    'lifecycle-state': '生命周期',
    'scheduled-date': '计划日期',
    'scheduled-at': '计划时间',
    'official-release-date': '官方发布日期',
    actual: '实际值',
    previous: '前值',
    consensus: '市场预期',
    surprise: '预期差（实际−预期）',
    'event-excerpt': '事件摘要',
    'dollar-index-level': '美元指数', 'dollar-index-return-15m': '美元指数 15 分钟变化',
    'dollar-index-return-1h': '美元指数 1 小时变化', 'dollar-index-return-4h': '美元指数 4 小时变化',
    'dollar-index-return-24h': '美元指数 24 小时变化', 'gold-price-usd-oz': '黄金价格',
    'us-10y-yield': '美债 10 年期收益率', 'us-10y-yield-change-1d': '美债 10 年期 1 日变化',
    'us-10y-real-yield': '美债 10 年期实际利率', 'us-10y-real-yield-change-1d': '美债 10 年期实际利率 1 日变化',
    'us-2y-yield': '美债 2 年期收益率', 'us-2y-yield-change-1d': '美债 2 年期 1 日变化',
    'us-10y-breakeven-inflation': '美债 10 年期盈亏平衡通胀', 'us-10y-2y-term-spread': '10Y−2Y 期限利差'
  }),
  subject: Object.freeze({
    stablecoins: '稳定币', BTC: 'BTC', ETH: 'ETH', market: '市场', all: '全部', 'btc-vs-eth': 'BTC 相对 ETH',
    'consumer-price-index': '消费者物价指数', 'employment-situation': '就业形势', fomc: '美联储议息',
    pce: 'PCE 物价', 'core-pce': '核心 PCE', gdp: 'GDP',
    'economic-indicator': '经济指标', 'financial-event': '金融事件', 'central-bank-activity': '央行活动',
    'usd-index': '美元指数', gold: '黄金', 'us-treasury': '美债利率'
  }),
  eventName: Object.freeze({
    cpi: '消费者物价指数（CPI）', 'core-cpi': '核心 CPI', 'nonfarm-payrolls': '非农就业人数',
    unemployment: '失业率', 'average-hourly-earnings': '平均时薪', pce: 'PCE 物价', 'core-pce': '核心 PCE',
    gdp: 'GDP', fomc: '美联储议息会议'
  }),
  lifecycleState: Object.freeze({ scheduled: '待公布', released: '已公布', cancelled: '已取消' }),
  comparability: Object.freeze({ comparable: '可比', 'not-comparable': '不可比' }),
  caveat: Object.freeze({
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.maxItemsTruncated]: '证据条数已截断',
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.sourceHealthUnavailable]: '来源健康度不可用',
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryUnavailable]: '查询不可用',
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty]: '查询结果为空',
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.evidenceUnavailable]: '证据不可用',
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.notComparable]: '与其他数据不可比',
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarUnavailable]: '经济日历不可用',
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarEmpty]: '经济日历为空',
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarConsensusUnavailable]: '缺少市场预期值',
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarQueryNotWired]: '经济日历未接线',
    'observed-unverified': '来源身份未验证',
    'provider-title-is-display-name': '事件名取自提供方标题',
    'provider-surprise-not-comparable': '预期差不可计算',
    'provider-observation-identity-missing': '日历观测缺少稳定身份',
    'provider-observation-page-unavailable': '日历观测不可用',
    'provider-observation-pages-truncated': '日历观测分页已截断',
    'provider-observations-truncated': '日历观测条数已截断',
    'etf-unavailable': 'ETF 数据不可用',
    'sentiment-not-computed-as-of': '情绪指标尚未计算',
    'domain-not-requested': '未请求该域',
    'query-not-run': '尚未执行查询',
    'official-time-not-published': '官方未公布时间',
    'official-timezone-not-published': '官方未公布时区',
    'official-period-not-published-in-ics': '官方未公布统计期',
    'official-value-revised': '官方值已修订',
    'manual-ics-import': '手工导入日历',
    'bls-python-schedule': 'BLS 自动排期',
    'bea-official-rss-release-page': 'BEA 官方发布页',
    // The Nasdaq 100 row's two admitted instruments: the cash index prints only in its session, and
    // the fallback is a tokenised perpetual rather than the index itself.
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.crossAssetIndexCashSession]: '仅美股现金时段',
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.crossAssetIndexProxy]: '代币化指数代理',
    // The macro rows' own limitations: the dollar may be this product's synthesis, the FRED series
    // are daily closes, and a reading that aged out is named rather than restated as current.
    'official-daily-close': '官方日频收盘，可能滞后数个交易日',
    'synthetic-dollar-index': '合成美元指数（非官方 ICE 指数）',
    'provider-time-series': '提供方时间序列（按提供方周期成 bar）',
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryStale]: '读数已过期，不作为当前值',
    [MARKET_ANALYSIS_CONTEXT_CAVEATS.macroRatesMixedPeriods]: '两条日频序列观察日不一致，不计算差值'
  }),
  /**
   * Prompt vocabulary that reaches a conclusion as an ordinary English word rather than as a
   * fact, which is why these are registered separately.
   */
  term: Object.freeze({ consensus: '市场预期值', actual: '实际值', previous: '前值', stablecoins: '稳定币' })
})

/** Identifiers whose missing name would leave a reader with a machine encoding. */
export const analysisVocabularyRequiredIds = Object.freeze({
  metric: Object.freeze([
    ...Object.values(MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.factMetrics),
    'current-usd', 'change-1d-usd', 'change-7d-usd', 'change-30d-usd', 'etf-net-flow-usd',
    'funding-rate-percent', 'fear-greed-index', 'price-return-15m', 'price-return-2h', 'price-return-24h', 'price-return-3d', 'relative-return-2h',
    // The 市场状态 block's dollar/gold row and FRED's daily rate block, which the analysis reads as
    // facts: an identifier the model is handed must have a reader-facing name.
    'dollar-index-level', 'dollar-index-return-15m', 'dollar-index-return-1h', 'dollar-index-return-4h', 'dollar-index-return-24h',
    'gold-price-usd-oz', 'us-10y-yield', 'us-10y-yield-change-1d', 'us-10y-real-yield', 'us-10y-real-yield-change-1d',
    'us-2y-yield', 'us-2y-yield-change-1d', 'us-10y-breakeven-inflation', 'us-10y-2y-term-spread'
  ]),
  caveat: Object.freeze(Object.values(MARKET_ANALYSIS_CONTEXT_CAVEATS)),
  domain: Object.freeze(['macro', 'capital', 'sentiment', 'funding', 'cross-asset']),
  term: Object.freeze(['consensus'])
})
