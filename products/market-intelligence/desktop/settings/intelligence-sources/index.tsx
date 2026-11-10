import { useEffect, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import type { SourceView } from '../../../service/intelligence/application/sourceProjection'
import { productText } from '../../shared/i18n/productText'
import { ProviderDetail } from './ProviderDetail'
import { SettingsSourceTree, type SourceFilter } from './SettingsSourceTree'
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
      <SettingsSourceTree
        filter={sourceFilter}
        labels={{ title: t.title, categories: t.sourceCategories, providerNames: t.providerNames, providerSummary: t.providerSummary }}
        selectedProviderId={selectedProviderId}
        view={settingsView}
        onFilterChange={setSourceFilter}
        onSelectProvider={(providerId) => setSelectedProviderId(providerId)}
      />
      <div className="settings-detail-pane intelligence-detail-pane">
        {selectedProviderId ? (() => {
          const provider = settingsView?.groups.flatMap((group) => group.providers).find((entry) => entry.providerId === selectedProviderId)
          return provider ? <div className="intelligence-detail-scroll"><ProviderDetail
            labels={{ sourceNames: t.sourceNames, providerNames: t.providerNames, panelNames: t.panelNames, badges: { pending: t.sourceBadges.pending, advanced: t.sourceBadges.advanced, calendar: t.sourceBadges.calendar, proxy: t.sourceBadges.proxy }, status: t.status, capabilities: t.providerSummary, toggleSource: t.toggleSource, credentials: t.credentialsRequired, website: t.website, signup: t.signup, inviteNote: t.inviteNote, testConnection: t.testConnection, jobRegistered: t.jobRegistered, jobNotRegistered: t.jobNotRegistered, connectionSucceeded: t.connectionSucceeded, connectionFailed: t.connectionFailed, connectionUnsupported: t.connectionUnsupported, apiKey: t.apiKey, unavailableReasonCode: t.unavailableReasonCode, unavailableReasonCodeAria: t.unavailableReasonCodeAria, collectionPolicyStopped: t.collectionPolicyStopped, automaticSyncStopped: t.automaticSyncStopped, lastSuccessfulSync: t.lastSuccessfulSync, health: t.health }}
            provider={provider}
            policy={{ labels: t.collectionPolicy, onChange: updateSourceProfile, profiles: policyProfiles, supportsSentimentById }}
            showSourceDetails
            supportsRunNowById={supportsRunNowById}
            onRunNow={runSourceNow}
            onToggleSource={toggleSourceEnabled}
            sourceDetailLabels={{ sourceNames: t.sourceNames, providerNames: t.providerNames, enabled: t.status.enabled, disabled: t.status.disabled, pending: t.sourceBadges.pending, runNow: t.header.runNow, testConnection: t.testConnection, connectionSucceeded: t.connectionSucceeded, connectionFailed: t.connectionFailed, health: t.health, sourceSpecific: t.sourceSpecific }}
            translation={language !== 'en-US' ? { settings: translation.settings, loading: translation.loading, moduleStatus: translation.moduleStatus, modelProviders: translation.modelProviders, saving: translation.saving, savedThisSession: translation.savedThisSession, queuing: translation.queuing, labels: t.translationPreferences, notice: translation.notice, errorMessage: translation.errorMessage, onChange: (patch) => void translation.updateSettings(patch), onQueueMissing: (sourceIds) => void translation.queueMissing(sourceIds) } : undefined}
          /></div> : null
        })() : null}
      </div>
    </section>
  )
}
