import { useEffect, useState } from 'react'
import { Segmented } from 'antd'

import { LoadingState } from '@platform/ui/components/loading'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { SourceSpecificSection } from './SourceSpecificSection'
import { useIntelligenceSourcesSettings } from './useIntelligenceSourcesSettings'
import { ProviderDetail } from './ProviderDetail'
import { SettingsSourceTree, type SourceFilter } from './SettingsSourceTree'
import { SyncRunSection } from './SyncRunSection'
import type { SourceView } from '../../../service/intelligence/application/sourceProjection'
import { useIntelligenceTranslationSettings } from './useIntelligenceTranslationSettings'

import './intelligence-sources.css'

export default function IntelligenceSourcesSettingsSection(): React.ReactElement {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  // Two views, one page: sources are what you configure, the run record is what happened.
  const [view, setView] = useState<'sources' | 'runs'>('sources')
  const [selectedProviderId, setSelectedProviderId] = useState<string>()
  const language = useShellLanguage()
  const t = productText[language].settings.intelligenceSources
  const {
    settingsView,
    selectedSourceId,
    detail,
    draftProfile,
    sourceEnabledById,
    needsManualRunPrompt,
    loading,
    saving,
    running,
    testingCredentials,
    replaying,
    errorCode,
    notice,
    selectSource,
    setEnabled,
    updateProfile,
    runNow,
    testCredentials,
    replayWindow,
    refreshHealth,
    saveFocusMarkets,
    focusMarketSettings,
    savingFocusMarkets
  } = useIntelligenceSourcesSettings(t)
  const translation = useIntelligenceTranslationSettings(t.translationPreferences)
  // The source filter lists every registered source: a source that has not run lately is exactly
  // the one a reader opens the run record to look for.
  const knownSources = (() => {
    const byId = new Map<string, string>()
    for (const group of settingsView?.groups ?? []) {
      for (const provider of group.providers) {
        for (const source of provider.sources) {
          // The name map is a literal with known keys; a source added elsewhere falls back to the
          // registry's own display name instead of failing the build.
          const named = (t.sourceNames as Readonly<Record<string, string>>)[source.sourceId]
          byId.set(source.sourceId, named ?? source.displayName)
        }
      }
    }
    return [...byId.entries()].map(([sourceId, label]) => ({ sourceId, label }))
  })()

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

  return (
    <section className="settings-workspace intelligence-sources-workspace">
      <div className="intelligence-sources-view-switch">
        {/* One radio group: Tab enters it once, the arrow keys move between the two views. */}
        <Segmented
          aria-label={t.title}
          onChange={(value) => setView(value as 'sources' | 'runs')}
          options={[{ label: t.viewSources, value: 'sources' }, { label: t.viewRuns, value: 'runs' }]}
          size="small"
          value={view}
        />
      </div>
      {view === 'runs' ? <div className="intelligence-sources-view-body"><SyncRunSection
        knownSources={knownSources}
        text={{ ...t.syncRun, sourceNames: t.sourceNames }}
      /></div> : <>
      <SettingsSourceTree
        filter={sourceFilter}
        labels={{ title: t.title, categories: t.sourceCategories, filters: t.sourceFilters, providerNames: t.providerNames, providerSummary: t.providerSummary }}
        selectedProviderId={selectedProviderId}
        view={settingsView}
        onFilterChange={setSourceFilter}
        onSelectProvider={(providerId) => setSelectedProviderId(providerId)}
      />
      <div className="settings-detail-pane intelligence-detail-pane">
        {selectedProviderId ? (() => {
          const provider = settingsView?.groups.flatMap((group) => group.providers).find((entry) => entry.providerId === selectedProviderId)
          return provider ? <div className="intelligence-detail-scroll"><ProviderDetail
            labels={{ sourceNames: t.sourceNames, providerNames: t.providerNames, panelNames: t.panelNames, badges: { pending: t.sourceBadges.pending, advanced: t.sourceBadges.advanced, calendar: t.sourceBadges.calendar, proxy: t.sourceBadges.proxy }, status: t.status, capabilities: t.providerSummary, toggleSource: t.toggleSource, credentials: t.credentialsRequired, website: t.website, signup: t.signup, inviteNote: t.inviteNote, testConnection: t.testConnection, jobRegistered: t.jobRegistered, jobNotRegistered: t.jobNotRegistered, connectionSucceeded: t.connectionSucceeded, connectionFailed: t.connectionFailed, connectionUnsupported: t.connectionUnsupported, apiKey: t.apiKey }}
            provider={provider}
            showSourceDetails
            sourceDetailLabels={{ sourceNames: t.sourceNames, providerNames: t.providerNames, enabled: t.status.enabled, disabled: t.status.disabled, pending: t.sourceBadges.pending, runNow: t.header.runNow, testConnection: t.testConnection, connectionSucceeded: t.connectionSucceeded, connectionFailed: t.connectionFailed, health: t.health, sourceSpecific: t.sourceSpecific }}
            translation={language !== 'en-US' ? { settings: translation.settings, moduleStatus: translation.moduleStatus, modelProviders: translation.modelProviders, saving: translation.saving, savedThisSession: translation.savedThisSession, queuing: translation.queuing, labels: t.translationPreferences, notice: translation.notice, errorMessage: translation.errorMessage, onChange: (patch) => void translation.updateSettings(patch), onQueueMissing: (sourceIds) => void translation.queueMissing(sourceIds) } : undefined}
            onSelectSource={() => undefined}
          /></div> : null
        })() : null}
      </div>
      </>}
    </section>
  )
}
