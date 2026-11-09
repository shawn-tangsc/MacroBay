import { Alert, Button, Collapse, Input, Switch } from 'antd'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { setSourceEnabled } from '../../shared/intelligenceSourceToggle'
import { CollectionPolicySection, type CollectionPolicyLabels } from './CollectionPolicySection'
import { TranslationPreferencesSection } from './TranslationPreferencesSection'
import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import { isNetworkConnectionFailure, testSourceConnection } from '../../shared/intelligenceSourceTest'
import { openProxySettings } from '../../shared/navigation/productShellNavigation'
import { NetworkProxyBanner } from '../../shared/NetworkProxyBanner'
import { useProxyConfigured } from '../../shared/useProxyConfigured'
import { isAcceptedCredentialSave } from '../../shared/intelligenceCredentialResultPolicy'
import { SOURCE_REPEATED_FAILURE_THRESHOLD, type ProviderView, type SourceView } from '../../../service/intelligence/application/sourceProjection'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
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
  toggleSource: Readonly<{ enable: string; disable: string }>
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
  /**
   * 设置页只说**短句**（这里不显示内容，用全句会承诺「先显示上次同步的内容」而这儿没有内容）。
   * 原因码、自动同步已停止、上次成功日期照原样给，由下面三个模板拼。
   */
  unavailableReasonCode: string
  automaticSyncStopped: string
  lastSuccessfulSync: string
}

/** The badge's own words; the tone rides along, the word carries the meaning. */
const HEALTH_LABEL_KEYS = {
  healthy: 'settings.intelligenceSources.health.statuses.healthy',
  multipleFailures: 'settings.intelligenceSources.health.statuses.multiple-failures',
  dataStale: 'settings.intelligenceSources.health.statuses.data-stale',
  failed: 'settings.intelligenceSources.health.statuses.failed',
  paused: 'settings.intelligenceSources.health.statuses.paused'
} as const

/**
 * One place maps a runtime state to its word and tone, so a call site cannot show a calm word on a
 * red badge. `degraded` covers two causes and the failure count is the only one the payload can
 * separate: at or past the shared threshold it is repeated failures (really broken), below it the
 * last collections simply did not land, which is stale data. `paused` is what the service reports
 * for a disabled source, so its word is "off", not "paused".
 */
