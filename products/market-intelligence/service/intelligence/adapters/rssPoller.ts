import { hashPayload } from '@platform/jobs'

import { normalizeEventType } from '../application/eventTypeNormalizer'
import { normalizePublishedAt, normalizePublishedAtFields, stripCdata, stripHtmlFragments } from '../application/publishedAtNormalizer'
import type { AppendRawRecordInput } from '../schema/intelligenceRecord'
import { buildRssCanonicalDedupeKey } from '../application/revisionResolver'
import type { IntelligenceSourceAdapter } from './sourceAdapter'

const PARSER_VERSION = 'rss-v1'

export const rssPollerAdapter: IntelligenceSourceAdapter = {
  adapterType: 'rss-poller',
  parserVersion: PARSER_VERSION,
  supportedSourceIds: [
    'coindesk-rss',
    'ethereum-foundation-blog',
    'sec-rss',
    'cftc-rss',
    'federal-reserve-rss'
  ],
  async collect({ config, runId, fetchText }) {
    const feedUrl = String(config.adapterConfig.feedUrl ?? '')
    if (!feedUrl) return []

    const body = fetchText ? await fetchText(feedUrl) : ''
    return parseRssFeedToRawRecords({ config: { sourceId: config.sourceId }, runId, xml: body })
  },
  parseRawRecord({ config, rawRecord }) {
    const body = rawRecord.payloadBody ?? ''
    if (body.trimStart().startsWith('{')) {
      return toParsedRecord(JSON.parse(body) as RssItem)
    }

    const items = parseRssItems(body)
    const first = items[0]
    if (!first) {
      throw new Error(`No RSS items found for ${config.sourceId}.`)
    }
    return toParsedRecord(first)
  },
  normalizeParsedItem({ config, parsed, rawRecordId, detectedAt }) {
    const eventType = normalizeEventType({
      eventType: parsed.eventType,
      sourceCategory: config.category,
      clusterType: config.category === 'regulation' || config.category === 'macro' ? 'macro-event' : 'news-event'
    })

    return {
      canonicalDedupeKey: buildRssCanonicalDedupeKey({
        guid: parsed.externalId,
        link: parsed.sourceUrl,
        title: parsed.title,
        publishedAt: parsed.publishedAt
      }),
      title: parsed.title,
      summary: parsed.summary,
      url: parsed.sourceUrl,
      publishedAt: parsed.publishedAt,
      detectedAt,
      entities: parsed.entities,
      symbols: parsed.symbols,
      eventType,
      severityHint: parsed.severityHint,
      clusterKey: `rss:${config.sourceId}:${buildRssCanonicalDedupeKey({
        guid: parsed.externalId,
        link: parsed.sourceUrl,
        title: parsed.title,
        publishedAt: parsed.publishedAt
      })}`,
      clusterType: config.category === 'regulation' || config.category === 'macro' ? 'macro-event' : 'news-event'
    }
  }
}

export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = []
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? []
  for (const block of itemBlocks) {
    items.push({
      guid: readTag(block, 'guid'),
      link: readTag(block, 'link'),
      title: readTag(block, 'title') ?? 'Untitled',
      description: readTag(block, 'description'),
      pubDate: readTag(block, 'pubDate')
    })
  }
  return items
}

export function parseRssFeedToRawRecords(input: {
  config: { sourceId: string }
  runId: string
  xml: string
}): AppendRawRecordInput[] {
  return parseRssItems(input.xml).map((item) => {
    const publishedFields = normalizePublishedAtFields(item.pubDate)
    const normalizedTitle = stripHtmlFragments(stripCdata(item.title))
    const normalizedDescription = item.description
      ? stripHtmlFragments(stripCdata(item.description))
      : undefined
    const payloadBody = JSON.stringify({
      ...item,
      title: normalizedTitle,
      description: normalizedDescription,
      pubDate: publishedFields.publishedAt ?? item.pubDate
    })
    const publishedAtForDedupe = publishedFields.publishedAt ?? item.pubDate
    return {
      sourceId: input.config.sourceId,
      runId: input.runId,
      externalId: item.guid,
      sourceUrl: item.link,
      publishedAtRaw: publishedFields.publishedAtRaw,
      publishedAt: publishedFields.publishedAt,
      payloadFormat: 'rss-item',
      payloadRefType: 'inline',
      payloadBody,
      payloadHash: hashPayload(payloadBody),
      sourceDedupeKey: buildRssCanonicalDedupeKey({
        guid: item.guid,
        link: item.link,
        title: normalizedTitle,
        publishedAt: publishedAtForDedupe
      }),
      parserVersion: PARSER_VERSION
    }
  })
}

type RssItem = {
  guid?: string
  link?: string
  title: string
  description?: string
  pubDate?: string
}

function toParsedRecord(item: RssItem) {
  const publishedFields = normalizePublishedAtFields(item.pubDate)
  const title = stripHtmlFragments(stripCdata(item.title))
  const summary = item.description ? stripHtmlFragments(stripCdata(item.description)) : undefined
  const bodyText = `${title}\n${summary ?? ''}`
  return {
    externalId: item.guid,
    sourceUrl: item.link,
    publishedAtRaw: publishedFields.publishedAtRaw,
    publishedAt: publishedFields.publishedAt,
    title,
    summary,
    bodyText,
    bodyHash: hashPayload(bodyText),
    eventType: 'news'
  }
}

function readTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  const raw = match?.[1]?.trim()
  if (!raw) return undefined
  return stripHtmlFragments(stripCdata(raw))
}
