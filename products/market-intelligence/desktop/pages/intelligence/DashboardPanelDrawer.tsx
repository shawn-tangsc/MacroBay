import { Alert, Button, Input, Switch } from 'antd'
import { ChevronRight, Play } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Drawer } from '@platform/ui/components/drawer'
import { LoadingState } from '@platform/ui/components/loading'
import { StateView, STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { productText } from '../../shared/i18n/productText'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { openIntelligenceSourcesSettings } from '../../shared/navigation/productShellNavigation'
import { ProviderDetail } from '../../settings/intelligence-sources/ProviderDetail'
import { useIntelligenceTranslationSettings } from '../../settings/intelligence-sources/useIntelligenceTranslationSettings'
import '../../settings/intelligence-sources/intelligence-sources.css'
import { panelView, type PanelView, type SourceView } from '../../../service/intelligence/application/sourceProjection'
import type { PanelId } from '../../../service/intelligence/application/providerRegistry'

function isCalendar(source: SourceView): boolean {
  return source.kind === 'official-calendar' || source.kind === 'market-calendar'
}

/**
 * What the drawer is showing.
 *
 * A failed read is its own state. It used to fall back to the registry projection and render a
 * list that looked exactly like the reader's own setup, which turned "we could not ask" into
 * "this is what you have configured". The projection may stand in only in sample mode, where it
 * describes the sample data and carries the sample marker.
 */
type DrawerRead =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; view: PanelView; sampleFallback: boolean }>
  | Readonly<{ status: 'unavailable' }>