export function healthBadgeView(
  status: 'healthy' | 'degraded' | 'failed' | 'paused',
  consecutiveFailures: number
): Readonly<{ labelKey: string; tone: StatusPillTone }> {
  if (status === 'healthy') return { labelKey: HEALTH_LABEL_KEYS.healthy, tone: 'ok' }
  if (status === 'failed') return { labelKey: HEALTH_LABEL_KEYS.failed, tone: 'bad' }
  if (status === 'paused') return { labelKey: HEALTH_LABEL_KEYS.paused, tone: 'muted' }
  return consecutiveFailures >= SOURCE_REPEATED_FAILURE_THRESHOLD
    ? { labelKey: HEALTH_LABEL_KEYS.multipleFailures, tone: 'bad' }
    : { labelKey: HEALTH_LABEL_KEYS.dataStale, tone: 'warn' }
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

/** The one rule for the probe button, so a test can hold it without rendering the pane. */
export function offersConnectionTest(provider: { credential: string; sources: ReadonlyArray<{ capabilities?: { testConnection?: boolean } }> }): boolean {
  return provider.credential !== 'api-key' && provider.sources.some((source) => source.capabilities?.testConnection === true)
}

export function ProviderDetail({ labels, provider, onChanged, policy, showSourceDetails, sourceDetailLabels, translation }: {
  labels: ProviderDetailLabels
  provider: ProviderView
  /** Render source settings below the capability list. */
  showSourceDetails?: boolean
  /**
   * 每个源的采集策略（频率档 / 范围 / 是否纳入舆情）。页面上常显：读者不必先选中某个源。
   * 数据与写入都来自页面的 profile 列表，这里只画。
   */
  policy?: {
    profiles: Readonly<Record<string, IntelligenceSourceProfile>>
    labels: CollectionPolicyLabels
    supportsSentimentById: Readonly<Record<string, boolean>>
    onChange: (sourceId: string, patch: Partial<IntelligenceSourceProfile>) => void
  }
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
  const resolveText = useProductTextKey()
  // 读者已经配好自定义代理时，不再把「需要连接 VPN」当成他还没做的事（MI-11-R196）。
  const proxyConfigured = useProxyConfigured()
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
  const hasProxySource = provider.sources.some((source) => source.requiresProxy)

  return <section className="source-provider-detail">
    {/* 要求在前、探测只把措辞收紧；读者配好代理后不再显示「去配代理」，只在真失败时回来。 */}
    {hasProxySource && (!proxyConfigured || networkFailure) ? <NetworkProxyBanner
      tone={networkFailure ? 'failed' : 'requires'}
      configured={proxyConfigured}
      onOpenProxySettings={openProxySettings}
    /> : null}
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
              suffix={<IconButton
                ariaLabelKey={revealed ? 'settings.intelligenceSources.apiKey.hide' : 'settings.intelligenceSources.apiKey.reveal'}
                icon={revealed ? EyeOff : Eye}
                onSelect={() => void toggleReveal()}
                resolveText={resolveText}
                size="sm"
              />}
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
        {/* A provider whose sources declare no probe has nothing to test; offering the button
            only produces a red error for an action that was never supported. */}
        {offersConnectionTest(provider)
          ? <Button disabled={testingConnection} loading={testingConnection} onClick={() => void testConnection()}>{labels.testConnection}</Button>
          : null}
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
        const unavailable = source.unavailable
        const tags = [
          unused || source.visibility === 'pending'
            ? labels.badges.pending
            : source.visibility === 'advanced'
              ? labels.badges.advanced
              : unavailable
                // 「不可用」时不打「已启用／已停用」：那个词说的是启用开关的位置，读者要判断的是
                // 这个源现在能不能用。三个状态词并排（已启用 + 未安排 + 不可用）没人知道哪个说了算。
                ? null
                : source.enabled ? labels.status.enabled : labels.status.disabled,
          isCalendar(source) ? labels.badges.calendar : null,
          ...source.panels.map((panel) => labels.panelNames[panel] ?? panel)
        ].filter((tag): tag is string => Boolean(tag))
        return <div key={source.sourceId}>
          <div className="source-provider-detail__row">
          {/* 非交互行：这个面板不提供「按源下钻」，所以它不画成入口（无按钮语义、无箭头、无
              hover）——「看着能点、其实没有去处」是这一版在清的一类假可用。 */}
          <div className="source-provider-detail__main">
            <strong>{name}</strong>
            <span className="intelligence-source-tags">
              {[...new Set(tags)].map((tag) => <em key={tag}>{tag}</em>)}
              {source.requiresProxy && !proxyConfigured ? <em className="source-provider-detail__proxy">{labels.badges.proxy}</em> : null}
              {needsJob(source) ? <em className={`source-provider-detail__job${source.jobRegistered ? ' is-on' : ''}`}>{source.jobRegistered ? labels.jobRegistered : labels.jobNotRegistered}</em> : null}
              {(() => {
                // A source with no generic adapter is collected by the product's own job; the
                // pipeline has nothing to say about it, and an old failure from a manual attempt
                // would otherwise read as "this source is broken".
                const health = source.collection === 'none' ? undefined : details[source.sourceId]?.health
                // 「没有健康数据」不等于「健康」：过去这里给已启用、无健康数据的日历源画绿的 healthy，
                // 而 BLS 正是这种源——已启用、实际取不到。没有数据就不画药丸。
                if (unavailable) {
                  return <StatusPill labelKey="settings.intelligenceSources.unavailableShort" resolveText={resolveText} tone="muted" />
                }
                if (!health) return null
                const view = healthBadgeView(health.runtimeStatus, health.consecutiveFailures ?? 0)
                return <StatusPill labelKey={view.labelKey} resolveText={resolveText} tone={view.tone} />
              })()}
            </span>
            {/* 「不可用」不是失败：药丸之外必须给出同一句原因，读者才知道为什么取不到、数据有多旧。 */}
            {unavailable
              ? <span className="source-provider-detail__unavailable">
                {[
                  labels.unavailableReasonCode.replace('{code}', unavailable.reasonCode),
                  labels.automaticSyncStopped,
                  ...(unavailable.lastSuccessfulSyncAt
                    ? [labels.lastSuccessfulSync.replace('{date}', unavailable.lastSuccessfulSyncAt.slice(0, 10))]
                    : [])
                ].join(' · ')}
              </span>
              : null}
          </div>
          <Switch
            /* The row's label is the source name; the switch has to say what it does, or a screen
               reader reads the same name twice and cannot tell the two controls apart. */
            aria-label={(source.enabled ? labels.toggleSource.disable : labels.toggleSource.enable).replace('{name}', name)}
            checked={source.enabled}
            disabled={source.visibility === 'pending'}
            onChange={(enabled) => void toggle(source, enabled)}
          />
          </div>
          {/* 采集策略（频率档 / 范围 / 是否纳入舆情）：每个源常显，读者不必先选中它。
              产品自有采集的源只留启用开关，预设与范围不适用（组件自己写那句说明）。 */}
          {/* 采集策略（频率档 / 范围 / 纳入情绪分析）：每个源一组，**默认收起**。
              七个源就是近三十行，平铺会把详情面板的滚动撑散（界面设计 2026-11-09）。
              平台 `CollapsibleGroup` 只收「行列表」，装不了这四行控件；它落地后换壳，
              这里先用 antd `Collapse` 的同一形态（头行 + 箭头 + 展开区）。 */}
          {policy && policy.profiles[source.sourceId]
            ? <Collapse
              ghost
              items={[{
                key: source.sourceId,
                label: policy.labels.title,
                children: <CollectionPolicySection
                  configurable={source.collection !== 'none' && source.visibility !== 'pending'}
                  draftProfile={policy.profiles[source.sourceId]!}
                  enabledConfigurable={source.visibility !== 'pending'}
                  labels={policy.labels}
                  onChange={(patch) => policy.onChange(source.sourceId, patch)}
                  onEnabledChange={(enabled) => void toggle(source, enabled)}
                  supportsSentiment={policy.supportsSentimentById[source.sourceId] === true}
                />
              }]}
              size="small"
            />
            : null}
        </div>
      })}
    </div>
    {showSourceDetails ? <div className="source-provider-detail__details">

      {translation ? <TranslationPreferencesSection {...translation} sourceIds={provider.sources.map((source) => source.sourceId)} /> : null}
    </div> : null}
  </section>
}
