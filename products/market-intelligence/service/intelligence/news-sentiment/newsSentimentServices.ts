import { join } from 'node:path'

import type { IntelligenceModulePlatformHooks } from '../intelligenceModule'
import type { createSourceProfileStore } from '../application/sourceProfileStore'
import type { createIntelligenceTranslationService } from '../application/intelligenceTranslationService'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { createStructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'

import { intelligenceHttpRequest } from '../adapters/intelligenceHttpClient'
import { INTELLIGENCE_DEFAULT_USER_AGENT } from '../adapters/intelligenceHttpFetch'
import { listIntelligenceSourceDefinitions } from '../application/sourceCatalog'
import { resolveRuntimeConfig } from '../application/sourceRuntimeConfig'
import { buildSourceCoverageAsOf } from '../public-query/sourceCoverageAsOf'
import { NEWS_SENTIMENT_SOURCE_IDS } from '../schema/newsSentiment'
import { createNewsSentimentBodyTranslationService } from './newsSentimentBodyTranslation'
import { createNewsSentimentEnrichmentService } from './newsSentimentEnrichmentService'
import { createNewsSentimentQuery } from './newsSentimentQuery'
import { summarizeNewsSentimentReadiness } from './newsSentimentReadiness'
import { createNewsSentimentScoringService, newsPushLedgerPolicy } from './newsSentimentScoringService'
import type { createNewsSentimentSettingsStore } from './newsSentimentSettingsStore'
import type { createIntelligenceTranslationJsonStorage } from '../store/intelligenceTranslationStorage'
import type { createNewsSentimentSqliteStore } from './newsSentimentStore'

export type NewsSentimentServiceDeps = Readonly<{
  pipeline: IntelligencePipeline
  settingsStore: ReturnType<typeof createNewsSentimentSettingsStore>
  translationService: ReturnType<typeof createIntelligenceTranslationService>
  translationSettingsStorage: Pick<ReturnType<typeof createIntelligenceTranslationJsonStorage>, 'readSettings'>
  invoke: ReturnType<typeof createStructuredModelInvocationService>['invoke']
  getAppLanguage: () => Promise<'zh-CN' | 'en-US'>
  profileStore: Pick<ReturnType<typeof createSourceProfileStore>, 'listProfiles'>
  hooks?: IntelligenceModulePlatformHooks
  dataDir: string
  now?: () => string
}>

/** 内容抓取与打分共用的「现在」；测试可注入，生产走系统时钟。 */
/**
 * Publishers disagree about who may read them: SEC.gov returns 403 to a browser user agent but 200
 * to the identified collector, while CoinDesk hands a body-less variant to the collector UA. Pick
 * the headers per host instead of one global article fingerprint.
 */
/**
 * Electron's net.fetch shares Chromium's HTTP cache. A body-less variant fetched once can be
 * served again to every later request for the same URL, even with different headers, so article
 * reads carry a unique query key as well as no-store.
 */
function articleFetchUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.endsWith('coindesk.com') || parsed.hostname.endsWith('okx.com')) {
      parsed.searchParams.set('mb_nocache', String(Date.now()))
    }
    return parsed.toString()
  } catch {
    return url
  }
}
function articleFetchHeaders(url: string): Record<string, string> {
  if (url.includes('sec.gov')) {
    return { Accept: 'text/html', 'User-Agent': INTELLIGENCE_DEFAULT_USER_AGENT, 'Cache-Control': 'no-cache' }
  }
  if (url.includes('binance.com/bapi')) {
    return { Accept: 'application/json', 'User-Agent': INTELLIGENCE_DEFAULT_USER_AGENT, 'Cache-Control': 'no-cache' }
  }
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache'
  }
}

/**
 * 舆情服务的唯一装配处：内容抓取、打分、正文翻译、读取查询。
 *
 * 从组合根抽出来（0.4.2 体积门禁）：组合根只该有「把什么拼成什么」。重建入口也要用同一份
 * 装配，所以这里必须是唯一实现，不能在组合根和重建路径各写一份。
 */
