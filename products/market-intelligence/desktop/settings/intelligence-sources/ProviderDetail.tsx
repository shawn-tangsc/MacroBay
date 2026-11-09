import { Alert, Button, Input, Switch } from 'antd'
import { Eye, EyeOff, Info } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { CollapsibleGroup } from '@platform/ui/components/collapsible-group'
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
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
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellDay } from '@platform/ui/time/shellTimeFormat'
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
  /** ⓘ 的名字（与正文那句分开：一个是名字，一个是句子）。 */
  unavailableReasonCodeAria: string
  /** 不可用源策略组停用时那一句（通用）。 */
  collectionPolicyStopped: string
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
/**
 * 一个源此刻的健康状态词。抽成具名函数（原来是内联立即执行），因为接下去要改这一行的结构：
 * 内联 IIFE 切括号最容易切错，先把它变成有名字、可单独读的一段。
 *
 * 两条规则不变：
 * - 没有 generic adapter 的源由产品自己的任务采集，管线对它无话可说，旧的手动失败记录
 *   不该读成「这个源坏了」；
 * - **「没有健康数据」不等于「健康」**：过去给已启用、无健康数据的日历源画绿的 healthy，
 *   而 BLS 正是这种源——已启用、实际取不到。没有数据就不画药丸。
 */
function SourceHealthPill({ health, resolveText, unavailable }: {
  health?: Readonly<{ runtimeStatus: 'healthy' | 'degraded' | 'failed' | 'paused'; consecutiveFailures?: number }>
  resolveText: (key: string) => string
  unavailable: boolean
}): React.ReactElement | null {
  if (unavailable) {
    return <StatusPill labelKey="settings.intelligenceSources.unavailableShort" resolveText={resolveText} tone="muted" />
  }
  if (!health) return null
  const view = healthBadgeView(health.runtimeStatus, health.consecutiveFailures ?? 0)
  return <StatusPill labelKey={view.labelKey} resolveText={resolveText} tone={view.tone} />
}

/**
 * 原因码 → 读者看到的说法。**不许从码里截数字**：码名一改，「403」就会变成别的东西、甚至取不到。
 * 表里没有的码退回不带数字的那句，永远不抛错。加一个码就在这里加一行，别在别处写第二份映射。
 */
const UNAVAILABLE_SENTENCE: Readonly<Record<string, string>> = {
  'official-endpoint-returned-403': '官方源暂时不可用（403）'
}

