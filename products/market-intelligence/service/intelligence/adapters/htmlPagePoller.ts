import { hashPayload } from '@platform/jobs'

import { intelligenceHttpRequest } from './intelligenceHttpClient'

import { buildExchangeAnnouncementClusterKey } from '../application/clusterResolver'
import type { AppendRawRecordInput } from '../schema/intelligenceRecord'
import {
  BINANCE_ANNOUNCEMENT_PARSER_VERSION,
  binanceArticlesToRawRecords,
  buildBinanceCanonicalDedupeKey,
  buildBinanceListQueryUrl,
  buildBinanceRequestHeaders,
  isBinanceHtmlSource,
  parseBinanceArticleListResponse,
  parseBinanceArticlePayload,
  selectRecentBinanceArticles,
  type BinanceArticlePayload
} from './binanceAnnouncementsParser'
import {
  OKX_ANNOUNCEMENTS_PARSER_VERSION,
  buildOkxAnnouncementsQueryUrl,
  buildOkxAnnouncementsRequestHeaders,
  isOkxAnnouncementPayload,
  isOkxAnnouncementsSource,
  normalizeOkxAnnouncementItem,
  okxAnnouncementsToRawRecords,
  parseOkxAnnouncementPayload,
  parseOkxAnnouncementsResponse
} from './okxAnnouncementsParser'
import type { IntelligenceSourceAdapter } from './sourceAdapter'

const DEFAULT_USER_AGENT = 'MacroBay/1.0 (intelligence-collector)'

export const htmlPagePollerAdapter: IntelligenceSourceAdapter = {
  adapterType: 'html-page-poller',
  parserVersion: BINANCE_ANNOUNCEMENT_PARSER_VERSION,
  supportedSourceIds: [
    'binance-announcements',
    'binance-api-updates',
    'okx-latest-announcements',
    'okx-api-announcements'
  ],
  async collect({ config, runId, fetchText }) {
    if (isBinanceHtmlSource(config.sourceId)) {
      return collectBinanceArticles({ config, runId })
    }

    // OKX's help centre is a client-rendered SPA, so the same announcements its page shows are read
    // from the official JSON endpoint that page itself calls. `fetchText` is the injected,
    // proxy-and-credential-aware transport, which keeps this path testable without a network.
    if (isOkxAnnouncementsSource(config.sourceId)) {
      if (!fetchText) return []
      const body = await fetchText(buildOkxAnnouncementsQueryUrl(config))
      return okxAnnouncementsToRawRecords({
        config,
        runId,
        announcements: parseOkxAnnouncementsResponse(body)
      })
    }

    const pageUrl = String(config.adapterConfig.pageUrl ?? '')
    if (!pageUrl || !fetchText) return []

    const html = await fetchText(pageUrl)
    return [
      {
        sourceId: config.sourceId,
        runId,
        payloadFormat: 'html',
        payloadRefType: 'inline',
        payloadBody: html,
        payloadHash: hashPayload(html),
        sourceDedupeKey: `html-fetch:${pageUrl}:${hashPayload(html).slice(0, 16)}`,
        parserVersion: parserVersionForSource(config.sourceId),
        payloadSizeBytes: new TextEncoder().encode(html).byteLength
      }
    ]
  },
  parseRawRecord({ config, rawRecord }) {
    const body = rawRecord.payloadBody ?? ''
    if (isBinanceArticlePayload(body)) {
      return parseBinanceArticlePayload(JSON.parse(body) as BinanceArticlePayload)
    }
    if (isOkxAnnouncementsSource(config.sourceId) && isOkxAnnouncementPayload(body)) {
      return parseOkxAnnouncementPayload(JSON.parse(body) as Record<string, unknown>)
    }

    throw new Error(`HTML parser not implemented for ${config.sourceId}.`)
  },
  normalizeParsedItem({ config, parsed, detectedAt }) {
    if (isOkxAnnouncementsSource(config.sourceId)) {
      return normalizeOkxAnnouncementItem({ config, parsed, detectedAt })
    }

    const vendorId = parsed.externalId ?? hashPayload(parsed.bodyText).slice(0, 16)
    return {
      canonicalDedupeKey: buildBinanceCanonicalDedupeKey(vendorId),
      title: parsed.title,
      summary: parsed.summary,
      url: parsed.sourceUrl,
      publishedAt: parsed.publishedAt,
      detectedAt,
      eventType: parsed.eventType,
      severityHint: parsed.severityHint,
      clusterKey: buildExchangeAnnouncementClusterKey(config.sourceId, vendorId),
      clusterType: 'announcement'
    }
  }
}

async function collectBinanceArticles(input: {
  config: Parameters<IntelligenceSourceAdapter['collect']>[0]['config']
  runId: string
}): Promise<AppendRawRecordInput[]> {
  const response = await intelligenceHttpRequest(
    {
      url: buildBinanceListQueryUrl(input.config),
      method: 'GET',
      headers: {
        ...buildBinanceRequestHeaders(input.config),
        'User-Agent': DEFAULT_USER_AGENT
      },
      timeoutMs: 30_000
    },
    {
      retryPolicy: { maxAttempts: 3, retryableStatuses: [408, 429, 500, 502, 503, 504] }
    }
  )

  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status} while fetching ${input.config.sourceId}.`)
  }

  const articles = parseBinanceArticleListResponse(response.bodyText)
  const configuredMaxAge = Number(input.config.adapterConfig.maxAgeDays)
  const recent = selectRecentBinanceArticles(articles, {
    nowMs: Date.now(),
    maxAgeDays: Number.isFinite(configuredMaxAge) ? configuredMaxAge : undefined
  })
  return binanceArticlesToRawRecords({
    config: input.config,
    runId: input.runId,
    articles: recent
  })
}

function isBinanceArticlePayload(body: string): boolean {
  if (!body.trimStart().startsWith('{')) return false
  try {
    const parsed = JSON.parse(body) as Partial<BinanceArticlePayload>
    return Boolean(parsed.code && parsed.title)
  } catch {
    return false
  }
}

function parserVersionForSource(sourceId: string): string {
  if (sourceId === 'binance-api-updates') return 'binance-api-updates-v1'
  if (isOkxAnnouncementsSource(sourceId)) return OKX_ANNOUNCEMENTS_PARSER_VERSION
  return BINANCE_ANNOUNCEMENT_PARSER_VERSION
}
