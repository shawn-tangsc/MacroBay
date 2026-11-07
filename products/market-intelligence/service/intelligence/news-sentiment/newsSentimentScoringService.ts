import type { StructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'
import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import type { IntelligencePipeline } from '../application/intelligencePipeline'
import {
  NEWS_SENTIMENT_CAVEATS,
  NEWS_SENTIMENT_PROMPT_VERSION,
  NEWS_SENTIMENT_SOURCE_IDS,
  OKX_SENTIMENT_ANN_TYPES,
  type NewsSentimentJudgment,
  type NewsSentimentRecord
} from '../schema/newsSentiment'
import { buildNewsSentimentMessages, parseNewsPolarityModelOutput } from './newsSentimentModel'
import { scoreNewsWithRules } from './newsSentimentRules'
import { storyKeyOf, utcDayBucket, type StoryKeyCandidate } from './newsSentimentStoryKey'
import { createNewsSentimentAlertOutlet } from './newsSentimentAlertOutlet'
import { buildSentimentAlertRequest } from './newsSentimentAlertRequest'
import { createNewsPushLedgerStore } from './newsPushLedgerStore'

export { newsPushLedgerPolicy } from './newsPushLedgerStore'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { getIntelligenceSourceDefinition } from '../application/sourceCatalog'
import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
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
  /** Model calls spent by this run, retries included — the same allowance the pass is capped by. */
  modelCalls: number
}>

/** 154 §7.1：单条失败重试 1 次（一次调用 + 一次重试）。 */
const MAX_ATTEMPTS_PER_ITEM = 2
/** 154 §7.1：连续 3 条没拿到模型判断，本轮余下条目不再调用模型。 */
const CONSECUTIVE_FAILURES_BEFORE_FALLBACK = 3

const SOURCES = new Set<string>(NEWS_SENTIMENT_SOURCE_IDS)
const OKX_TYPES = new Set<string>(OKX_SENTIMENT_ANN_TYPES)

/**
 * 一条新闻 → 一条可复核的判断。模型可用时用模型，否则用规则；结果按版本落库，
 * 同一引擎版本不重复评分（设计 154 §7）。
 */
