import { getIntelligenceSourceDefinition } from '../application/sourceCatalog'
import { aggregateSentimentSignals } from '../application/sentimentScoring'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { IntelligenceSentimentHorizon, SentimentSignalInput } from '../schema/intelligenceSentiment'
import {
  NEWS_SENTIMENT_CAVEATS,
  NEWS_SENTIMENT_WINDOW_MS,
  type NewsPolarity,
  type NewsSentimentQuery,
  type NewsSentimentRecord,
  type NewsSentimentSymbol,
  type NewsSentimentWindow
} from '../schema/newsSentiment'
import type { NewsSentimentStore } from './newsSentimentStore'
import type { NewsBodyTranslationRecord } from '../schema/newsSentiment'
import { isRoutineNewsNotice } from './newsSentimentRules'

type TranslationReader = {
  resolveDisplayTexts: (input: {
    itemIds: string[]
    textMode?: 'translated' | 'original'
  }) => Promise<Record<string, { title?: string; status?: string } | undefined>>
}

export type NewsSentimentItemView = {
  itemId: string
  title: string
  displayTitle?: string
  sourceId: string
  sourceName: string
  url?: string
  publishedAt: string
  scoredAt: string
  polarity: NewsPolarity
  strength: number
  confidence: number
  symbols: NewsSentimentSymbol[]
  reasonCode: string
  evidenceQuote?: string
  engine: 'model' | 'rules'
  modelRef?: string
  promptVersion?: string
  caveats: string[]
  bodyTranslationState?: 'translated' | 'failed' | 'missing'
}

export type NewsSentimentView = {
  state: 'available' | 'empty' | 'unavailable'
  asOf: string
  generatedAt: string
  window: NewsSentimentWindow
  summary?: {
    label: 'positive' | 'negative' | 'neutral' | 'mixed'
    score: number
    itemCount: number
    directionalCount: number
    neutralCount: number
    sourceBreakdown: Record<string, number>
    latestItemAt?: string
    engineMix: { model: number; rules: number }
    lastScoredAt?: string
  }
  items: NewsSentimentItemView[]
  caveats: string[]
}

export type NewsSentimentItemDetail = NewsSentimentItemView & {
  bodyExcerpt?: string
  translatedBodyExcerpt?: string
  asOf: string
}

/**
 * 读时聚合：窗口在查询时计算，不落物化表。打分复用既有 `aggregateSentimentSignals`，
 * 因此 recency decay、scope 权重与 mixed 判定只有一份实现（设计 154 §8.2）。
 */
export function createNewsSentimentQuery(deps: {
  store: Pick<NewsSentimentStore, 'listLatestSentiment' | 'getLatestSentiment' | 'getDocument'>
  pipeline: Pick<IntelligencePipeline, 'listItems'>
  translation?: TranslationReader
  now: () => string
}) {
  return {
    async query(input: NewsSentimentQuery): Promise<NewsSentimentView> {
      const asOf = normalizeAsOf(input.asOf)
      const window = input.window
      const generatedAt = deps.now()
      if (!asOf || !NEWS_SENTIMENT_WINDOW_MS[window]) {
        return { state: 'unavailable', asOf: input.asOf, generatedAt, window, items: [], caveats: [NEWS_SENTIMENT_CAVEATS.queryFailed] }
      }

      try {
        const displayLocale = await deps.getDisplayLocale?.()
        const from = new Date(Date.parse(asOf) - NEWS_SENTIMENT_WINDOW_MS[window]).toISOString()
        const rows = deps.store.listLatestSentiment({ from, to: asOf, limit: 500 })
        const itemsById = new Map(deps.pipeline.listItems().map((item) => [item.itemId, item]))
        const visible = rows
          .filter((row) => {
            const item = itemsById.get(row.itemId)
            if (!item) return false
            return !isRoutineNewsNotice({ title: item.title, polarity: row.polarity, strength: row.strength })
          })
          .filter((row) => matchesScope(row, input.scope))
          .filter((row) => !input.direction || input.direction === 'all' || row.polarity === input.direction)
          .filter((row) => !input.sourceId || row.sourceId === input.sourceId)
          .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
          .slice(0, Math.max(1, Math.min(input.limit ?? 100, 100)))

        if (visible.length === 0) {
          return { state: 'empty', asOf, generatedAt, window, items: [], caveats: [NEWS_SENTIMENT_CAVEATS.emptyWindow] }
        }

        const itemIds = visible.map((row) => row.itemId)
        const translations = await readTranslations(deps.translation, itemIds)
        const items = visible.map((row) => {
          const translatedTitle = deps.bodyTranslation?.get(row.itemId, displayLocale)?.titleText
          return {
            ...toItemView(row, itemsById.get(row.itemId), translations[row.itemId]),
            ...(translatedTitle ? { displayTitle: translatedTitle } : {}),
            bodyTranslationState: deps.bodyTranslation?.status?.(row.itemId, displayLocale) ?? 'missing'
          }
        })
        const aggregate = aggregateView(visible, itemsById, input, asOf)
        const caveats = [...new Set(visible.flatMap((row) => row.caveats))]

        return {
          state: 'available',
          asOf,
          generatedAt,
          window,
          summary: {
            label: aggregate.label,
            score: aggregate.score,
            itemCount: visible.length,
            directionalCount: aggregate.directionalCount,
            neutralCount: visible.filter((row) => row.polarity === 'neutral').length,
            sourceBreakdown: aggregate.sourceBreakdown,
            ...(visible[0]?.publishedAt ? { latestItemAt: visible[0].publishedAt } : {}),
            engineMix: {
              model: visible.filter((row) => row.engine === 'model').length,
              rules: visible.filter((row) => row.engine === 'rules').length
            },
            lastScoredAt: visible.map((row) => row.scoredAt).sort().at(-1)
          },
          items,
          caveats
        }
      } catch {
        return { state: 'unavailable', asOf: input.asOf, generatedAt, window, items: [], caveats: [NEWS_SENTIMENT_CAVEATS.queryFailed] }
      }
    },

    async getItem(input: { itemId: string; asOf: string }): Promise<NewsSentimentItemDetail | undefined> {
      const asOf = normalizeAsOf(input.asOf)
      if (!asOf) return undefined
      const row = deps.store.getLatestSentiment(input.itemId, asOf)
      if (!row) return undefined
      const item = deps.pipeline.listItems().find((entry) => entry.itemId === input.itemId)
      if (!item) return undefined
      const translations = await readTranslations(deps.translation, [input.itemId])
      const document = deps.store.getDocument(input.itemId)
      const displayLocale = await deps.getDisplayLocale?.()
      const translatedBody = deps.bodyTranslation?.get(input.itemId, displayLocale)?.bodyText
      const bodyTitle = translatedBody ? deps.bodyTranslation?.get(input.itemId, displayLocale)?.titleText : undefined
      return {
        ...toItemView(row, item, translations[input.itemId]),
        ...(bodyTitle ? { displayTitle: bodyTitle } : {}),
        ...(document?.state === 'available' && document.bodyText
          ? { bodyExcerpt: document.bodyText.slice(0, 8_000) }
          : {}),
        ...(translatedBody ? { translatedBodyExcerpt: translatedBody.slice(0, 8_000) } : {}),
        asOf
      }
    }
  }
}

