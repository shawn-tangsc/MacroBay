/**
 * The reader's editorial switch and model choice for the daily brief.
 *
 * Empty provider/model means "follow the platform's default assistant model" at call time; that is
 * different from the analysis settings, which snapshot a model when enabled. A background brief may
 * spend one model call, so the reader can also turn the editorial layer off and keep the fact layer.
 */
export type DailyBriefingAiSettings = Readonly<{
  editorialEnabled: boolean
  providerId: string
  modelId: string
  webSearchEnabled: boolean
  webSearchAuthorizedAt?: string
  updatedAt: string
}>

export type DailyBriefingAiSettingsPatch = Readonly<{
  editorialEnabled?: boolean
  providerId?: string
  modelId?: string
  webSearchEnabled?: boolean
  webSearchAuthorizedAt?: string
}>

export const dailyBriefingAiSettingsPolicy = Object.freeze({
  defaultEditorialEnabled: true,
  halfBoundError: 'daily-briefing-model-half-bound'
})

export function createDefaultDailyBriefingAiSettings(now = new Date().toISOString()): DailyBriefingAiSettings {
  return { editorialEnabled: dailyBriefingAiSettingsPolicy.defaultEditorialEnabled, providerId: '', modelId: '', webSearchEnabled: false, updatedAt: now }
}

export function normalizeDailyBriefingAiSettings(
  input: Partial<DailyBriefingAiSettings> | undefined,
  now = new Date().toISOString()
): DailyBriefingAiSettings {
  const defaults = createDefaultDailyBriefingAiSettings(now)
  return {
    editorialEnabled: typeof input?.editorialEnabled === 'boolean' ? input.editorialEnabled : defaults.editorialEnabled,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : '',
    modelId: typeof input?.modelId === 'string' ? input.modelId.trim() : '',
    webSearchEnabled: typeof input?.webSearchEnabled === 'boolean' ? input.webSearchEnabled : false,
    ...(typeof input?.webSearchAuthorizedAt === 'string' && input.webSearchAuthorizedAt ? { webSearchAuthorizedAt: input.webSearchAuthorizedAt } : {}),
    updatedAt: typeof input?.updatedAt === 'string' && input.updatedAt ? input.updatedAt : defaults.updatedAt
  }
}

export function isDailyBriefingModelSet(settings: Pick<DailyBriefingAiSettings, 'providerId' | 'modelId'>): boolean {
  return Boolean(settings.providerId && settings.modelId)
}

/** A half reference cannot be called and is not a valid preference: reject it instead of guessing. */
export function hasHalfBoundDailyBriefingModel(settings: Pick<DailyBriefingAiSettings, 'providerId' | 'modelId'>): boolean {
  return Boolean(settings.providerId) !== Boolean(settings.modelId)
}

export function applyDailyBriefingAiSettingsPatch(
  current: DailyBriefingAiSettings,
  patch: DailyBriefingAiSettingsPatch,
  now: string
): DailyBriefingAiSettings {
  const next = normalizeDailyBriefingAiSettings({
    editorialEnabled: patch.editorialEnabled ?? current.editorialEnabled,
    providerId: patch.providerId ?? current.providerId,
    modelId: patch.modelId ?? current.modelId,
    webSearchEnabled: patch.webSearchEnabled ?? current.webSearchEnabled,
    ...(patch.webSearchAuthorizedAt ?? current.webSearchAuthorizedAt ? { webSearchAuthorizedAt: patch.webSearchAuthorizedAt ?? current.webSearchAuthorizedAt } : {}),
    updatedAt: now
  }, now)
  if (hasHalfBoundDailyBriefingModel(next)) throw new Error(dailyBriefingAiSettingsPolicy.halfBoundError)
  return next
}
