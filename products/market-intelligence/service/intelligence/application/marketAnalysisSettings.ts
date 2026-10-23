/**
 * The reader's switches for the market analysis capability.
 *
 * `providerId`/`modelId` are a *snapshot* of the model the analysis may call, taken when the
 * capability is enabled. Resolving the platform's default assistant model at call time instead
 * would move a background job onto a model the reader never chose — and a job that spends a
 * request is not something a default should decide on its own.
 */
export type MarketAnalysisSettings = Readonly<{
  enabled: boolean
  providerId: string
  modelId: string
  updatedAt: string
}>

/** What a caller may change. Absent keys keep their stored value; an empty model clears it. */
export type MarketAnalysisSettingsPatch = Readonly<{
  enabled?: boolean
  providerId?: string
  modelId?: string
}>

export const marketAnalysisSettingsPolicy = Object.freeze({
  /**
   * Off until the reader turns it on.
   *
   * A background job that spends a model call must be a decision the reader made, not a default
   * they never saw: the panel draws a mask over the module and offers the switch, and nothing is
   * armed or queued until it is turned on.
   */
  defaultEnabled: false
})

/**
 * Settings-specific refusals. They are not run failure codes: nothing was analysed, and the
 * timeline's failure vocabulary must not claim otherwise.
 */
export const MARKET_ANALYSIS_SETTINGS_ERROR_CODES = Object.freeze({
  /** Enabling with no model and no usable platform default assistant model. */
  modelUnconfigured: 'analysis-model-unconfigured',
  /** The chosen model exists but cannot be called now (provider disabled, missing key, wrong kind). */
  modelUnavailable: 'analysis-model-unavailable'
})

export function createDefaultMarketAnalysisSettings(
  now = new Date().toISOString(),
  enabled = marketAnalysisSettingsPolicy.defaultEnabled
): MarketAnalysisSettings {
  return { enabled, providerId: '', modelId: '', updatedAt: now }
}

export function normalizeMarketAnalysisSettings(
  input: Partial<MarketAnalysisSettings> | undefined,
  now = new Date().toISOString()
): MarketAnalysisSettings {
  const defaults = createDefaultMarketAnalysisSettings(now)
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : defaults.enabled,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : '',
    modelId: typeof input?.modelId === 'string' ? input.modelId.trim() : '',
    updatedAt: typeof input?.updatedAt === 'string' && input.updatedAt ? input.updatedAt : defaults.updatedAt
  }
}

/** A model is set only when both halves are: half a reference cannot be called. */
export function isMarketAnalysisModelSet(settings: Pick<MarketAnalysisSettings, 'providerId' | 'modelId'>): boolean {
  return Boolean(settings.providerId && settings.modelId)
}

/**
 * The switch that gates work. A stored model is *not* part of it: a run queued before the reader
 * chose one keeps following the platform default, and the panel refuses to turn the capability on
 * without a model in the first place.
 */
export function isMarketAnalysisEnabled(settings: MarketAnalysisSettings): boolean {
  return settings.enabled
}

/** Whether the capability is on *and* has a model: what the panel offers as "可开启/已开启". */
export function isMarketAnalysisOperational(settings: MarketAnalysisSettings): boolean {
  return settings.enabled && isMarketAnalysisModelSet(settings)
}

export function applyMarketAnalysisSettingsPatch(
  current: MarketAnalysisSettings,
  patch: MarketAnalysisSettingsPatch,
  now: string
): MarketAnalysisSettings {
  return normalizeMarketAnalysisSettings({
    enabled: patch.enabled ?? current.enabled,
    providerId: patch.providerId ?? current.providerId,
    modelId: patch.modelId ?? current.modelId,
    updatedAt: now
  }, now)
}