export function DashboardPanelDrawer({ initialSourceId, panelId = 'dashboard', open, onClose, titleKey, sampleActive = false }: {
  initialSourceId?: string
  panelId?: PanelId
  open: boolean
  onClose: () => void
  /** The header's i18n key; the drawer resolves it. */
  titleKey?: string
  /** Only an explicit sample session may stand in the registry projection for a failed read. */
  sampleActive?: boolean
}): React.ReactElement {
  const language = useShellLanguage()
  const resolveKey = useProductTextKey()
  const portalText = productText[language].pages.intelligence.portal
  const text = portalText.dashboard.sourceConfiguration
  const dataText = portalText.data
  const sampleMarker = portalText.sampleMode.watermark
  const settingsText = productText[language].settings.intelligenceSources
  const translation = useIntelligenceTranslationSettings(settingsText.translationPreferences)
  const [read, setRead] = useState<DrawerRead>({ status: 'loading' })
  const [providerId, setProviderId] = useState<string>()
  const [busy, setBusy] = useState<string>()

  const readPanel = useCallback(async (): Promise<DrawerRead> => {
    const remote = await intelligenceSourcesClient.getPanelView(panelId).catch(() => undefined)
    if (remote) return { status: 'ready', view: remote, sampleFallback: false }
    // Nothing was read. Outside sample mode that is the whole answer: a registry projection here
    // would be a list the reader never configured, wearing the same clothes as their own.
    if (!sampleActive) return { status: 'unavailable' }
    const fallback = panelView(panelId)
    return fallback ? { status: 'ready', view: fallback, sampleFallback: true } : { status: 'unavailable' }
  }, [panelId, sampleActive])

  const applyRead = useCallback((next: DrawerRead): void => {
    setRead(next)
    if (next.status !== 'ready') {
      setProviderId(undefined)
      return
    }
    const initialProvider = initialSourceId
      ? next.view.providers.find((provider) => provider.sources.some((source) => source.sourceId === initialSourceId))
      : undefined
    setProviderId(initialProvider?.providerId ?? next.view.providers[0]?.providerId)
  }, [initialSourceId])

  useEffect(() => {
    if (!open) return
    let active = true
    setRead({ status: 'loading' })
    void readPanel().then((next) => { if (active) applyRead(next) })
    return () => { active = false }
  }, [open, readPanel, applyRead])

  const view = read.status === 'ready' ? read.view : undefined
  const selectedProvider = view?.providers.find((provider) => provider.providerId === providerId)

  /** Retry asks the source service again; clearing the error without a request is not a retry. */
  const retry = async (): Promise<void> => {
    setRead({ status: 'loading' })
    applyRead(await readPanel())
  }

  async function toggle(sourceId: string, enabled: boolean): Promise<void> {
    setBusy(sourceId)
    try {
      await intelligenceSourcesClient.setEnabled(sourceId, enabled)
      applyRead(await readPanel())
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

  return <Drawer className="mi-dashboard-source-drawer" mode="modal" open={open} onClose={onClose} resolveText={resolveKey} size="wide"
    titleKey={titleKey ?? 'pages.intelligence.portal.dashboard.sourceConfiguration.title'} footer={
      <Button onClick={openIntelligenceSourcesSettings}>{text.configure}</Button>
    }>
    {read.status === 'loading' ? <LoadingState label={text.loading} fill />
      : read.status === 'unavailable' ? <div data-drawer-state="unavailable">
        {/* 读不到不是「没有配置」：走统一状态面，句子由平台给，动作是真重试。 */}
        <StateView state="error" reasonCode="unreadable"
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => void retry() }} />
      </div>
      : <>
        {read.sampleFallback ? <div data-sample-marker><Alert message={sampleMarker} showIcon type="info" /></div> : null}
        <div className="mi-dashboard-source-drawer__layout">
          <aside className="intelligence-catalog-pane">
            <div className="intelligence-catalog-list">
              {view?.providers.map((provider) => {
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
              labels={{ sourceNames: settingsText.sourceNames as Readonly<Record<string, string>>, providerNames: settingsText.providerNames as Readonly<Record<string, string>>, panelNames: settingsText.panelNames as Readonly<Record<string, string>>, badges: { pending: settingsText.sourceBadges.pending, advanced: settingsText.sourceBadges.advanced, calendar: settingsText.sourceBadges.calendar, proxy: settingsText.sourceBadges.proxy }, status: settingsText.status, capabilities: settingsText.providerSummary, toggleSource: settingsText.toggleSource, credentials: settingsText.credentialsRequired, website: settingsText.website, signup: settingsText.signup, inviteNote: settingsText.inviteNote, testConnection: settingsText.testConnection, jobRegistered: settingsText.jobRegistered, jobNotRegistered: settingsText.jobNotRegistered, connectionSucceeded: settingsText.connectionSucceeded, connectionFailed: settingsText.connectionFailed, connectionUnsupported: settingsText.connectionUnsupported, apiKey: settingsText.apiKey }}
              provider={selectedProvider}
              showSourceDetails
              sourceDetailLabels={{ sourceNames: settingsText.sourceNames as Readonly<Record<string, string>>, providerNames: settingsText.providerNames as Readonly<Record<string, string>>, enabled: settingsText.status.enabled, disabled: settingsText.status.disabled, pending: settingsText.sourceBadges.pending, runNow: settingsText.header.runNow, testConnection: settingsText.testConnection, connectionSucceeded: settingsText.connectionSucceeded, connectionFailed: settingsText.connectionFailed, health: settingsText.health, sourceSpecific: settingsText.sourceSpecific }}
              translation={{ settings: translation.settings, moduleStatus: translation.moduleStatus, modelProviders: translation.modelProviders, saving: translation.saving, savedThisSession: translation.savedThisSession, queuing: translation.queuing, labels: settingsText.translationPreferences, notice: translation.notice, errorMessage: translation.errorMessage, onChange: (patch) => void translation.updateSettings(patch), onQueueMissing: (sourceIds) => void translation.queueMissing(sourceIds) }}
              onChanged={() => { void readPanel().then(applyRead) }}
              onSelectSource={() => undefined}
            /> : <p>{text.unavailable}</p>}
          </section>
        </div>
      </>}
  </Drawer>
}
