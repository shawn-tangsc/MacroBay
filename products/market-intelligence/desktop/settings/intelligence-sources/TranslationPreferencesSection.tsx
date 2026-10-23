import { useMemo } from 'react'
import { Button, Select, Switch } from 'antd'

import { resolveConfiguredModel, parseConfiguredModelRef } from '@platform/ai/model-defaults/configuredDefaultModel'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
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
  modelProviders: SafeModelProvider[]
  saving: boolean
  queuing: boolean
  labels: {
    title: string
    autoTranslateEnabled: string
    targetLocale: string
    translationModel: string
    translateTitle: string
    translateSummary: string
    translateEvidenceExcerpt: string
    queueMissing: string
    saving: string
    saved: string
    moduleStatus: string
    pendingCount: string
    failedCount: string
    translatedCount: string
    lastJobAt: string
    followModelServiceDefault: string
    defaultModelNotConfigured: string
    defaultModelUnavailable: string
    targetLocales: Record<string, string>
  }
  notice?: string | null
  errorCode?: string | null
  onChange: (patch: Partial<SafeIntelligenceTranslationSettings>) => void
  onQueueMissing: () => void
}): React.ReactElement {
  const settings = props.settings
  const language = useShellLanguage()
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
      ? `${props.labels.followModelServiceDefault}（${props.labels.defaultModelNotConfigured}）`
      : props.modelProviders.length === 0
        ? props.labels.followModelServiceDefault
        : defaultModel.ok
          ? `${props.labels.followModelServiceDefault} · ${defaultModel.providerName} / ${defaultModel.modelName}`
          : `${props.labels.followModelServiceDefault}（${props.labels.defaultModelUnavailable}）`
  const pickerValue =
    settings?.providerId && settings.modelId ? `${settings.providerId}:${settings.modelId}` : null

  return (
    <section className="intelligence-section intelligence-translation-preferences">
      <div className="intelligence-section-title">{props.labels.title}</div>
      {settings ? (
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
              <StatusPill label={props.labels.pendingCount} value={String(props.moduleStatus.pendingCount)} />
              <StatusPill label={props.labels.failedCount} value={String(props.moduleStatus.failedCount)} />
              <StatusPill label={props.labels.translatedCount} value={String(props.moduleStatus.translatedCount)} />
              <StatusPill
                label={props.labels.lastJobAt}
                value={props.moduleStatus.lastJobAt ?? props.labels.saved}
                wide
              />
            </>
          ) : null}
        </div>
        <div className="intelligence-section-actions intelligence-translation-actions">
          <Button className="ant-secondary-button" size="small" loading={props.queuing} onClick={props.onQueueMissing}>
            {props.labels.queueMissing}
          </Button>
        </div>
      </div>
      <div className="intelligence-translation-meta">
        {props.moduleStatus ? (
          <small>
            {props.labels.moduleStatus}: {props.labels.pendingCount} {props.moduleStatus.pendingCount} ·{' '}
            {props.labels.failedCount} {props.moduleStatus.failedCount}
          </small>
        ) : null}
        {props.errorCode ? <small data-tone="error">{props.errorCode}</small> : null}
        {!props.errorCode && props.saving ? <small>{props.labels.saving}</small> : null}
        {!props.errorCode && !props.saving && props.notice ? <small>{props.notice}</small> : null}
        {!props.errorCode && !props.saving && !props.notice && settings ? <small>{props.labels.saved}</small> : null}
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

function StatusPill(props: { label: string; value: string; wide?: boolean }): React.ReactElement {
  return (
    <div className={`intelligence-translation-pill${props.wide ? ' intelligence-translation-pill-wide' : ''}`}>
      <span className="intelligence-translation-pill-label">{props.label}</span>
      <strong className="intelligence-translation-pill-value">{props.value}</strong>
    </div>
  )
}
