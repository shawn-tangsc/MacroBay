import { join } from 'node:path'

import { resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'

import { createNewsSentimentSettingsJsonStorage, createNewsSentimentSettingsStore } from './news-sentiment/newsSentimentSettingsStore'
import { createNewsSentimentSqliteStore, newsSentimentStoragePolicy } from './news-sentiment/newsSentimentStore'
import { createNewsSentimentServices } from './news-sentiment/newsSentimentServices'
import { resolveNewsSentimentModel } from './news-sentiment/newsSentimentSettings'
import type { NewsSentimentSettings, NewsSentimentSettingsView } from './schema/newsSentiment'
import type { IntelligenceModulePlatformHooks } from './intelligenceModuleContracts'

/**
 * `intelligenceModule` 的舆情装配（拆分 M4，2026-11-15，**只搬不改**）。
 *
 * 这一段决定「舆情库打不开时产品怎么办」：**不抛、不假装有数据**——`catch` 之后把 store 留成
 * `undefined`，对外出口里就不出现 `store/query/enrichment/scoring/bodyTranslation`，
 * 但设置读写照旧可用（设置是 JSON，和库无关）。这就是「读不到 ≠ 确实没有」那一条在这个模块的落法：
 * 少了库是**能力缺席**，不是「今天没有舆情」，两者在界面上走不同的状态。
 *
 * 与搬出来之前相比，**唯一差异是入参解构**：原先读闭包里的 `dataDir` / `pipeline` /
 * `translationService` / `translationStorage` / `structuredModelInvocation` / `getAppLanguage` /
 * `profileStore` / `hooks`，现在都由调用方显式传入（`hooks` 传的是**当前那份对象的值**，
 * 不是工厂去读模块级 `modulePlatformHooks` 变量）。
 */
export function createIntelligenceNewsSentiment(input: {
  dataDir: string
  pipeline: Parameters<typeof createNewsSentimentServices>[1]['pipeline']
  translationService: Parameters<typeof createNewsSentimentServices>[1]['translationService']
  translationStorage: Parameters<typeof createNewsSentimentServices>[1]['translationSettingsStorage']
  structuredModelInvocation: { invoke: Parameters<typeof createNewsSentimentServices>[1]['invoke'] }
  getAppLanguage: () => Promise<'zh-CN' | 'en-US'>
  profileStore: Parameters<typeof createNewsSentimentServices>[1]['profileStore']
  hooks: IntelligenceModulePlatformHooks
}) {
  const {
    dataDir, pipeline, translationService, translationStorage, structuredModelInvocation,
    getAppLanguage, profileStore, hooks
  } = input
  let newsSentimentStore: ReturnType<typeof createNewsSentimentSqliteStore> | undefined
  const newsSentimentSettingsStore = createNewsSentimentSettingsStore(
    createNewsSentimentSettingsJsonStorage(join(dataDir, 'intelligence-news-sentiment-settings.json'))
  )
  const newsSentimentFilePath = join(dataDir, newsSentimentStoragePolicy.fileName)
  try {
    newsSentimentStore = createNewsSentimentSqliteStore(newsSentimentFilePath)
  } catch {
    // A broken database must not take the rest of the product down; news sentiment stays unavailable.
    newsSentimentStore = undefined
  }
  const assembleNewsSentiment = (store: ReturnType<typeof createNewsSentimentSqliteStore>) =>
    createNewsSentimentServices(store, {
      pipeline,
      settingsStore: newsSentimentSettingsStore,
      translationService,
      translationSettingsStorage: translationStorage,
      invoke: structuredModelInvocation.invoke,
      getAppLanguage,
      profileStore,
      hooks,
      dataDir
    })
  const newsSentimentPieces = newsSentimentStore ? assembleNewsSentiment(newsSentimentStore) : undefined
  const newsSentimentEnrichment = newsSentimentPieces?.enrichment
  const newsSentimentScoring = newsSentimentPieces?.scoring
  const newsSentimentBodyTranslation = newsSentimentPieces?.bodyTranslation
  const newsSentimentQuery = newsSentimentPieces?.query
  const readNewsSentimentSettings = async (): Promise<NewsSentimentSettingsView> => {
    const settings = await newsSentimentSettingsStore.getSettings()
    const [providerState, modelDefaults] = await Promise.all([
      hooks?.getProviderState?.().catch(() => undefined) ?? Promise.resolve(undefined),
      hooks?.getModelDefaults?.().catch(() => undefined) ?? Promise.resolve(undefined)
    ])
    const resolution = resolveNewsSentimentModel({
      settings,
      modelDefaults: modelDefaults ?? null,
      providers: providerState?.providers ?? []
    })
    const fastResolution = modelDefaults?.fastModelId
      ? resolveConfiguredModel({
          value: modelDefaults.fastModelId,
          providers: providerState?.providers ?? [],
          isModelAcceptable: (_provider, model) => model.capabilities.chat === true
        })
      : undefined
    return {
      settings,
      resolution,
      ...(fastResolution?.ok
        ? { defaultFastModel: { providerId: fastResolution.ref.providerId, modelId: fastResolution.ref.modelId, name: `${fastResolution.providerName} · ${fastResolution.modelName}` } }
        : {})
    }
  }
  const newsSentimentSettings = {
    get: readNewsSentimentSettings,
    save: async (patch: Partial<NewsSentimentSettings>) => {
      await newsSentimentSettingsStore.save(patch)
      return readNewsSentimentSettings()
    }
  }
  // 一份可更新的出口：读者重建把库换成新的以后，IPC / Agent 读到的是同一份新服务。
  const newsSentimentExposure = {
    settingsStore: newsSentimentSettingsStore,
    ...(newsSentimentStore ? { store: newsSentimentStore } : {}),
    ...(newsSentimentEnrichment ? { enrichment: newsSentimentEnrichment } : {}),
    ...(newsSentimentScoring ? { scoring: newsSentimentScoring } : {}),
    ...(newsSentimentQuery ? { query: newsSentimentQuery } : {}),
    ...(newsSentimentBodyTranslation ? { bodyTranslation: newsSentimentBodyTranslation } : {}),
    settings: newsSentimentSettings,
    rebuildStorage: (): { quarantinedCopy?: string } => {
      throw new Error('news-sentiment-storage-unavailable')
    }
  }
  /* 后两件是「作业依赖」要的能力（M5 会随作业注册搬走）；重建那一笔要 `assembleNewsSentiment`
     与路径。库没打开时前两件是 undefined——这里不伪造空实现。 */
  return {
    newsSentimentExposure,
    assembleNewsSentiment,
    newsSentimentFilePath,
    newsSentimentStore,
    newsSentimentEnrichment,
    newsSentimentScoring
  }
}
