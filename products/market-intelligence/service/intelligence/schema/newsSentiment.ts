/**
 * 舆情的稳定契约：一条新闻的方向判断、它的引擎版本、以及可复核的证据。
 *
 * 这里是「新闻判断」，不是 impact / assessment：现有情绪聚合吃的是 impact，本条链路只吃
 * 文本事件，因此单独建一套记录，不修改既有 sentiment 语义（设计 154 §8）。
 */

export type NewsPolarity = 'bullish' | 'bearish' | 'neutral' | 'mixed'

export type NewsSentimentEngine = 'model' | 'rules'

/** 只认 BTC / ETH；无符号的新闻只进 crypto-market。 */
export type NewsSentimentSymbol = 'BTC' | 'ETH'

export type NewsDocumentState = 'available' | 'too-short' | 'failed'

export type NewsSentimentWindow = '1h' | '4h' | '24h' | '7d'

/** 舆情只看这四个文本源；CFTC 端点失效，P0 不启用。 */
export const NEWS_SENTIMENT_SOURCE_IDS = [
  'sec-rss',
  'coindesk-rss',
  'binance-announcements',
  'okx-latest-announcements'
] as const

/** 正文可抓的三个源；Binance 文章页被 WAF 拦截，只做标题级。 */
export const NEWS_SENTIMENT_BODY_SOURCE_IDS = ['sec-rss', 'coindesk-rss', 'okx-latest-announcements'] as const

/** OKX 只对这三类公告打分（采集与时间线不变）。 */
export const OKX_SENTIMENT_ANN_TYPES = [
  'announcements-trading-updates',
  'announcements-api',
  'announcements-deposit-withdrawal-suspension-resumption'
] as const

export const NEWS_SENTIMENT_WINDOWS: readonly NewsSentimentWindow[] = ['1h', '4h', '24h', '7d']

export const NEWS_SENTIMENT_WINDOW_MS: Readonly<Record<NewsSentimentWindow, number>> = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
}

/** 提示词版本：改动提示词必须同时改它，否则旧判断不会被重新评分。 */
export const NEWS_SENTIMENT_PROMPT_VERSION = 'news-polarity-v1'

/** 正文抽取器版本：选择器变更时递增，旧正文不会被当成新格式复用。 */
export const NEWS_SENTIMENT_EXTRACTION_VERSION = 'news-body-v2'

export const NEWS_SENTIMENT_LIMITS = Object.freeze({
  /** 正文落库上限。 */
  bodyChars: 8_000,
  /** 送模型的正文上限（比落库更短，控制成本）。 */
  promptBodyChars: 6_000,
  /** 证据引文上限。 */
  evidenceQuoteChars: 200,
  /** 单次查询返回上限。 */
  queryItems: 100,
  /** 详情正文回显上限。 */
  detailBodyChars: 8_000
})

export type NewsSentimentSettings = {
  /** 关闭后只用规则，界面必须标「规则判断」。 */
  modelScoringEnabled: boolean
  /** 空 = 跟随平台「快速模型」。 */
  providerId: string
  modelId: string
  updatedAt: string
}

export type NewsSentimentDefaultModelState = 'unset' | 'ready' | 'unavailable'

export type NewsSentimentModelResolution = {
  source: 'explicit' | 'platform-fast' | 'unavailable'
  defaultModelState: NewsSentimentDefaultModelState
  providerId?: string
  modelId?: string
}

export type NewsSentimentSettingsView = {
  settings: NewsSentimentSettings
  resolution: NewsSentimentModelResolution
  defaultFastModel?: { providerId: string; modelId: string; name: string }
}

export type NewsSentimentJudgment = {
  polarity: NewsPolarity
  strength: number
  confidence: number
  symbols: NewsSentimentSymbol[]
  reasonCode: string
  evidenceQuote?: string
  caveats: string[]
}

export type NewsSentimentRecord = NewsSentimentJudgment & {
  itemId: string
  sourceId: string
  publishedAt: string
  scoredAt: string
  engine: NewsSentimentEngine
  modelRef?: string
  promptVersion?: string
  ruleId?: string
}

export type NewsDocumentRecord = {
  itemId: string
  sourceId: string
  url: string
  fetchedAt: string
  bodyText?: string
  bodyChars: number
  extractionVersion: string
  state: NewsDocumentState
  failureCode?: string
}

/** 查询时的窗口与范围；scope=market 表示全市场。 */
export type NewsSentimentQuery = {
  asOf: string
  window: NewsSentimentWindow
  scope?: 'market' | NewsSentimentSymbol
  direction?: 'all' | NewsPolarity
  sourceId?: string
  limit?: number
}

export const NEWS_SENTIMENT_CAVEATS = Object.freeze({
  bodyLimited: 'news-body-limited',
  modelUnavailable: 'news-model-unavailable',
  modelInvalidOutput: 'news-model-invalid-output',
  emptyWindow: 'news-empty-window',
  queryFailed: 'news-query-failed'
})

export function isNewsPolarity(value: unknown): value is NewsPolarity {
  return value === 'bullish' || value === 'bearish' || value === 'neutral' || value === 'mixed'
}

export function isNewsSymbol(value: string): value is NewsSentimentSymbol {
  const upper = value.trim().toUpperCase()
  return upper === 'BTC' || upper === 'ETH'
}
