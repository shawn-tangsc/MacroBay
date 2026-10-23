import { Alert, Button, Input, Switch } from 'antd'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { setSourceEnabled } from '../../shared/intelligenceSourceToggle'
import { TranslationPreferencesSection } from './TranslationPreferencesSection'
import { isNetworkConnectionFailure, testSourceConnection } from '../../shared/intelligenceSourceTest'
import { openProxySettings } from '../../shared/navigation/productShellNavigation'
import { NetworkProxyBanner } from '../../shared/NetworkProxyBanner'
import { isAcceptedCredentialSave } from '../../shared/intelligenceCredentialResultPolicy'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'
import type { SafeIntelligenceSourceDetailView } from '../../../service/intelligence/schema/intelligenceSourcesContracts'

function isCalendar(source: SourceView): boolean {
  return source.kind === 'official-calendar' || source.kind === 'market-calendar'
}

export type ProviderDetailLabels = {
  sourceNames: Record<string, string>
  providerNames: Record<string, string>
  panelNames: Record<string, string>
  badges: { pending: string; advanced: string; calendar: string; proxy: string }
  status: { enabled: string; disabled: string }
  capabilities: string
  credentials: string
  website: string
  signup: string
  inviteNote: string
  testConnection: string
  jobRegistered: string
  jobNotRegistered: string
  connectionSucceeded: string
  connectionFailed: string
  connectionUnsupported: string
  apiKey: { label: string; save: string; emptyHint: string; savedHint: string; revealFailed: string }
}

/**
 * Right pane for a provider: lists every capability with its switch. Clicking a
 * capability drills into the existing source detail.
 */
function needsJob(source: SourceView): boolean {
  return source.collection === 'adapter'
    || source.collection === 'job'
    || source.kind === 'official-calendar'
    || source.kind === 'market-calendar'
}