export function createNewsSentimentScoringService(deps: {
  pipeline: Pick<IntelligencePipeline, 'listItems'>
  store: Pick<NewsSentimentStore, 'getLatestSentiment' | 'getDocument' | 'upsertSentiment' | 'listLatestSentiment'>
  settingsStore: Pick<NewsSentimentSettingsStore, 'getSettings'>
  getProviderState?: () => Promise<ProviderState>
  getModelDefaults?: () => Promise<ModelDefaultsSettings>
  invoke: NewsSentimentInvoke
  now: () => string
  maxPerRun?: number
  /**
   * 推送出口。给了它，每条判断落库之后过一遍三道闸；没给就一条都不推（默认关）。
   *
   * 它**不影响评分**：通知那边抖一下不该让这一轮评分算失败，所以异常在这里吞掉。代价说清楚——
   * 提交失败的那条已经在账本里记成「推过」，不会重推；宁可漏一条，也不重复打扰。
   */
  alertDelivery?: {
    ledgerPath: string
    submit: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
    /** 读者设的强度门槛；缺省「中」。 */
    threshold?: () => 'low' | 'medium' | 'high'
  }
}) {
  /**
   * 判定点。`eventTypeId` 必须出现在 `submit(...)` 的实参里：生产者门禁认的是「提交那一刻的
   * 实参」，藏在别的函数的载荷里会被记成无法判定，等于给「已经接好了」发假证书。
   */
  const alertOutlet = deps.alertDelivery
    ? createNewsSentimentAlertOutlet({
        ledger: createNewsPushLedgerStore(deps.alertDelivery.ledgerPath),
        deliver: async (alert) => {
          const request = buildSentimentAlertRequest(alert)
          if (!request) return
          await deps.alertDelivery!.submit({
            eventTypeId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.sentimentAlert,
            ...request
          })
        },
        now: deps.now,
        ...(deps.alertDelivery.threshold ? { threshold: deps.alertDelivery.threshold } : {})
      })
    : undefined
  return {
    async scoreItems(input: { itemIds?: string[]; limit?: number }): Promise<NewsSentimentScoringResult> {
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
      // One number for the whole pass: how many items it may judge is also how many model calls it
      // may spend, and a retry is spent from the same allowance. A second counter would drift from
      // this one the day either changes (the lesson of the analysis budget).
      const runBudget = Math.max(1, input.limit ?? deps.maxPerRun ?? 20)
      const candidates = admitted
        .filter((item) => !requestedIds || requestedIds.has(item.itemId))
        .filter((item) => !isCurrent(deps.store.getLatestSentiment(item.itemId, deps.now()), useModel, modelRef))
        // The pass is capped; newest first so the visible window fills before older backlog.
        .sort((left, right) => (right.publishedAt ?? '').localeCompare(left.publishedAt ?? ''))
        .slice(0, runBudget)

      let processed = 0
      let modelCount = 0
      let rulesCount = 0
      let skipped = 0
      let failed = 0
      let modelCalls = 0
      // 154 §7.1: three judgments in a row without a model answer means this run stops paying for one.
      let consecutiveModelFailures = 0

      /**
       * One model attempt. `'invalid'` means the model answered but broke the contract; `'failed'`
       * is the transient kind the caller is allowed to retry once.
       */
      const invokeOnce = async (
        target: { itemId: string; sourceId: string; publishedAt: string; title: string },
        body: string,
        providerId: string,
        modelId: string
      ): Promise<NewsSentimentJudgment | 'invalid' | 'failed'> => {
        try {
          const result = await deps.invoke<NewsSentimentJudgment | null>({
            taskId: `market-intelligence.news-sentiment:${target.itemId}`,
            providerId,
            modelId,
            messages: buildNewsSentimentMessages({
              sourceName: target.sourceId,
              publishedAt: target.publishedAt,
              title: target.title,
              body
            }),
            parse: (raw) => {
              const parsed = parseNewsPolarityModelOutput(raw, body)
              return parsed.ok ? parsed.value : null
            },
            timeoutMs: 30_000
          })
          if (!result.ok) return 'failed'
          return result.output ?? 'invalid'
        } catch {
          return 'failed'
        }
      }

      /**
       * 同一个 UTC 日里已经有判断的条目：归并键的「同一天同一簇」要靠它们才成立。
       * 按日缓存，一轮 pass 里同一天的 20 条只读一次库；本轮新落库的条目也追加进来，
       * 否则同一批里两条讲同一件事的新闻会各拿自己的键（漏并）。
       */
      const dayPeers = new Map<string, StoryKeyCandidate[]>()
      const readPeers = (publishedAt: string): StoryKeyCandidate[] => {
        const day = utcDayBucket(publishedAt)
        if (!day) return []
        const cached = dayPeers.get(day)
        if (cached) return cached
        const peers = deps.store
          .listLatestSentiment({ from: `${day}T00:00:00.000Z`, to: `${day}T23:59:59.999Z`, limit: 500 })
          .map((row) => ({
            itemId: row.itemId,
            publishedAt: row.publishedAt,
            entities: row.entities ?? [],
            ...(row.storyKey ? { storyKey: row.storyKey } : {})
          }))
        dayPeers.set(day, peers)
        return peers
      }

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
          const providerId = model.providerId
          const modelId = model.modelId
          let modelJudgment: NewsSentimentJudgment | null = null
          let modelError: 'invalid' | 'failed' | 'budget' | 'degraded' = 'failed'

          if (modelCalls >= runBudget) {
            modelError = 'budget'
          } else if (consecutiveModelFailures >= CONSECUTIVE_FAILURES_BEFORE_FALLBACK) {
            modelError = 'degraded'
          } else {
            for (
              let attempt = 0;
              attempt < MAX_ATTEMPTS_PER_ITEM && modelCalls < runBudget;
              attempt += 1
            ) {
              modelCalls += 1
              const outcome = await invokeOnce(
                { itemId: item.itemId, sourceId: item.sourceId, publishedAt: item.publishedAt, title: item.title },
                body,
                providerId,
                modelId
              )
              if (typeof outcome === 'object') {
                modelJudgment = outcome
                break
              }
              modelError = outcome
              // 154 §7.1 retries a failed call once. An invalid output is an answer, not a transient
              // fault — it keeps its own caveat instead of buying a second identical prompt.
              if (outcome === 'invalid') break
            }
            // Running out of the pass's allowance is the reason this item got no model answer, even
            // though the last attempt that fit also failed.
            if (!modelJudgment && modelCalls >= runBudget) modelError = 'budget'
          }

          if (modelJudgment) {
            consecutiveModelFailures = 0
            judgment = modelJudgment
            engine = 'model'
            modelRefUsed = modelRef
            promptVersion = NEWS_SENTIMENT_PROMPT_VERSION
          } else {
            consecutiveModelFailures += 1
            judgment = scoreNewsWithRules({ title: item.title, summary: item.summary })
            engine = 'rules'
            ruleId = judgment.reasonCode
            caveats.push(
              modelError === 'invalid'
                ? NEWS_SENTIMENT_CAVEATS.modelInvalidOutput
                : modelError === 'budget'
                  ? NEWS_SENTIMENT_CAVEATS.modelBudgetExhausted
                  : modelError === 'degraded'
                    ? NEWS_SENTIMENT_CAVEATS.modelDegraded
                    : NEWS_SENTIMENT_CAVEATS.modelUnavailable
            )
          }
        } else {
          judgment = scoreNewsWithRules({ title: item.title, summary: item.summary })
          engine = 'rules'
          ruleId = judgment.reasonCode
          if (settings.modelScoringEnabled) caveats.push(NEWS_SENTIMENT_CAVEATS.modelUnavailable)
        }

        // 归并键只从实体集与 UTC 日桶合成；规则兜底没有实体，因此没有键（没有键就不推）。
        const entities = judgment.entities ?? []
        const peers = readPeers(item.publishedAt)
        const storyKey = storyKeyOf({
          itemId: item.itemId,
          publishedAt: item.publishedAt,
          entities,
          peers
        })

        const record: NewsSentimentRecord = {
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
          ...(entities.length > 0 ? { entities } : {}),
          ...(storyKey ? { storyKey } : {}),
          ...(judgment.why ? { why: judgment.why } : {}),
          engine,
          ...(modelRefUsed ? { modelRef: modelRefUsed } : {}),
          ...(promptVersion ? { promptVersion } : {}),
          ...(ruleId ? { ruleId } : {}),
          caveats: [...new Set([...judgment.caveats, ...bodyCaveats, ...caveats])]
        }
        deps.store.upsertSentiment(record)
        await Promise.resolve(
          alertOutlet?.onJudged({
            ...record,
            headline: item.title,
            url: item.url,
            sourceName: getIntelligenceSourceDefinition(item.sourceId)?.displayName ?? item.sourceId
          })
        ).catch(() => undefined)
        if (entities.length > 0 && storyKey) {
          const day = utcDayBucket(item.publishedAt)
          if (day) readPeers(item.publishedAt).push({ itemId: item.itemId, publishedAt: item.publishedAt, entities, storyKey })
        }
        processed += 1
        if (engine === 'model') modelCount += 1
        else rulesCount += 1
      }

      const requestedCount = requestedIds ? requestedIds.size : admitted.length
      skipped = Math.max(0, requestedCount - candidates.length)
      return { processed, model: modelCount, rules: rulesCount, skipped, failed, modelCalls }
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
  modelRef: string | undefined
): boolean {
  if (!latest) return false
  if (!useModel) return latest.engine === 'rules'
  return (
    latest.engine === 'model' &&
    latest.promptVersion === NEWS_SENTIMENT_PROMPT_VERSION &&
    latest.modelRef === modelRef
  )
}