function aggregateView(
  rows: NewsSentimentRecord[],
  itemsById: Map<string, { sourceCategory?: string; sourceTrust?: string }>,
  input: NewsSentimentQuery,
  asOf: string
) : { label: NonNullable<NewsSentimentView['summary']>['label']; score: number; directionalCount: number; sourceBreakdown: Record<string, number> } {
  const scopeType = input.scope === 'BTC' || input.scope === 'ETH' ? 'symbol' : 'crypto-market'
  const scopeKey = scopeType === 'symbol' ? input.scope! : 'global'
  const signals = rows.map((row) => toSignal(row, itemsById.get(row.itemId), scopeType, scopeKey, input.window))
  const aggregate = aggregateSentimentSignals(
    { scopeType, scopeKey, horizon: input.window as IntelligenceSentimentHorizon, signals },
    Date.parse(asOf)
  )
  return {
    label: aggregate.aggregateLabel,
    score: round(aggregate.aggregateScore),
    directionalCount: aggregate.signalCount,
    sourceBreakdown: parseRecord(aggregate.sourceGroupBreakdownJson)
  }
}

function toSignal(
  row: NewsSentimentRecord,
  item: { sourceCategory?: string; sourceTrust?: string } | undefined,
  scopeType: 'crypto-market' | 'symbol',
  scopeKey: string,
  window: NewsSentimentWindow
): SentimentSignalInput {
  return {
    signalId: `news:${row.itemId}:${scopeType}:${scopeKey}:${window}`,
    itemId: row.itemId,
    scopeType,
    scopeKey,
    horizon: window as IntelligenceSentimentHorizon,
    sourceGroup: item?.sourceCategory ?? row.sourceId,
    sentimentLabel: polarityToLabel(row.polarity),
    strength: row.strength,
    confidence: row.confidence,
    trustLevel: (item?.sourceTrust as 'high' | 'medium' | 'low' | undefined) ?? 'high',
    createdAt: row.publishedAt
  }
}

function toItemView(
  row: NewsSentimentRecord,
  item: { itemId: string; title: string; url?: string; sourceId: string } | undefined,
  translation: { title?: string; status?: string } | undefined
): NewsSentimentItemView {
  const definition = getIntelligenceSourceDefinition(row.sourceId)
  return {
    itemId: row.itemId,
    title: item?.title ?? '',
    ...(translation?.status === 'translated' && translation.title ? { displayTitle: translation.title } : {}),
    sourceId: row.sourceId,
    sourceName: definition?.displayName ?? row.sourceId,
    ...(item?.url ? { url: item.url } : {}),
    publishedAt: row.publishedAt,
    scoredAt: row.scoredAt,
    polarity: row.polarity,
    strength: row.strength,
    confidence: row.confidence,
    symbols: row.symbols,
    reasonCode: row.reasonCode,
    ...(row.evidenceQuote ? { evidenceQuote: row.evidenceQuote } : {}),
    engine: row.engine,
    ...(row.modelRef ? { modelRef: row.modelRef } : {}),
    ...(row.promptVersion ? { promptVersion: row.promptVersion } : {}),
    caveats: row.caveats
  }
}

async function readTranslations(
  reader: TranslationReader | undefined,
  itemIds: string[]
): Promise<Record<string, { title?: string; status?: string } | undefined>> {
  if (!reader) return {}
  try {
    return await reader.resolveDisplayTexts({ itemIds, textMode: 'translated' })
  } catch {
    return {}
  }
}

function matchesScope(row: NewsSentimentRecord, scope: NewsSentimentQuery['scope']): boolean {
  if (!scope || scope === 'market') return true
  return row.symbols.includes(scope)
}

function polarityToLabel(polarity: NewsPolarity): 'positive' | 'negative' | 'neutral' | 'mixed' {
  if (polarity === 'bullish') return 'positive'
  if (polarity === 'bearish') return 'negative'
  return polarity
}

function normalizeAsOf(value: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return undefined
  return new Date(parsed).toISOString()
}

function parseRecord(value: string | undefined): Record<string, number> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, entry]) => typeof entry === 'number' && Number.isFinite(entry))
        .map(([key, entry]) => [key, round(entry as number)])
    )
  } catch {
    return {}
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