export function ProviderDetail({ labels, provider, onChanged, onSelectSource, showSourceDetails, sourceDetailLabels, translation }: {
  labels: ProviderDetailLabels
  provider: ProviderView
  onSelectSource: (sourceId: string, calendar: boolean) => void
  /** Render source settings below the capability list. */
  showSourceDetails?: boolean
  sourceDetailLabels?: { health: { statuses: Readonly<Record<string, string>> }; [key: string]: unknown }
  translation?: Parameters<typeof TranslationPreferencesSection>[0]
  onChanged?: () => void
}): React.ReactElement {
  const [sources, setSources] = useState(provider.sources)
  const [credentialDraft, setCredentialDraft] = useState('')
  const [credentialPristine, setCredentialPristine] = useState(true)
  const [rawKey, setRawKey] = useState<string>()
  const [revealed, setRevealed] = useState(false)
  const [revealFailed, setRevealFailed] = useState(false)
  const [credentialStatus, setCredentialStatus] = useState<{ hasCredential: boolean; maskedPreview?: string }>()
  const [credentialFeedback, setCredentialFeedback] = useState<'saved' | 'failed'>()
  const [savingCredential, setSavingCredential] = useState(false)
  const [details, setDetails] = useState<Record<string, SafeIntelligenceSourceDetailView | undefined>>({})
  const [runningSourceId, setRunningSourceId] = useState<string>()
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionFeedback, setConnectionFeedback] = useState<'succeeded' | 'failed' | 'unsupported'>()
  /** Set only by a transport-level refusal, so a rejected key never points at the proxy setting. */
  const [networkFailure, setNetworkFailure] = useState(false)

  useEffect(() => { setSources(provider.sources) }, [provider])

  useEffect(() => {
    if (!showSourceDetails) return
    let active = true
    // Calendar feeds are registry-only sources: they have provider profiles and a scheduler, but
    // no entry in the generic intelligence-source catalog. Asking getPageState for one throws
    // "Unknown intelligence source"; their health badge comes from the calendar fallback below.
    void Promise.all(provider.sources.filter((source) => !isCalendar(source)).map(async (source) => {
      const state = await intelligenceSourcesClient.getPageState(source.sourceId).catch(() => undefined)
      return [source.sourceId, state?.detail] as const
    })).then((entries) => { if (active) setDetails(Object.fromEntries(entries)) })
    return () => { active = false }
  }, [provider.providerId, showSourceDetails])



  const inviteProvider = provider.invite === true || /[?&](?:invite|via)=/.test(provider.signupUrl ?? '')
  // A credential provider is discovered through its signup/key guide, not its home page.
  const hideWebsite = inviteProvider || provider.credential === 'api-key'
  const credentialSourceId = provider.credentialSourceId
    ?? provider.sources.find((source) => source.collection === 'adapter')?.sourceId
    ?? provider.sources[0]?.sourceId
  /**
   * The credential and the probe belong to the provider, not to the panel: the calendar pane lists
   * only calendar capabilities, so the provider's credential source must come from the registry.
   */
  const credentialTarget = credentialSourceId ? { sourceId: credentialSourceId, kind: 'feed' as const } : undefined
  const testSource = provider.sources.find((source) => source.kind === 'official-calendar') ?? credentialTarget

  useEffect(() => {
    setCredentialDraft('')
    setCredentialFeedback(undefined)
    setConnectionFeedback(undefined)
    setNetworkFailure(false)
    setTestingConnection(false)
    setCredentialStatus(undefined)
    setRawKey(undefined)
    setRevealed(false)
    setRevealFailed(false)
    if (provider.credential !== 'api-key' || !credentialTarget) return
    let active = true
    void intelligenceSourcesClient.getPageState(credentialTarget.sourceId).then((state) => {
      if (!active) return
      const status = state.detail?.credentialStatus
      setCredentialStatus(status)
      setCredentialDraft(status?.maskedPreview ?? '')
      setCredentialPristine(true)
    }).catch(() => undefined)
    return () => { active = false }
  }, [provider.providerId, credentialSourceId])

  async function toggleReveal(): Promise<void> {
    if (revealed) { setRevealed(false); return }
    if (!credentialTarget) return
    let key = rawKey
    if (key === undefined) {
      const result = await intelligenceSourcesClient.revealCredential(credentialTarget.sourceId).catch(() => ({ apiKey: null }))
      key = result.apiKey ?? ''
      setRawKey(key)
    }
    if (!key) { setRevealFailed(true); return }
    setRevealFailed(false)
    setRevealed(true)
  }

  async function testConnection(): Promise<void> {
    if (!testSource) return
    setTestingConnection(true)
    setConnectionFeedback(undefined)
    try {
      const result = await testSourceConnection(testSource)
      setConnectionFeedback(result.ok ? 'succeeded' : result.unsupported ? 'unsupported' : 'failed')
      setNetworkFailure(isNetworkConnectionFailure(result))
    } catch {
      setConnectionFeedback('failed')
      setNetworkFailure(false)
    } finally {
      setTestingConnection(false)
    }
  }

  async function saveCredential(): Promise<void> {
    if (!credentialTarget || credentialPristine || !credentialDraft.trim()) return
    setSavingCredential(true)
    try {
      const result = await intelligenceSourcesClient.testCredentials({ sourceId: credentialTarget.sourceId, credentialDraft })
      if (!isAcceptedCredentialSave(result, credentialTarget.sourceId)) {
        setCredentialFeedback('failed')
        return
      }
      const state = await intelligenceSourcesClient.getPageState(credentialTarget.sourceId)
      const status = state.detail?.credentialStatus
      setCredentialStatus(status)
      setCredentialDraft(status?.maskedPreview ?? '')
      setCredentialPristine(true)
      setCredentialFeedback('saved')
    } catch {
      setCredentialFeedback('failed')
    } finally {
      setSavingCredential(false)
    }
  }

  async function toggle(source: SourceView, enabled: boolean): Promise<void> {
    setSources((current) => current.map((item) => item.sourceId === source.sourceId ? { ...item, enabled } : item))
    await setSourceEnabled(source, enabled).then(() => onChanged?.()).catch(() => {
      setSources((current) => current.map((item) => item.sourceId === source.sourceId ? { ...item, enabled: !enabled } : item))
    })
  }

  const providerName = labels.providerNames[provider.providerId] ?? provider.displayName

  return <section className="source-provider-detail">
    {networkFailure && provider.sources.some((source) => source.requiresProxy) ? (
      <NetworkProxyBanner onOpenProxySettings={openProxySettings} />
    ) : null}
    <header className="source-provider-detail__header">
      <h2>{providerName}</h2>
      <p>{labels.capabilities.replace('{total}', String(sources.length)).replace('{enabled}', String(sources.filter((source) => source.enabled).length))}</p>
      {provider.credential === 'api-key' ? <>
        <small>{labels.credentials}</small>
        <div className="source-provider-detail__credential">
          <label>
            <span>{labels.apiKey.label}</span>
            <Input
              aria-label={labels.apiKey.label}
              placeholder={labels.apiKey.emptyHint}
              type={revealed || credentialPristine ? 'text' : 'password'}
              value={revealed ? rawKey ?? '' : credentialDraft}
              suffix={<button
                aria-label={labels.apiKey.label}
                className="source-provider-detail__reveal"
                type="button"
                onClick={() => void toggleReveal()}
              >{revealed ? <EyeOff size={13} /> : <Eye size={13} />}</button>}
              onChange={(event) => { setCredentialPristine(false); setRevealed(false); setRevealFailed(false); setCredentialDraft(event.target.value) }}
            />
            <Button disabled={credentialPristine || !credentialDraft.trim() || savingCredential} loading={savingCredential} onClick={() => void saveCredential()}>{labels.apiKey.save}</Button>
            <Button disabled={testingConnection} loading={testingConnection} onClick={() => void testConnection()}>{labels.testConnection}</Button>
          </label>
          {revealFailed ? <small>{labels.apiKey.revealFailed}</small> : null}
          {credentialFeedback ? <Alert message={credentialFeedback === 'saved' ? labels.apiKey.savedHint : labels.credentials} showIcon type={credentialFeedback === 'saved' ? 'success' : 'error'} /> : null}
        </div>
      </> : null}
      {inviteProvider && provider.signupUrl ? <p className="source-provider-detail__invite">{labels.inviteNote}</p> : null}
      <div className="source-provider-detail__actions">
        {provider.website && !hideWebsite ? <Button onClick={() => window.open(provider.website, '_blank', 'noopener,noreferrer')}>{labels.website}</Button> : null}
        {provider.signupUrl ? <Button onClick={() => window.open(provider.signupUrl, '_blank', 'noopener,noreferrer')}>{labels.signup}</Button> : null}
        {provider.credential !== 'api-key' ? <Button disabled={testingConnection} loading={testingConnection} onClick={() => void testConnection()}>{labels.testConnection}</Button> : null}
        {connectionFeedback ? <Alert
          message={connectionFeedback === 'succeeded' ? labels.connectionSucceeded : connectionFeedback === 'unsupported' ? labels.connectionUnsupported : labels.connectionFailed}
          showIcon
          type={connectionFeedback === 'succeeded' ? 'success' : connectionFeedback === 'unsupported' ? 'warning' : 'error'}
        /> : null}
      </div>
    </header>
    <div className="source-provider-detail__list">
      {sources.map((source) => {
        const name = labels.sourceNames[source.sourceId] ?? source.displayName
        const unused = source.panels.length === 0
        const tags = [
          unused || source.visibility === 'pending'
            ? labels.badges.pending
            : source.visibility === 'advanced'
              ? labels.badges.advanced
              : source.enabled ? labels.status.enabled : labels.status.disabled,
          isCalendar(source) ? labels.badges.calendar : null,
          ...source.panels.map((panel) => labels.panelNames[panel] ?? panel)
        ].filter((tag): tag is string => Boolean(tag))
        return <div key={source.sourceId}>
          <div className="source-provider-detail__row">
          <button className="source-provider-detail__main" type="button" onClick={() => onSelectSource(source.sourceId, isCalendar(source))}>
            <strong>{name}</strong>
            <span className="intelligence-source-tags">
              {[...new Set(tags)].map((tag) => <em key={tag}>{tag}</em>)}
              {source.requiresProxy ? <em className="source-provider-detail__proxy">{labels.badges.proxy}</em> : null}
              {needsJob(source) ? <em className={`source-provider-detail__job${source.jobRegistered ? ' is-on' : ''}`}>{source.jobRegistered ? labels.jobRegistered : labels.jobNotRegistered}</em> : null}
              {(() => {
                const detailHealth = details[source.sourceId]?.health.runtimeStatus
                const calendarHealth = !detailHealth && source.enabled && source.jobRegistered && source.kind.includes('calendar') ? 'healthy' : undefined
                const status = detailHealth ?? calendarHealth
                return status ? <em className={`source-provider-detail__health is-${status}`}>{sourceDetailLabels?.health.statuses[status] ?? status}</em> : null
              })()}
            </span>
          </button>
          <Switch
            aria-label={name}
            checked={source.enabled}
            disabled={source.visibility === 'pending'}
            onChange={(enabled) => void toggle(source, enabled)}
          />
          </div>

        </div>
      })}
    </div>
    {showSourceDetails ? <div className="source-provider-detail__details">

      {translation ? <TranslationPreferencesSection {...translation} /> : null}
    </div> : null}
  </section>
}
