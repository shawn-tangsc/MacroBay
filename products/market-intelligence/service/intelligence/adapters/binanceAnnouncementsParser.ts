import { hashPayload } from '@platform/jobs'

import { buildExchangeAnnouncementClusterKey } from '../application/clusterResolver'
import type { AppendRawRecordInput } from '../schema/intelligenceRecord'
import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'

export const BINANCE_ANNOUNCEMENT_PARSER_VERSION = 'binance-announcements-v1'

export type BinanceArticlePayload = {
  id?: number
  code: string
  title: string
  releaseDate?: number
  catalogId?: number
  catalogName?: string
}

export type BinanceArticleListResponse = {
  code?: string
  data?: {
    catalogs?: Array<{
      catalogId?: number
      catalogName?: string
      articles?: BinanceArticlePayload[]
    }>
    articles?: BinanceArticlePayload[]
  }
}

export const BINANCE_DEFAULT_MAX_AGE_DAYS = 7

/**
 * 列表接口一次返回全部历史（实测 4 年、140 条）。没有这个窗口，首次接入会把几年旧公告
 * 全量灌进时间线。`maxAgeDays <= 0` 表示不截断，仅供夹具测试显式关闭。
 */
export function selectRecentBinanceArticles(
  articles: readonly BinanceArticlePayload[],
  input: { nowMs: number; maxAgeDays?: number }
): BinanceArticlePayload[] {
  const maxAgeDays = input.maxAgeDays ?? BINANCE_DEFAULT_MAX_AGE_DAYS
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return [...articles]
  const cutoff = input.nowMs - maxAgeDays * 86_400_000
  return articles.filter(
    (article) => typeof article.releaseDate === 'number' && article.releaseDate >= cutoff
  )
}

export function buildBinanceListQueryUrl(config: IntelligenceSourceConfig): string {
  const baseUrl = String(
    config.adapterConfig.listQueryUrl ??
      'https://www.binance.com/bapi/apex/v1/public/apex/cms/article/list/query'
  )
  const url = new URL(baseUrl)
  url.searchParams.set('type', '1')
  url.searchParams.set('pageNo', '1')
  url.searchParams.set('pageSize', String(config.adapterConfig.pageSize ?? 20))
  const catalogId = config.adapterConfig.catalogId
  if (typeof catalogId === 'number') {
    url.searchParams.set('catalogId', String(catalogId))
  }
  return url.toString()
}

export function buildBinanceRequestHeaders(config: IntelligenceSourceConfig): Record<string, string> {
  const language = String(config.adapterConfig.language ?? config.language ?? 'en')
  const pageUrl = String(config.adapterConfig.pageUrl ?? 'https://www.binance.com/en/support/announcement')
  return {
    Accept: 'application/json',
    'Accept-Language': language,
    Referer: pageUrl,
    lang: language
  }
}

export function parseBinanceArticleListResponse(bodyText: string): BinanceArticlePayload[] {
  const payload = JSON.parse(bodyText) as BinanceArticleListResponse
  if (payload.code && payload.code !== '000000') {
    throw new Error(`Binance CMS rejected the request (${payload.code}).`)
  }

  const articles = new Map<string, BinanceArticlePayload>()
  for (const article of flattenBinanceArticles(payload)) {
    if (!article.code || !article.title) continue
    articles.set(article.code, article)
  }
  return [...articles.values()]
}

export function binanceArticlesToRawRecords(input: {
  config: IntelligenceSourceConfig
  runId: string
  articles: BinanceArticlePayload[]
}): AppendRawRecordInput[] {
  const language = String(input.config.adapterConfig.language ?? input.config.language ?? 'en')
  return input.articles.map((article) => {
    const payloadBody = JSON.stringify(article)
    return {
      sourceId: input.config.sourceId,
      runId: input.runId,
      externalId: article.code,
      sourceUrl: buildBinanceArticleUrl(article.code, language),
      publishedAt: article.releaseDate ? new Date(article.releaseDate).toISOString() : undefined,
      publishedAtRaw: article.releaseDate ? String(article.releaseDate) : undefined,
      payloadFormat: 'json',
      payloadRefType: 'inline',
      payloadBody,
      payloadHash: hashPayload(payloadBody),
      sourceDedupeKey: `binance:${article.code}`,
      parserVersion: parserVersionForSource(input.config.sourceId)
    }
  })
}

export function parseBinanceArticlePayload(payload: BinanceArticlePayload) {
  const bodyText = payload.title
  return {
    externalId: payload.code,
    sourceUrl: buildBinanceArticleUrl(payload.code, 'en'),
    publishedAtRaw: payload.releaseDate ? String(payload.releaseDate) : undefined,
    publishedAt: payload.releaseDate ? new Date(payload.releaseDate).toISOString() : undefined,
    title: payload.title,
    summary: payload.catalogName,
    bodyText,
    bodyHash: hashPayload(bodyText),
    eventType: 'exchange-announcement',
    severityHint: 'info' as const
  }
}

export function buildBinanceArticleUrl(code: string, language: string): string {
  return `https://www.binance.com/${language}/support/announcement/${code}`
}

export function buildBinanceCanonicalDedupeKey(code: string): string {
  return `binance:${code}`
}

export function buildBinanceClusterKey(sourceId: string, code: string): string {
  return buildExchangeAnnouncementClusterKey(sourceId, code)
}

export function isBinanceHtmlSource(sourceId: string): boolean {
  return sourceId === 'binance-announcements' || sourceId === 'binance-api-updates'
}

function flattenBinanceArticles(payload: BinanceArticleListResponse): BinanceArticlePayload[] {
  const catalogs = payload.data?.catalogs ?? []
  const flattened = catalogs.flatMap((catalog) =>
    (catalog.articles ?? []).map((article) => ({
      ...article,
      catalogId: article.catalogId ?? catalog.catalogId,
      catalogName: article.catalogName ?? catalog.catalogName
    }))
  )
  if (flattened.length > 0) return flattened
  return payload.data?.articles ?? []
}

function parserVersionForSource(sourceId: string): string {
  if (sourceId === 'binance-api-updates') return 'binance-api-updates-v1'
  return BINANCE_ANNOUNCEMENT_PARSER_VERSION
}
