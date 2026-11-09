import { useEffect, useState } from 'react'

import { Button, Checkbox } from 'antd'

import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { INTELLIGENCE_FOCUS_MARKET_IDS } from '../../../service/intelligence/application/intelligenceFocusSettings'
import type { IntelligenceFocusMarket, IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import type { SourceView } from '../../../service/intelligence/application/sourceProjection'
import { productText } from '../../shared/i18n/productText'
import { SettingsInfo } from '../settingsInfo'
import { ProviderDetail } from './ProviderDetail'
import { SettingsSourceTree, type SourceFilter } from './SettingsSourceTree'
import { SourceSpecificSection } from './SourceSpecificSection'
import { useIntelligenceSourcesSettings } from './useIntelligenceSourcesSettings'
import { useIntelligenceTranslationSettings } from './useIntelligenceTranslationSettings'

import './intelligence-sources.css'

export default function IntelligenceSourcesSettingsSection(): React.ReactElement {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [selectedProviderId, setSelectedProviderId] = useState<string>()
  /** 「默认覆盖范围」：展开态、读者草稿、这一处自己的失败提示。 */
  const [focusExpanded, setFocusExpanded] = useState(false)
  const [focusDraft, setFocusDraft] = useState<readonly IntelligenceFocusMarket[]>([])
  const [focusSaveFailed, setFocusSaveFailed] = useState(false)
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
    reload,
    selectSource,
    setEnabled,
    updateProfile,
    runNow,
    testCredentials,
    replayWindow,
    refreshHealth,
    saveFocusMarkets,
    focusMarketSettings,
    profiles,
    definitions,
    updateSourceProfile,
    savingFocusMarkets
  } = useIntelligenceSourcesSettings(t)
  const translation = useIntelligenceTranslationSettings(t.translationPreferences)
  const confirmedFocusMarkets = focusMarketSettings.enabledFocusMarkets
  // 草稿看**服务端确认值的内容**，不看对象引用：别处保存成功会换一个新对象，那不该抹掉
  // 读者刚点、但还没存上的选择（与通知设置页同一处教训）。
  const confirmedFocusKey = confirmedFocusMarkets.join(',')
  useEffect(() => { setFocusDraft(confirmedFocusMarkets) }, [confirmedFocusKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFocusMarket = (market: IntelligenceFocusMarket, checked: boolean): void => {
    const next = checked
      ? [...focusDraft, market]
      : focusDraft.filter((entry) => entry !== market)
    setFocusDraft(next)
    setFocusSaveFailed(false)
    // 空选择由服务端归一成默认两个；失败时保留草稿并就地报「这次没存上」。
    void saveFocusMarkets(next).then((saved) => { if (!saved) setFocusSaveFailed(true) })
  }

  // 采集策略：每源一份 profile，读 `profiles`；是否支持情绪分析由源定义决定（同一个事实只读一处）。
  const policyProfiles: Readonly<Record<string, IntelligenceSourceProfile>> = Object.fromEntries(
    profiles.map((profile) => [profile.sourceId, profile])
  )
  const supportsSentimentById: Readonly<Record<string, boolean>> = Object.fromEntries(
    definitions.map((definition) => [definition.sourceId, definition.supportsSentiment === true])
  )
  const focusMarketText: Readonly<Record<string, string>> = {
    'settings.intelligenceSources.focusMarkets.infoAria': t.focusMarkets.infoAria,
    'settings.intelligenceSources.focusMarkets.description': t.focusMarkets.description
  }
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
            labels={{ sourceNames: t.sourceNames, providerNames: t.providerNames, panelNames: t.panelNames, badges: { pending: t.sourceBadges.pending, advanced: t.sourceBadges.advanced, calendar: t.sourceBadges.calendar, proxy: t.sourceBadges.proxy }, status: t.status, capabilities: t.providerSummary, toggleSource: t.toggleSource, credentials: t.credentialsRequired, website: t.website, signup: t.signup, inviteNote: t.inviteNote, testConnection: t.testConnection, jobRegistered: t.jobRegistered, jobNotRegistered: t.jobNotRegistered, connectionSucceeded: t.connectionSucceeded, connectionFailed: t.connectionFailed, connectionUnsupported: t.connectionUnsupported, apiKey: t.apiKey, unavailableReasonCode: t.unavailableReasonCode, automaticSyncStopped: t.automaticSyncStopped, lastSuccessfulSync: t.lastSuccessfulSync }}
            provider={provider}
            policy={{ labels: t.collectionPolicy, onChange: updateSourceProfile, profiles: policyProfiles, supportsSentimentById }}
            showSourceDetails
            sourceDetailLabels={{ sourceNames: t.sourceNames, providerNames: t.providerNames, enabled: t.status.enabled, disabled: t.status.disabled, pending: t.sourceBadges.pending, runNow: t.header.runNow, testConnection: t.testConnection, connectionSucceeded: t.connectionSucceeded, connectionFailed: t.connectionFailed, health: t.health, sourceSpecific: t.sourceSpecific }}
            translation={language !== 'en-US' ? { settings: translation.settings, loading: translation.loading, moduleStatus: translation.moduleStatus, modelProviders: translation.modelProviders, saving: translation.saving, savedThisSession: translation.savedThisSession, queuing: translation.queuing, labels: t.translationPreferences, notice: translation.notice, errorMessage: translation.errorMessage, onChange: (patch) => void translation.updateSettings(patch), onQueueMissing: (sourceIds) => void translation.queueMissing(sourceIds) } : undefined}
          /></div> : null
        })() : null}
        {/* 默认覆盖范围：一行当前值 + ⓘ（说明）+ 自定义；正文里没有整句解释。
            它决定看板带哪些资产（`intelligenceWorkspaceQueries` 每次查询现读这份设置）。 */}
        <section
          aria-label={t.focusMarkets.title}
          className="intelligence-focus-markets-section"
        >
          <div className="intelligence-focus-market-summary">
            <div className="intelligence-focus-market-defaults">
              <span className="intelligence-focus-market-default-label">{t.focusMarkets.title}</span>
              <SettingsInfo
                ariaLabelKey="settings.intelligenceSources.focusMarkets.infoAria"
                labelKeys={['settings.intelligenceSources.focusMarkets.description']}
                resolveText={(key) => focusMarketText[key] ?? ''}
              />
              <span className="intelligence-focus-market-chip-list">
                {focusDraft.map((market) => (
                  <span className="intelligence-focus-market-chip" key={market}>
                    {t.focusMarkets.markets[market]}
                  </span>
                ))}
              </span>
            </div>
            <Button
              onClick={() => setFocusExpanded((open) => !open)}
              size="small"
              type="text"
            >
              {focusExpanded ? t.focusMarkets.customizeDone : t.focusMarkets.customize}
            </Button>
          </div>
          {focusExpanded
            ? <div className="intelligence-focus-market-groups">
              <div className="intelligence-focus-market-group">
                <div className="intelligence-focus-market-grid">
                  {INTELLIGENCE_FOCUS_MARKET_IDS.map((market) => (
                    // 不套 <label>：antd 的复选框自己就是一个 label，嵌套会让 DOM 把节点重排。
                    <div className="intelligence-focus-market-tile" key={market}>
                      <Checkbox
                        aria-label={t.focusMarkets.markets[market]}
                        checked={focusDraft.includes(market)}
                        disabled={savingFocusMarkets}
                        onChange={(event) => toggleFocusMarket(market, event.target.checked)}
                      />
                      <span className="intelligence-focus-market-copy">
                        <strong>{t.focusMarkets.markets[market]}</strong>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            : null}
          {focusSaveFailed
            ? <span className="intelligence-focus-market-save-failed" role="status">
              {t.focusMarkets.saveFailed}
            </span>
            : null}
        </section>
      </div>
    </section>
  )
}
