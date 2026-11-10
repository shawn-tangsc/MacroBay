import { useEffect, useState } from 'react'

import { Button } from 'antd'

import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import type { SourceView } from '../../../service/intelligence/application/sourceProjection'
import { productText } from '../../shared/i18n/productText'
import type { SourceFilter } from './SettingsSourceTree'
import { SourcesSettingsPane } from './SourcesSettingsPane'
import { SourceSpecificSection } from './SourceSpecificSection'
import { useIntelligenceSourcesSettings } from './useIntelligenceSourcesSettings'
import { useIntelligenceTranslationSettings } from './useIntelligenceTranslationSettings'

import './intelligence-sources.css'

export default function IntelligenceSourcesSettingsSection(): React.ReactElement {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [selectedProviderId, setSelectedProviderId] = useState<string>()
  const language = useShellLanguage()
  const t = productText[language].settings.intelligenceSources
  const {
    settingsView,
    selectedSourceId,
    detail,
    draftProfile,
    needsManualRunPrompt,
    loading,
    saving,
    running,
    testingCredentials,
    replaying,
    errorCode,
    notice,
    reload,
    selectSource,
    toggleSourceEnabled,
    runNow,
    testCredentials,
    replayWindow,
    refreshHealth,
    runSourceNow,
    otherSideChanged,
    setDraftDirty,
    reloadFromOtherSide,
    dismissOtherSideChanged,
    profiles,
    definitions,
    updateSourceProfile
  } = useIntelligenceSourcesSettings(t)
  const translation = useIntelligenceTranslationSettings(t.translationPreferences)
  // 采集策略：每源一份 profile，读 `profiles`；是否支持情绪分析由源定义决定（同一个事实只读一处）。
  const policyProfiles: Readonly<Record<string, IntelligenceSourceProfile>> = Object.fromEntries(
    profiles.map((profile) => [profile.sourceId, profile])
  )
  const supportsSentimentById: Readonly<Record<string, boolean>> = Object.fromEntries(
    definitions.map((definition) => [definition.sourceId, definition.supportsSentiment === true])
  )
  // 「能不能立刻采」只认平台声明：目录里有 `supportsRunNow` 的源才可能有这颗按钮/这个答案。
  const supportsRunNowById: Readonly<Record<string, boolean>> = Object.fromEntries(
    definitions.map((definition) => [definition.sourceId, definition.supportsRunNow])
  )
  useEffect(() => {
    if (selectedProviderId || !settingsView) return
    const first = settingsView.groups.flatMap((group) => group.providers)[0]
    if (first) setSelectedProviderId(first.providerId)
  }, [settingsView, selectedProviderId])

  if (loading && !settingsView) {
    return (
      <section className="settings-workspace intelligence-sources-workspace" aria-busy="true">
        <LoadingState label={t.loading} fill />
      </section>
    )
  }

  // The first read failed: say so and offer the retry. Drawing the page anyway would look like a
  // module with no sources registered, which is a different fact from "we could not read them".
  if (!settingsView && errorCode) {
    return (
      <section className="settings-workspace intelligence-sources-workspace">
        <StateView
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: reload }}
          reasonCode="unreadable"
          size="md"
          state="error"
        />
      </section>
    )
  }

  return (
    <section className="settings-workspace intelligence-sources-workspace">
        {/* C8：另一处保存了同一域、而本页有草稿——只提示，不覆盖；两个动作由读者选。 */}
        {otherSideChanged ? <div className="intelligence-sources-other-side" role="status">
          <span>{t.otherSideChanged}</span>
          <Button onClick={reloadFromOtherSide} type="link">{t.reloadOtherSide}</Button>
          <Button onClick={dismissOtherSideChanged} type="link">{t.keepEditing}</Button>
        </div> : null}
      <SourcesSettingsPane
        filter={sourceFilter}
        onFilterChange={setSourceFilter}
        onSelectProvider={(providerId) => setSelectedProviderId(providerId)}
        selectedProviderId={selectedProviderId}
        surface={{
          text: t,
          policy: { labels: t.collectionPolicy, onChange: updateSourceProfile, profiles: policyProfiles, supportsSentimentById },
          supportsRunNowById,
          onRunNow: runSourceNow,
          onToggleSource: toggleSourceEnabled,
          onDraftChange: setDraftDirty,
          translation: language !== 'en-US' ? { settings: translation.settings, loading: translation.loading, moduleStatus: translation.moduleStatus, modelProviders: translation.modelProviders, saving: translation.saving, savedThisSession: translation.savedThisSession, queuing: translation.queuing, labels: t.translationPreferences, notice: translation.notice, errorMessage: translation.errorMessage, onChange: (patch) => void translation.updateSettings(patch), onQueueMissing: (sourceIds) => void translation.queueMissing(sourceIds) } : undefined,
          showSourceDetails: true,
          surface: 'settings'
        }}
        treeLabels={{ title: t.title, categories: t.sourceCategories, providerNames: t.providerNames, providerSummary: t.providerSummary, unavailableCountOne: t.unavailableCountOne, unavailableCountOther: t.unavailableCountOther }}
        view={settingsView} />
    </section>
  )
}
