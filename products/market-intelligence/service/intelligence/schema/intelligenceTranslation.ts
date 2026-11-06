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
  /**
   * 这条 `title` 是哪种语言。译文必须带上来，否则调用方只能靠"有没有译文"去猜——日报就是这么把
   * 中文标题丢掉的（`titleLocale` 未设，判断 `titleLocale === 本期语言` 永远不成立）。
   */
  titleLocale?: string
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
    /** Restricts a filter-based queue to the sources of the page that asked for it. */
    sourceIds?: string[]
    sourceGroup?: string
    scope?: string
    symbol?: string
    limit?: number
  }
  targetLocale?: IntelligenceTranslationTargetLocale
  reason: 'new-item' | 'manual-selection' | 'settings-change' | 'retry-failed' | 'replay'
  translationIds?: string[]
  /**
   * 这一批属于哪个来源。按来源拆批时由入队处写入；运行记录按来源筛选读的就是它
   * （`sourcesOf` 读 `payload.sourceId`），缺了它整批在来源筛选下会消失。
   * 入队时算不出来源的批（只带筛选条件、候选留到执行时才选的）没有这个字段。
   */
  sourceId?: string
  /**
   * 同一次动作派生出的多批共用这一个标记。拆批是为了让定义 id 稳定到来源级；
   * 不给一个标记的话，一次动作会显示成 N 次互不相干的任务。
   */
  groupId?: string
}

export type SafeTranslationJobSummary = {
  queuedAt: string
  queuedCount: number
  reason: TranslateIntelligenceItemsJobInput['reason']
}

export type SafeTranslationSourceCounts = {
  pendingCount: number
  failedCount: number
  translatedCount: number
}

export type SafeTranslationModuleStatus = {
  pendingCount: number
  failedCount: number
  translatedCount: number
  lastJobAt?: string
  lastJobSummary?: string
  /** Per intelligence source, so a provider page reports only its own work. */
  bySource?: Readonly<Record<string, SafeTranslationSourceCounts>>
}

export type TranslationModelOutput = {
  title?: string
  summary?: string
  body?: string
  notes?: string[]
}
