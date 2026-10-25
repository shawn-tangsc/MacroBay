import { Alert, Button, Drawer, Input, Switch } from 'antd'
import { ChevronRight, Play } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { productText } from '../../shared/i18n/productText'
import { openIntelligenceSourcesSettings } from '../../shared/navigation/productShellNavigation'
import { ProviderDetail } from '../../settings/intelligence-sources/ProviderDetail'
import { useIntelligenceTranslationSettings } from '../../settings/intelligence-sources/useIntelligenceTranslationSettings'
import '../../settings/intelligence-sources/intelligence-sources.css'
import { panelView, type PanelView, type SourceView } from '../../../service/intelligence/application/sourceProjection'
import type { PanelId } from '../../../service/intelligence/application/providerRegistry'

function isCalendar(source: SourceView): boolean {
  return source.kind === 'official-calendar' || source.kind === 'market-calendar'
}

export function DashboardPanelDrawer({ initialSourceId, panelId = 'dashboard', open, onClose, title }: {
  initialSourceId?: string
  panelId?: PanelId
  open: boolean
  onClose: () => void
  title?: string
}): React.ReactElement {
  const language = useShellLanguage()
  const text = productText[language].pages.intelligence.portal.dashboard.sourceConfiguration
  const settingsText = productText[language].settings.intelligenceSources
  const translation = useIntelligenceTranslationSettings(settingsText.translationPreferences)
  const [view, setView] = useState<PanelView>()
  const [providerId, setProviderId] = useState<string>()
  const [busy, setBusy] = useState<string>()

  async function load(): Promise<PanelView> {
    try {
      return await intelligenceSourcesClient.getPanelView(panelId) ?? panelView(panelId)!
    } catch {
      return panelView(panelId)!
    }
  }

  useEffect(() => {
    if (!open) return
    let active = true
    void load().then((next) => {
      if (!active) return
      setView(next)
      const initialProvider = initialSourceId ? next?.providers.find((provider) => provider.sources.some((source) => source.sourceId === initialSourceId)) : undefined
      setProviderId(initialProvider?.providerId ?? next?.providers[0]?.providerId)
    })
    return () => { active = false }
  }, [open, initialSourceId, panelId])

  const sources = view?.providers.flatMap((provider) => provider.sources) ?? []
  const selectedProvider = view?.providers.find((provider) => provider.providerId === providerId)
  async function toggle(sourceId: string, enabled: boolean): Promise<void> {
    setBusy(sourceId)
    try {
      await intelligenceSourcesClient.setEnabled(sourceId, enabled)
      const next = await load()
      if (next) setView(next)
    } finally {
      setBusy(undefined)
    }
  }

  async function run(sourceId: string): Promise<void> {
    setBusy(sourceId)
    try { await intelligenceSourcesClient.runNow(sourceId) } finally { setBusy(undefined) }
  }

  async function test(sourceId: string): Promise<void> {
    setBusy(sourceId)
    try { await intelligenceSourcesClient.testConnection(sourceId) } finally { setBusy(undefined) }
  }

  return <Drawer className="mi-dashboard-source-drawer" open={open} onClose={onClose} title={title ?? text.title} width={860} footer={
    <Button onClick={openIntelligenceSourcesSettings}>{text.configure}</Button>
  }>
    {!view ? <p>{text.loading}</p> : <div className="mi-dashboard-source-drawer__layout">
      <aside className="intelligence-catalog-pane">
        <div className="intelligence-catalog-list">
          {view.providers.map((provider) => {
            const providerName = (settingsText.providerNames as Readonly<Record<string, string>>)[provider.providerId] ?? provider.displayName
            const enabled = provider.sources.filter((source) => source.enabled).length
            const summary = settingsText.providerSummary.replace('{total}', String(provider.sources.length)).replace('{enabled}', String(enabled))
            return <section className="intelligence-provider-group" key={provider.providerId}>
              <button
                className={`intelligence-provider-row${provider.providerId === providerId ? ' selected' : ''}`}
                type="button"
                onClick={() => setProviderId(provider.providerId)}
              >
                <span className={`intelligence-source-avatar${provider.sources.every((source) => source.panels.length === 0) ? ' is-unused' : ''}`} aria-hidden="true">{providerName.slice(0, 1).toUpperCase()}</span>
                <span className="intelligence-provider-main"><strong>{providerName}</strong><small>{summary}</small></span>
                <span className="intelligence-provider-state"><i className={enabled > 0 ? 'is-on' : ''} aria-hidden="true" /><ChevronRight aria-hidden="true" size={13} /></span>
              </button>
            </section>
          })}
        </div>
      </aside>
      <section className="settings-detail-pane intelligence-detail-pane">
        {selectedProvider ? <ProviderDetail
          labels={{ sourceNames: settingsText.sourceNames as Readonly<Record<string, string>>, providerNames: settingsText.providerNames as Readonly<Record<string, string>>, panelNames: settingsText.panelNames as Readonly<Record<string, string>>, badges: { pending: settingsText.sourceBadges.pending, advanced: settingsText.sourceBadges.advanced, calendar: settingsText.sourceBadges.calendar, proxy: settingsText.sourceBadges.proxy }, status: settingsText.status, capabilities: settingsText.providerSummary, credentials: settingsText.credentialsRequired, website: settingsText.website, signup: settingsText.signup, inviteNote: settingsText.inviteNote, testConnection: settingsText.testConnection, jobRegistered: settingsText.jobRegistered, jobNotRegistered: settingsText.jobNotRegistered, connectionSucceeded: settingsText.connectionSucceeded, connectionFailed: settingsText.connectionFailed, connectionUnsupported: settingsText.connectionUnsupported, apiKey: settingsText.apiKey }}
          provider={selectedProvider}
          showSourceDetails
          sourceDetailLabels={{ sourceNames: settingsText.sourceNames as Readonly<Record<string, string>>, providerNames: settingsText.providerNames as Readonly<Record<string, string>>, enabled: settingsText.status.enabled, disabled: settingsText.status.disabled, pending: settingsText.sourceBadges.pending, runNow: settingsText.header.runNow, testConnection: settingsText.testConnection, connectionSucceeded: settingsText.connectionSucceeded, connectionFailed: settingsText.connectionFailed, health: settingsText.health, sourceSpecific: settingsText.sourceSpecific }}
          translation={{ settings: translation.settings, moduleStatus: translation.moduleStatus, modelProviders: translation.modelProviders, saving: translation.saving, queuing: translation.queuing, labels: settingsText.translationPreferences, notice: translation.notice, errorCode: translation.errorCode, onChange: (patch) => void translation.updateSettings(patch), onQueueMissing: () => void translation.queueMissing() }}
          onChanged={() => { void load().then((next) => setView(next)) }}
          onSelectSource={() => undefined}
        /> : <p>{text.unavailable}</p>}
      </section>
    </div>}
  </Drawer>
}
