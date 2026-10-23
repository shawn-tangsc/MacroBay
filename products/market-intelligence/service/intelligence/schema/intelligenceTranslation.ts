export type IntelligenceTranslationTargetLocale = 'zh-CN' | 'en-US'

export type IntelligenceTranslationTargetSetting = 'follow-app' | IntelligenceTranslationTargetLocale

export type IntelligenceTranslationSourceType =
  | 'item'
  | 'revision'
  | 'raw-evidence-excerpt'
  | 'assessment-explanation'

export type IntelligenceTranslationStatus =
  | 'pending'
  | 'translated'
  | 'failed'
  | 'stale'
  | 'not-required'

export type IntelligenceTranslationSettings = {
  autoTranslateEnabled: boolean
  targetLocale: IntelligenceTranslationTargetSetting
  providerId?: string
  modelId?: string
  translateTitle: boolean
  translateSummary: boolean
  translateEvidenceExcerpt: boolean
  updatedAt: string
}

export type IntelligenceTranslationRecord = {
  translationId: string
  sourceType: IntelligenceTranslationSourceType
  sourceId: string
  sourceHash: string
  sourceLanguage?: string
  targetLocale: IntelligenceTranslationTargetLocale
  titleTranslated?: string
  summaryTranslated?: string
  bodyTranslated?: string
  status: IntelligenceTranslationStatus
  providerId?: string
  modelId?: string
  promptVersion: string
  translatedAt?: string
  errorCode?: string
}

export type SafeIntelligenceTranslationSettings = IntelligenceTranslationSettings & {
  resolvedTargetLocale: IntelligenceTranslationTargetLocale
  /**
   * 模型服务页「默认模型 → 翻译模型」的只读投影（`providerId:modelId`，空串=未配置）。
   *
   * 这是派生值，不写回翻译偏好：`providerId/modelId` 留空表示跟随它，任务执行时实时解析。
   */
  defaultModelId: string
}

export type SafeTranslationStatus = {
  sourceType: IntelligenceTranslationSourceType
  sourceId: string
  targetLocale: IntelligenceTranslationTargetLocale
  status: IntelligenceTranslationStatus
  translatedAt?: string
  errorCode?: string
}

export type SafeTranslationDisplayText = {
  title: string
  summary?: string
  body?: string
  originalTitle: string
  originalSummary?: string
  originalBody?: string
  status: IntelligenceTranslationStatus
  translatedAt?: string
  errorCode?: string
}

export type TranslateIntelligenceItemsJobInput = {
  itemIds?: string[]
  clusterIds?: string[]
  filters?: {
    timeRange?: '24h' | '7d' | '30d' | 'all'
    sourceGroup?: string
    scope?: string
    symbol?: string
    limit?: number
  }
  targetLocale?: IntelligenceTranslationTargetLocale
  reason: 'new-item' | 'manual-selection' | 'settings-change' | 'retry-failed' | 'replay'
  translationIds?: string[]
}

export type SafeTranslationJobSummary = {
  queuedAt: string
  queuedCount: number
  reason: TranslateIntelligenceItemsJobInput['reason']
}

export type SafeTranslationModuleStatus = {
  pendingCount: number
  failedCount: number
  translatedCount: number
  lastJobAt?: string
  lastJobSummary?: string
}

export type TranslationModelOutput = {
  title?: string
  summary?: string
  body?: string
  notes?: string[]
}
