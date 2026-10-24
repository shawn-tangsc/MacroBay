import type { IntelligencePipeline } from '../application/intelligencePipeline'
import {
  NEWS_SENTIMENT_BODY_SOURCE_IDS,
  NEWS_SENTIMENT_EXTRACTION_VERSION,
  type NewsDocumentRecord
} from '../schema/newsSentiment'
import { extractNewsBody } from './newsDocumentExtractor'
import type { NewsSentimentStore } from './newsSentimentStore'

export type NewsArticleFetcher = (url: string) => Promise<{ status: number; bodyText: string }>

export type NewsSentimentEnrichmentResult = Readonly<{
  processed: number
  available: number
  tooShort: number
  failed: number
  skipped: number
}>

/**
 * 抓正文并落 `news_document`。Binance 不在正文源里（WAF 拦截），由打分侧退回标题+摘要。
 * 单次运行有界，失败只写状态，不抛出整批。
 */
export function createNewsSentimentEnrichmentService(deps: {
  pipeline: Pick<IntelligencePipeline, 'listItems'>
  store: Pick<NewsSentimentStore, 'getDocument' | 'upsertDocument'>
  fetchArticle: NewsArticleFetcher
  now: () => string
  maxPerRun?: number
}) {
  const bodySources = new Set<string>(NEWS_SENTIMENT_BODY_SOURCE_IDS)

  return {
    async enrichItems(input: { itemIds?: string[] }): Promise<NewsSentimentEnrichmentResult> {
      const items = deps.pipeline.listItems()
      const requested = input.itemIds?.length
        ? input.itemIds
        : items
            .filter((item) => bodySources.has(item.sourceId) && needsDocument(deps.store, item.itemId))
            .slice(0, deps.maxPerRun ?? 20)
            .map((item) => item.itemId)

      let processed = 0
      let available = 0
      let tooShort = 0
      let failed = 0
      let skipped = 0

      for (const itemId of requested.slice(0, deps.maxPerRun ?? 20)) {
        const item = items.find((entry) => entry.itemId === itemId)
        if (!item || !bodySources.has(item.sourceId)) {
          skipped += 1
          continue
        }
        const existing = deps.store.getDocument(itemId)
        if (
          existing &&
          existing.extractionVersion === NEWS_SENTIMENT_EXTRACTION_VERSION &&
          (existing.state === 'available' || existing.state === 'too-short')
        ) {
          skipped += 1
          continue
        }

        processed += 1
        const url = item.url?.trim()
        if (!url) {
          deps.store.upsertDocument(failedDocument(item, '', 'missing-url', deps.now()))
          failed += 1
          continue
        }

        try {
          const response = await deps.fetchArticle(url)
          if (response.status < 200 || response.status >= 300) {
            deps.store.upsertDocument(failedDocument(item, url, `http-${response.status}`, deps.now()))
            failed += 1
            continue
          }
          const extracted = extractNewsBody({ sourceId: item.sourceId, html: response.bodyText })
          deps.store.upsertDocument({
            itemId,
            sourceId: item.sourceId,
            url,
            fetchedAt: deps.now(),
            ...(extracted.text ? { bodyText: extracted.text } : {}),
            bodyChars: extracted.chars,
            extractionVersion: extracted.extractionVersion,
            state: extracted.state
          })
          if (extracted.state === 'available') available += 1
          else tooShort += 1
        } catch {
          deps.store.upsertDocument(failedDocument(item, url, 'fetch-failed', deps.now()))
          failed += 1
        }
      }

      return { processed, available, tooShort, failed, skipped }
    }
  }
}

function needsDocument(
  store: Pick<NewsSentimentStore, 'getDocument'>,
  itemId: string
): boolean {
  const document = store.getDocument(itemId)
  if (!document) return true
  if (document.state === 'failed') return true
  return document.extractionVersion !== NEWS_SENTIMENT_EXTRACTION_VERSION
}

function failedDocument(
  item: { itemId: string; sourceId: string },
  url: string,
  failureCode: string,
  fetchedAt: string
): NewsDocumentRecord {
  return {
    itemId: item.itemId,
    sourceId: item.sourceId,
    url,
    fetchedAt,
    bodyChars: 0,
    extractionVersion: NEWS_SENTIMENT_EXTRACTION_VERSION,
    state: 'failed',
    failureCode
  }
}
