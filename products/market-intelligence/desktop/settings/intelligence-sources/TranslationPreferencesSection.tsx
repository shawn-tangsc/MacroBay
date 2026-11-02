import { useMemo } from 'react'
import { Button, Select, Switch } from 'antd'

import { resolveConfiguredModel, parseConfiguredModelRef } from '@platform/ai/model-defaults/configuredDefaultModel'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { LoadingState } from '@platform/ui/components/loading'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { platformText } from '@renderer/i18n/platformText'
import { ModelPicker } from '@renderer/shell/components/ModelPicker/ModelPicker'
import type {
  ModelPickerCandidate,
  ModelPickerConstraints
} from '@renderer/shell/components/ModelPicker/modelPickerOptions'

import type {
  SafeIntelligenceTranslationSettings,
  SafeTranslationModuleStatus
} from '../../../service/intelligence/schema/intelligenceTranslation'

/** 翻译是文本任务：与模型服务页「默认翻译模型」同一候选口径。 */
const TRANSLATION_MODEL_CONSTRAINTS: ModelPickerConstraints = {
  requireCapabilities: ['chat']
}

export function TranslationPreferencesSection(props: {
  settings?: SafeIntelligenceTranslationSettings
  moduleStatus?: SafeTranslationModuleStatus
  /** The provider's own sources; omitted keeps the global module counts. */
  sourceIds?: readonly string[]
  modelProviders: SafeModelProvider[]
  /** The first read is still in flight: the card draws a loading line, never switches in the "off" position. */
  loading?: boolean
  saving: boolean
  /** Set only when this card saved during this session; a loaded file never sets it. */
  savedThisSession?: boolean
  queuing: boolean
  labels: {
    title: string
    loading: string
    loadFailed: string
    autoTranslateEnabled: string
    targetLocale: string
    translationModel: string
    translateTitle: string
    translateSummary: string
    translateEvidenceExcerpt: string
    queueMissing: string
    saving: string
    saved: string
    savedThisSession: string
    moduleStatus: string
    pendingCount: string
    failedCount: string
    translatedCount: string
    lastJobAt: string
    /** Punctuation comes from the text layer: a fullwidth bracket on an English screen is a typo. */
    joiner: string
    labelSep: string
    parenOpen: string
    parenClose: string
    modelPathSep: string
    followModelServiceDefault: string
    defaultModelNotConfigured: string
    defaultModelUnavailable: string
    targetLocales: Record<string, string>
  }
  notice?: string | null
  /** Already a sentence from the product text; the card never renders a raw code. */
  errorMessage?: string | null
  onChange: (patch: Partial<SafeIntelligenceTranslationSettings>) => void
  /** Queues the untranslated items of `sourceIds`; the card passes its own scope. */
  onQueueMissing: (sourceIds?: readonly string[]) => void
}): React.ReactElement {
  const settings = props.settings
  const scopedCounts = useMemo(() => {
    if (!props.sourceIds?.length || !props.moduleStatus?.bySource) return undefined
    const totals = { pendingCount: 0, failedCount: 0, translatedCount: 0 }
    for (const sourceId of props.sourceIds) {
      const counts = props.moduleStatus.bySource[sourceId]
      if (!counts) continue
      totals.pendingCount += counts.pendingCount
      totals.failedCount += counts.failedCount
      totals.translatedCount += counts.translatedCount
    }
    return totals
  }, [props.sourceIds, props.moduleStatus])
  const counts = scopedCounts ?? {
    pendingCount: props.moduleStatus?.pendingCount ?? 0,
    failedCount: props.moduleStatus?.failedCount ?? 0,
    translatedCount: props.moduleStatus?.translatedCount ?? 0
  }
  const language = useShellLanguage()
  const formatTime = useShellTimeFormat()
  const modelCandidates = useMemo<ModelPickerCandidate[]>(
    () =>
      props.modelProviders.flatMap((provider) =>
        provider.models.map((model) => ({ providerId: provider.id, model }))
      ),
    [props.modelProviders]
  )
  const defaultModel = useMemo(
    () =>
      resolveConfiguredModel({
        value: settings?.defaultModelId,
        providers: props.modelProviders,
        isModelAcceptable: (_provider, model) => model.capabilities.chat === true
      }),
    [props.modelProviders, settings?.defaultModelId]
  )
  const followDefaultLabel =
    !settings?.defaultModelId.trim()
      ? `${props.labels.followModelServiceDefault}${props.labels.parenOpen}${props.labels.defaultModelNotConfigured}${props.labels.parenClose}`
      : props.modelProviders.length === 0
        ? props.labels.followModelServiceDefault
        : defaultModel.ok
          ? `${props.labels.followModelServiceDefault}${props.labels.joiner}${defaultModel.providerName}${props.labels.modelPathSep}${defaultModel.modelName}`
          : `${props.labels.followModelServiceDefault}${props.labels.parenOpen}${props.labels.defaultModelUnavailable}${props.labels.parenClose}`
  const pickerValue =
    settings?.providerId && settings.modelId ? `${settings.providerId}:${settings.modelId}` : null

  return (
    <section className="intelligence-section intelligence-translation-preferences">
      <div className="intelligence-section-title">
        <span>{props.labels.title}</span>
        {props.savedThisSession ? <small className="intelligence-section-saved">{props.labels.savedThisSession}</small> : null}
      </div>
      {props.loading ? <LoadingState label={props.labels.loading} minHeight={60} /> : null}
      {!props.loading && settings ? (
        <div className="intelligence-setting-grid">
          <SettingRow label={props.labels.autoTranslateEnabled}>
            <Switch
              size="small"
              checked={settings.autoTranslateEnabled}
              onChange={(autoTranslateEnabled) => props.onChange({ autoTranslateEnabled })}
            />
          </SettingRow>
          <SettingRow label={props.labels.targetLocale}>
            <Select
              className="intelligence-select"
              value={settings.targetLocale}
              options={Object.entries(props.labels.targetLocales).map(([value, label]) => ({
                value,
                label
              }))}
              onChange={(targetLocale) =>
                props.onChange({
                  targetLocale: targetLocale as SafeIntelligenceTranslationSettings['targetLocale']
                })
              }
            />
          </SettingRow>
          <SettingRow label={props.labels.translationModel} wide>
            <div className="intelligence-translation-model">
              <ModelPicker
                pickerId="intelligence-translation"
                value={pickerValue}
                onChange={(value) => {
                  const ref = parseConfiguredModelRef(value)
                  if (ref) props.onChange({ providerId: ref.providerId, modelId: ref.modelId })
                }}
                models={modelCandidates}
                providers={props.modelProviders}
                labels={platformText[language].models}
                constraints={TRANSLATION_MODEL_CONSTRAINTS}
                placeholder={followDefaultLabel}
                allowClear
                onClear={() => props.onChange({ providerId: '', modelId: '' })}
                placement="bottomRight"
              />
            </div>
          </SettingRow>
          <SettingRow label={props.labels.translateTitle}>
            <Switch
              size="small"
              checked={settings.translateTitle}
              onChange={(translateTitle) => props.onChange({ translateTitle })}
            />
          </SettingRow>
          <SettingRow label={props.labels.translateSummary}>
            <Switch
              size="small"
              checked={settings.translateSummary}
              onChange={(translateSummary) => props.onChange({ translateSummary })}
            />
          </SettingRow>
          <SettingRow label={props.labels.translateEvidenceExcerpt}>
            <Switch
              size="small"
              checked={settings.translateEvidenceExcerpt}
              onChange={(translateEvidenceExcerpt) => props.onChange({ translateEvidenceExcerpt })}
            />
          </SettingRow>
        </div>
      ) : null}
      <div className="intelligence-translation-footer">
        <div className="intelligence-translation-status">
          {props.moduleStatus ? (
            <>
              <CountBadge label={props.labels.pendingCount} value={String(counts.pendingCount)} />
              <CountBadge label={props.labels.failedCount} value={String(counts.failedCount)} />
              <CountBadge label={props.labels.translatedCount} value={String(counts.translatedCount)} />
              <CountBadge
                label={props.labels.lastJobAt}
                // No job has run yet is not "saved": the pill used to claim a job that never happened.
                value={props.moduleStatus.lastJobAt ? formatTime(props.moduleStatus.lastJobAt, 'minute') : '—'}
                wide
              />
            </>
          ) : null}
        </div>
        <div className="intelligence-section-actions intelligence-translation-actions">
          <Button
            className="ant-secondary-button"
            size="small"
            loading={props.queuing}
            onClick={() => props.onQueueMissing(props.sourceIds)}
          >
            {props.labels.queueMissing}
          </Button>
        </div>
      </div>
      <div className="intelligence-translation-meta">
        {props.errorMessage ? <small data-tone="error">{props.errorMessage}</small> : null}
        {!props.errorMessage && props.saving ? <small>{props.labels.saving}</small> : null}
        {!props.errorMessage && !props.saving && props.notice ? <small>{props.notice}</small> : null}
      </div>
    </section>
  )
}

function SettingRow(props: { label: string; children: React.ReactNode; wide?: boolean }): React.ReactElement {
  return (
    <div className={`intelligence-setting-row${props.wide ? ' intelligence-setting-row-wide' : ''}`}>
      <span className="intelligence-setting-label">{props.label}</span>
      <div className="intelligence-setting-control">{props.children}</div>
    </div>
  )
}

function CountBadge(props: { label: string; value: string; wide?: boolean }): React.ReactElement {
  return (
    <div className={`intelligence-translation-pill${props.wide ? ' intelligence-translation-pill-wide' : ''}`}>
      <span className="intelligence-translation-pill-label">{props.label}</span>
      <strong className="intelligence-translation-pill-value">{props.value}</strong>
    </div>
  )
}