export function createNewsSentimentServices(
  store: ReturnType<typeof createNewsSentimentSqliteStore>,
  deps: NewsSentimentServiceDeps
) {
  const {
    pipeline,
    translationService,
    translationSettingsStorage,
    getAppLanguage,
    profileStore,
    hooks,
    dataDir,
    settingsStore: newsSentimentSettingsStore
  } = deps
  const structuredModelInvocation = { invoke: deps.invoke }
  const now = deps.now ?? ((): string => new Date().toISOString())
  const enrichment = createNewsSentimentEnrichmentService({
    pipeline,
    store,
    fetchArticle: async (url) => {
      const response = await intelligenceHttpRequest(
        {
          url: articleFetchUrl(url),
          method: 'GET',
          headers: articleFetchHeaders(url),
          cache: 'no-store',
          credentials: 'omit',
          timeoutMs: 15_000
        },
        { retryPolicy: { maxAttempts: 1 } }
      )
      return { status: response.status, bodyText: response.bodyText }
    },
    now
  })
  const scoring = createNewsSentimentScoringService({
    pipeline,
    store,
    settingsStore: newsSentimentSettingsStore,
    ...(hooks?.getProviderState ? { getProviderState: hooks.getProviderState } : {}),
    ...(hooks?.getModelDefaults ? { getModelDefaults: hooks.getModelDefaults } : {}),
    invoke: structuredModelInvocation.invoke,
    ...(hooks?.submitNotification ? { alertDelivery: { ledgerPath: join(dataDir, newsPushLedgerPolicy.fileName), thresholdFilePath: join(dataDir, 'intelligence-news-push-threshold.json'), submit: hooks.submitNotification } } : {}),
    now
  })
  const bodyTranslation = createNewsSentimentBodyTranslationService({
    store,
    invoke: structuredModelInvocation.invoke,
    readSettings: async () => {
      const settings = await translationSettingsStorage.readSettings()
      // Body translation always targets the language the app is currently displayed in, not a
      // separate preference that could drift from the UI locale.
      return { settings, targetLocale: await getAppLanguage() }
    },
    getProviderState: hooks?.getProviderState,
    getModelDefaults: hooks?.getModelDefaults,
    getTitle: (itemId) => pipeline.listItems().find((item) => item.itemId === itemId)?.title,
    now
  })
  const query = createNewsSentimentQuery({
    store,
    pipeline,
    translation: translationService,
    getDisplayLocale: getAppLanguage,
    bodyTranslation,
    // The four sources' readiness, read from the one projection that already answers "what is
    // this source doing": the card needs it to name the cause of an empty window.
    readSourceReadiness: async (asOf) => {
      const profiles = await profileStore.listProfiles()
      const enabledSourceIds = new Set(profiles.filter((profile) => profile.enabled).map((profile) => profile.sourceId))
      const profileBySource = new Map(profiles.map((profile) => [profile.sourceId, profile]))
      const definitions = listIntelligenceSourceDefinitions().filter((definition) =>
        (NEWS_SENTIMENT_SOURCE_IDS as readonly string[]).includes(definition.sourceId)
      )
      const coverage = buildSourceCoverageAsOf({
        definitions,
        runtimeStates: pipeline.listRuntimeStatesAsOf(asOf),
        items: pipeline.listItems(),
        asOf,
        enabledSourceIds
      })
      return summarizeNewsSentimentReadiness(coverage.map((row) => {
        // The cycle comes from the resolver the scheduler itself uses, so the card's idea of
        // "old" cannot drift away from how often this source is really collected.
        const definition = definitions.find((entry) => entry.sourceId === row.sourceId)
        const pollingIntervalSec = definition
          ? resolveRuntimeConfig({ definition, profile: profileBySource.get(row.sourceId) }).pollingIntervalSec
          : undefined
        return {
          ...row,
          ...(pollingIntervalSec ? { collectionIntervalMs: pollingIntervalSec * 1_000 } : {})
        }
      }))
    },
    now
  })
  return { enrichment, scoring, bodyTranslation, query }
  return { enrichment, scoring, bodyTranslation, query }
}
