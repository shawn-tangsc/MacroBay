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

/**
 * 实体类别是跨媒体归并的判据本身，不是给界面看的修饰。
 *
 * 只共享「比特币／以太坊」的两条新闻可以是毫不相干的两件事：只要类别里留着 `asset`，
 * 任意两篇加密新闻都能凑够「共享两个实体」。所以连边条件必须要求其中至少一个不是资产。
 */
export type NewsSentimentEntityKind = 'person' | 'org' | 'bill' | 'asset' | 'event'

export type NewsSentimentEntity = {
  /** 归一化后的规范名：小写、去标点、折叠空白。 */
  name: string
  kind: NewsSentimentEntityKind
}

export type NewsBodyTranslationState = 'translated' | 'failed'

export type NewsBodyTranslationRecord = {
  itemId: string
  bodyHash: string
  targetLocale: string
  state: NewsBodyTranslationState
  titleText?: string
  bodyText?: string
  providerId?: string
  modelId?: string
  errorCode?: string
  translatedAt: string
}

export type NewsDocumentState = 'available' | 'too-short' | 'failed'

export type NewsSentimentWindow = '1h' | '4h' | '24h' | '7d' | 'all'

/** 舆情只看这四个文本源；CFTC 端点失效，P0 不启用。 */
export const NEWS_SENTIMENT_SOURCE_IDS = [
  'sec-rss',
  'coindesk-rss',
  'binance-announcements',
  'okx-latest-announcements'
] as const

/** 正文可抓的四个源；Binance 公告页有 WAF，正文改走公开 CMS detail API（§21.1 D7）。 */
export const NEWS_SENTIMENT_BODY_SOURCE_IDS = ['sec-rss', 'coindesk-rss', 'binance-announcements', 'okx-latest-announcements'] as const

/** OKX 只对这三类公告打分（采集与时间线不变）。 */
export const OKX_SENTIMENT_ANN_TYPES = [
  'announcements-trading-updates',
  'announcements-api',
  'announcements-deposit-withdrawal-suspension-resumption'
] as const

export const NEWS_SENTIMENT_WINDOWS: readonly NewsSentimentWindow[] = ['1h', '4h', '24h', '7d']

/**
 * 只有这三个窗口能产出汇总分：既有情绪聚合（`aggregateSentimentSignals`）的 horizon 只有
 * `15m/1h/4h/24h`，7d 与 all 没有对应 horizon。7d 曾被原样当成 horizon 传进去，聚合按
 * `ageMs <= undefined` 把每条信号都滤掉——于是「7 天里有 66 条方向性标题」被写成
 * `directionalCount: 0` / `score: 0` / `label: neutral`。这不是「今天平静」，是把「算不了」
 * 说成了 0（170 §2「缺失必须具名、不补零」）。宁可没有 summary，也不给假读数。
 */
export const NEWS_SENTIMENT_AGGREGATE_WINDOWS = ['1h', '4h', '24h'] as const

export type NewsSentimentAggregateWindow = (typeof NEWS_SENTIMENT_AGGREGATE_WINDOWS)[number]

export function isNewsSentimentAggregateWindow(
  window: NewsSentimentWindow
): window is NewsSentimentAggregateWindow {
  return (NEWS_SENTIMENT_AGGREGATE_WINDOWS as readonly string[]).includes(window)
}

export const NEWS_SENTIMENT_WINDOW_MS: Readonly<Record<NewsSentimentWindow, number>> = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  all: 100 * 365 * 24 * 60 * 60 * 1000
}

/** 提示词版本：改动提示词必须同时改它，否则旧判断不会被重新评分。 */
export const NEWS_SENTIMENT_PROMPT_VERSION = 'news-polarity-v2'

/** 正文抽取器版本：选择器变更时递增，旧正文不会被当成新格式复用。 */

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
  detailBodyChars: 8_000,
  /** 一条新闻最多带多少个实体：归并键只需要少数几个能区分事件的名字。 */
  entitiesPerItem: 12,
  /** `why` 上限（字符）。它本版不进推送，只入库供读者评估质量。 */
  whyChars: 40,
  /** 实体名长度上限：超过它的多半是模型把整句塞进来了。 */
  entityNameChars: 60
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
  /** 模型给的规范化实体集；规则兜底时没有，因此也拿不到归并键。 */
  entities?: NewsSentimentEntity[]
  /** 一句为什么值得看（≤40 字符）。本版只入库，不进推送文案。 */
  why?: string
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
  /** 跨媒体归并键；由 `storyKeyOf` 从实体集与 UTC 日桶确定性合成，没实体就没有。 */
  storyKey?: string
}

export type NewsDocumentRecord = {
  itemId: string
  sourceId: string
  url: string
  fetchedAt: string
  bodyText?: string
  bodyChars: number
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

/**
 * 四个源背后的状态，读时算好再交给界面。
 *
 * 卡片要分得清「四源没开」「开了没跑」「采集失败」这三种空——「窗口内没有消息」是第四种，
 * 「有数据但过期」是第五种。这五个状态如果让界面自己拼接，同一个判断就会在卡片、抽屉与
 * 后续消费者里各写一遍。这里只做汇总，逐源状态来自 `buildSourceCoverageAsOf` 的
 * `productionState`（那一处已经是「这个源现在怎么样」的唯一实现）。
 */
export type NewsSentimentSourceReadiness = Readonly<{
  total: number
  enabledCount: number
  failedCount: number
  neverRanCount: number
  failedSourceIds: string[]
  neverRanSourceIds: string[]
  lastSuccessAt?: string
  /**
   * 已启用源里最慢的那个采集周期（毫秒），来自 `resolveRuntimeConfig` 的 `pollingIntervalSec`，
   * 不是写死的常数。卡片用它 ×3 判断「看到的这几条本身已经旧了」；没有任何可定周期的源时缺省。
   */
  maxCollectionIntervalMs?: number
}>

export const NEWS_SENTIMENT_CAVEATS = Object.freeze({
  bodyLimited: 'news-body-limited',
  modelUnavailable: 'news-model-unavailable',
  modelInvalidOutput: 'news-model-invalid-output',
  /** 本轮模型调用额度用完：其余条目按规则判断，下一次运行会再试。 */
  modelBudgetExhausted: 'news-model-budget-exhausted',
  /** 连续三条没有拿到模型判断后，本轮余下条目不再调用模型（154 §7.1 的熔断）。 */
  modelDegraded: 'news-model-degraded',
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