function unavailableSentence(reasonCode: string, fallback: string): string {
  return UNAVAILABLE_SENTENCE[reasonCode] ?? fallback
}

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
  /*
    每个源策略组的「停用原因」id 前缀。原因句在组开头，视觉上谁都看得见，但读屏不看位置——
    键盘用户 Tab 进一片灰控件只会听到一串「不可用」，不知道为什么。所以用 `role="group"` +
    `aria-describedby` 把原因挂到这一组上。**id 按源派生**：同一屏有多个不可用源时，
    组件级单个 id 会让每组的 <p> 撞同一个 id，`aria-describedby` 只能解析到第一个。
  */
  const policyGroupIdBase = useId()
  // 读者已经配好自定义代理时，不再把「需要连接 本地代理」当成他还没做的事（MI-11-R196）。
  const proxyConfigured = useProxyConfigured()
  // 「上次成功同步」是读者可见的日期：走统一格式化（跟读者时区），不自己切 ISO 字符串。
  const timeZone = useShellTimeZone()
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
        const policyStoppedId = `${policyGroupIdBase}-policy-${source.sourceId}`
        const tags = [
          unused || source.visibility === 'pending'
            ? labels.badges.pending
            : source.visibility === 'advanced'
              // 「已启用／已停用」不进标签行：开关就在行尾，词说的是开关位置；读者要判断的是
              // 这个源现在能不能用，那是状态串里状态词的事。同一个事实只说一次。
              ? labels.badges.advanced
              : null,
          isCalendar(source) ? labels.badges.calendar : null,
          ...source.panels.map((panel) => labels.panelNames[panel] ?? panel)
        ].filter((tag): tag is string => Boolean(tag))
        return <div key={source.sourceId}>
          <div className="source-provider-detail__row">
          {/* 非交互行：这个面板不提供「按源下钻」，所以它不画成入口（无按钮语义、无箭头、无
              hover）——「看着能点、其实没有去处」是这一版在清的一类假可用。 */}
          <div className="source-provider-detail__main">
            <strong>{name}</strong>
            {/* 状态串：**状态词 → 人话原因 → 上次成功**，一条 ` · ` 串起来，最多两行。 */}
            <span className="source-provider-detail__status">
              <SourceHealthPill
                health={source.collection === 'none' ? undefined : details[source.sourceId]?.health}
                resolveText={resolveText}
                unavailable={Boolean(unavailable)} />
            {/* 「不可用」不是失败：药丸之外必须给出同一句原因，读者才知道为什么取不到、数据有多旧。 */}
            {unavailable
              ? <span className="source-provider-detail__unavailable">
                {[
                  unavailableSentence(unavailable.reasonCode, resolveText('settings.intelligenceSources.unavailableShort')),
                  labels.automaticSyncStopped,
                  // 读不出合法时刻就不写这一句，而不是印一段切出来的字符串。
                  ...(unavailable.lastSuccessfulSyncAt
                    ? (() => {
                      const day = formatShellDay(unavailable.lastSuccessfulSyncAt, timeZone)
                      return day === null ? [] : [labels.lastSuccessfulSync.replace('{date}', day)]
                    })()
                    : [])
                ].join(' · ')}
              </span>
              : null}
            {/* 原因码不进正文：它在 ⓘ 里，恰一处、默认不显示。正文那句是给读者的说法。 */}
            {unavailable
              ? <Popover
                content={<code className="source-provider-detail__reason-code">{unavailable.reasonCode}</code>}
                trigger={(triggerProps) => (
                  <IconButton
                    {...triggerProps}
                    ariaLabelKey="settings.intelligenceSources.unavailableReasonCodeAria"
                    icon={Info}
                    resolveText={resolveText}
                    size="sm" />
                )} />
              : null}
            </span>
            {/* 第二行：归属与任务状态。纯文本 ` · ` 串起，不再是一排药丸。 */}
            <span className="source-provider-detail__tags-line">
              {[...new Set(tags)].join(' · ')}
              {source.requiresProxy && !proxyConfigured ? <><i aria-hidden="true"> · </i><em className="source-provider-detail__proxy">{labels.badges.proxy}</em></> : null}
              {needsJob(source) ? <><i aria-hidden="true"> · </i>{source.jobRegistered ? labels.jobRegistered : labels.jobNotRegistered}</> : null}
            </span>
          </div>
          <Switch
            /* The row's label is the source name; the switch has to say what it does, or a screen
               reader reads the same name twice and cannot tell the two controls apart. */
            aria-label={(source.enabled ? labels.toggleSource.disable : labels.toggleSource.enable).replace('{name}', name)}
            checked={source.enabled}
            disabled={source.visibility === 'pending'}
            onChange={(enabled) => void toggle(source, enabled)}
            /* ui-spec §8.3：开关唯一实现是 antd Switch，统一 small（32×18），默认尺寸不在允许写法内。 */
            size="small"
          />
          </div>
          {/* 采集策略（频率档 / 范围 / 是否纳入舆情）：每个源常显，读者不必先选中它。
              产品自有采集的源只留启用开关，预设与范围不适用（组件自己写那句说明）。 */}
          {/* 采集策略（频率档 / 范围 / 纳入情绪分析）：每个源一组，**默认收起**。
              壳 `CollapsibleGroup` 已有自定义内容形态，头行档位、箭头、`aria-controls`、缩进都由
              壳提供（另一条线 e20dd88 落地），本页不再自绘折叠头。 */}
          {policy && policy.profiles[source.sourceId]
            ? <CollapsibleGroup
              resolveText={(key) => key === 'settings.intelligenceSources.collectionPolicy.title' ? policy.labels.title : ''}
              titleKey="settings.intelligenceSources.collectionPolicy.title"
            >
              {/* 不可用的源不该还能改采集策略：整组停用，并说清为什么、什么时候恢复。
                  这句是**通用结构**——所有不可用源同一句，不针对某一个源。 */}
              {unavailable
                ? <p className="source-provider-detail__policy-stopped" id={policyStoppedId}>{labels.collectionPolicyStopped}</p>
                : null}
              {/* 原因必须能被读屏关联到**这一组控件**：可用时不留组语义、也不留悬空 id。 */}
              <div {...(unavailable ? { 'aria-describedby': policyStoppedId, role: 'group' } : {})}>
                <CollectionPolicySection
                  configurable={source.collection !== 'none' && source.visibility !== 'pending' && !unavailable}
                  draftProfile={policy.profiles[source.sourceId]!}
                  enabledConfigurable={source.visibility !== 'pending' && !unavailable}
                  labels={policy.labels}
                  onChange={(patch) => policy.onChange(source.sourceId, patch)}
                  supportsSentiment={policy.supportsSentimentById[source.sourceId] === true}
                />
              </div>
            </CollapsibleGroup>
            : null}
        </div>
      })}
    </div>
    {showSourceDetails ? <div className="source-provider-detail__details">

      {translation ? <TranslationPreferencesSection {...translation} sourceIds={provider.sources.map((source) => source.sourceId)} /> : null}
    </div> : null}
  </section>
}
