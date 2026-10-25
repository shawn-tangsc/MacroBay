import type { StructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'
import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import type { IntelligencePipeline } from '../application/intelligencePipeline'
import {
  NEWS_SENTIMENT_CAVEATS,
  NEWS_SENTIMENT_EXTRACTION_VERSION,
  NEWS_SENTIMENT_PROMPT_VERSION,
  NEWS_SENTIMENT_SOURCE_IDS,
  OKX_SENTIMENT_ANN_TYPES,
  type NewsSentimentJudgment,
  type NewsSentimentRecord
} from '../schema/newsSentiment'
import { buildNewsSentimentMessages, parseNewsPolarityModelOutput } from './newsSentimentModel'
import { scoreNewsWithRules } from './newsSentimentRules'
import { resolveNewsSentimentModel } from './newsSentimentSettings'
import type { NewsSentimentSettingsStore } from './newsSentimentSettingsStore'
import type { NewsSentimentStore } from './newsSentimentStore'

export type NewsSentimentInvoke = StructuredModelInvocationService['invoke']

export type NewsSentimentScoringResult = Readonly<{
  processed: number
  model: number
  rules: number
  skipped: number
  failed: number
}>

const SOURCES = new Set<string>(NEWS_SENTIMENT_SOURCE_IDS)
const OKX_TYPES = new Set<string>(OKX_SENTIMENT_ANN_TYPES)

/**
 * 一条新闻 → 一条可复核的判断。模型可用时用模型，否则用规则；结果按版本落库，
 * 同一引擎版本不重复评分（设计 154 §7）。
 */
export function createNewsSentimentScoringService(deps: {
  pipeline: Pick<IntelligencePipeline, 'listItems'>
  store: Pick<NewsSentimentStore, 'getLatestSentiment' | 'getDocument' | 'upsertSentiment'>
  settingsStore: Pick<NewsSentimentSettingsStore, 'getSettings'>
  getProviderState?: () => Promise<ProviderState>
  getModelDefaults?: () => Promise<ModelDefaultsSettings>
  invoke: NewsSentimentInvoke
  now: () => string
  maxPerRun?: number
}) {
  return {
    async scoreItems(input: { itemIds?: string[] }): Promise<NewsSentimentScoringResult> {
      const settings = await deps.settingsStore.getSettings()
      const [providerState, modelDefaults] = await Promise.all([
        deps.getProviderState?.().catch(() => undefined) ?? Promise.resolve(undefined),
        deps.getModelDefaults?.().catch(() => undefined) ?? Promise.resolve(undefined)
      ])
      const model = resolveNewsSentimentModel({
        settings,
        modelDefaults: modelDefaults ?? null,
        providers: providerState?.providers ?? []
      })
      const modelRef =
        model.providerId && model.modelId ? `${model.providerId}:${model.modelId}` : undefined
      const useModel = settings.modelScoringEnabled && Boolean(modelRef)

      const admitted = deps.pipeline.listItems().filter(isAdmittedItem)
      const requestedIds = input.itemIds?.length ? new Set(input.itemIds) : undefined
      const candidates = admitted
        .filter((item) => !requestedIds || requestedIds.has(item.itemId))
        .filter((item) => !isCurrent(deps.store.getLatestSentiment(item.itemId, deps.now()), useModel, modelRef, deps.store.getDocument(item.itemId)))
        // The pass is capped; newest first so the visible window fills before older backlog.
        .sort((left, right) => (right.publishedAt ?? '').localeCompare(left.publishedAt ?? ''))
        .slice(0, deps.maxPerRun ?? 20)

      let processed = 0
      let modelCount = 0
      let rulesCount = 0
      let skipped = 0
      let failed = 0

      for (const item of candidates) {
        if (!item.publishedAt) {
          failed += 1
          continue
        }
        const document = deps.store.getDocument(item.itemId)
        const hasBody = document?.state === 'available' && Boolean(document.bodyText)
        const body = hasBody ? document!.bodyText! : `${item.title}\n${item.summary ?? ''}`
        const bodyCaveats = hasBody ? [] : [NEWS_SENTIMENT_CAVEATS.bodyLimited]

        let judgment: NewsSentimentJudgment
        let engine: NewsSentimentRecord['engine']
        let modelRefUsed: string | undefined
        let promptVersion: string | undefined
        let ruleId: string | undefined
        const caveats: string[] = []

        if (useModel && model.providerId && model.modelId) {
          let modelJudgment: NewsSentimentJudgment | null = null
          let modelError: 'invalid' | 'failed' = 'failed'
          try {
            const result = await deps.invoke<NewsSentimentJudgment | null>({
              taskId: `market-intelligence.news-sentiment:${item.itemId}`,
              providerId: model.providerId,
              modelId: model.modelId,
              messages: buildNewsSentimentMessages({
                sourceName: item.sourceId,
                publishedAt: item.publishedAt,
                title: item.title,
                body
              }),
              parse: (raw) => {
                const parsed = parseNewsPolarityModelOutput(raw, body)
                if (parsed.ok) return parsed.value
                modelError = 'invalid'
                return null
              },
              timeoutMs: 30_000
            })
            if (result.ok && result.output) modelJudgment = result.output
            else if (result.ok) modelError = 'invalid'
          } catch {
            modelError = 'failed'
          }

          if (modelJudgment) {
            judgment = modelJudgment
            engine = 'model'
            modelRefUsed = modelRef
            promptVersion = NEWS_SENTIMENT_PROMPT_VERSION
          } else {
            judgment = scoreNewsWithRules({ title: item.title, summary: item.summary })
            engine = 'rules'
            ruleId = judgment.reasonCode
            caveats.push(
              modelError === 'invalid'
                ? NEWS_SENTIMENT_CAVEATS.modelInvalidOutput
                : NEWS_SENTIMENT_CAVEATS.modelUnavailable
            )
          }
        } else {
          judgment = scoreNewsWithRules({ title: item.title, summary: item.summary })
          engine = 'rules'
          ruleId = judgment.reasonCode
          if (settings.modelScoringEnabled) caveats.push(NEWS_SENTIMENT_CAVEATS.modelUnavailable)
        }

        deps.store.upsertSentiment({
          itemId: item.itemId,
          sourceId: item.sourceId,
          publishedAt: item.publishedAt,
          scoredAt: deps.now(),
          polarity: judgment.polarity,
          strength: judgment.strength,
          confidence: judgment.confidence,
          symbols: judgment.symbols,
          reasonCode: judgment.reasonCode,
          ...(judgment.evidenceQuote ? { evidenceQuote: judgment.evidenceQuote } : {}),
          engine,
          ...(modelRefUsed ? { modelRef: modelRefUsed } : {}),
          ...(promptVersion ? { promptVersion } : {}),
          ...(ruleId ? { ruleId } : {}),
          caveats: [...new Set([...judgment.caveats, ...bodyCaveats, ...caveats])]
        })
        processed += 1
        if (engine === 'model') modelCount += 1
        else rulesCount += 1
      }

      const requestedCount = requestedIds ? requestedIds.size : admitted.length
      skipped = Math.max(0, requestedCount - candidates.length)
      return { processed, model: modelCount, rules: rulesCount, skipped, failed }
    }
  }
}

function isAdmittedItem(item: {
  sourceId: string
  summary?: string
}): boolean {
  if (!SOURCES.has(item.sourceId)) return false
  if (item.sourceId !== 'okx-latest-announcements') return true
  return typeof item.summary === 'string' && OKX_TYPES.has(item.summary.trim())
}

function isCurrent(
  latest: NewsSentimentRecord | undefined,
  useModel: boolean,
  modelRef: string | undefined,
  document?: { extractionVersion: string }
): boolean {
  if (!latest) return false
  // A new extraction version means the old judgment was made from a different body (or none).
  if (document && document.extractionVersion !== NEWS_SENTIMENT_EXTRACTION_VERSION) return false
  if (!useModel) return latest.engine === 'rules'
  return (
    latest.engine === 'model' &&
    latest.promptVersion === NEWS_SENTIMENT_PROMPT_VERSION &&
    latest.modelRef === modelRef
  )
}
