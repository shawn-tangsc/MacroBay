import { Alert, Button, Input, Switch } from 'antd'
import { Eye, EyeOff } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'

import { CollapsibleGroup } from '@platform/ui/components/collapsible-group'
import { ErrorBoundary } from '@platform/ui/components/error-boundary'
import { IconButton } from '@platform/ui/components/icon-button'
import { StatusPill } from '@platform/ui/components/status-pill'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { setSourceEnabled } from '../../shared/intelligenceSourceToggle'
import { CollectionPolicySection, type CollectionPolicyLabels } from './CollectionPolicySection'
import { SourceHealthDetail, type SourceDetailRead, type SourceHealthLabels } from './SourceHealthDetail'
import type { SourceRunOutcome } from './intelligenceSourceProfileEditor'
import { healthStateBadge } from './sourceHealthTone'
import { TranslationPreferencesSection } from './TranslationPreferencesSection'
import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import { isNetworkConnectionFailure, testSourceConnection } from '../../shared/intelligenceSourceTest'
import { openProxySettings } from '../../shared/navigation/productShellNavigation'
import { NetworkProxyBanner } from '../../shared/NetworkProxyBanner'
import { useProxyConfigured } from '../../shared/useProxyConfigured'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { isAcceptedCredentialSave } from '../../shared/intelligenceCredentialResultPolicy'
import type { ProviderView, SourceHealthState, SourceView } from '../../../service/intelligence/application/sourceProjection'
import { useProductTextKey } from '../../shared/i18n/productTextKey'

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
  /** B4 四格：今天有没有读数 / 上次成功 / 为什么没在采 / 能不能立刻采。 */
  health: SourceHealthLabels
}

/**
 * 一行药丸：**只读投影**（`SourceView.healthState`），词与色都走 `healthStateBadge` 那一处映射。
 * 视图层不再拿 `runtimeStatus`/失败数算一遍——同一份事实两处判，迟早一行绿一行红。
 * `off` 不画词（它盖住「没启用 / 取不到 / 没有读数」三种处境）；「取不到」那一种由行内「不可用」说。
 */
function SourceHealthPill({ state, resolveText, unavailable }: {
  state?: SourceHealthState
  resolveText: (key: string) => string
  unavailable: boolean
}): React.ReactElement | null {
  if (unavailable) {
    return <StatusPill labelKey="settings.intelligenceSources.unavailableShort" resolveText={resolveText} tone="muted" />
  }
  const badge = state === undefined ? undefined : healthStateBadge(state)
  if (badge === undefined) return null
  return <StatusPill labelKey={badge.labelKey} resolveText={resolveText} tone={badge.tone} />
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

export function ProviderDetail({ labels, provider, onChanged, policy, showSourceDetails, sourceDetailLabels, translation, supportsRunNowById, onRunNow, onToggleSource }: {
  labels: ProviderDetailLabels
  provider: ProviderView
  /** 目录声明的「平台允许立即运行」（`supportsRunNow`），按源给；日历 feed 不在目录里就没有这一项。 */
  supportsRunNowById?: Readonly<Record<string, boolean>>
  /**
   * B5 立即运行：按源跑一次并回这一次的结果（成功带摘要 / 没成带原因）。没有这个入口
   * （例如只读嵌入）时，四格只回答「能不能」，不画按钮。
   */
  onRunNow?: (sourceId: string) => Promise<SourceRunOutcome>
  /**
   * 启用开关的唯一写入点（页面 hook）。返回 false = 没存上，组件回滚并把值留在原处。
   * 没给（尚未迁移的第二宿主，例如看板抽屉）时退回旧行为，S2 收口时删除这条退路。
   */
  onToggleSource?: (source: Readonly<{ sourceId: string; kind: string }>, enabled: boolean) => Promise<boolean>
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
  const [details, setDetails] = useState<Record<string, SourceDetailRead>>({})
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

  /**
   * 每个源的详情：**读取失败是一种状态，不是「没有数据」**（读者要能重试）。
   * 日历 feed 不读通用详情（它不在通用目录里，问一次只会得到「未知来源」）——记 `skipped`，
   * 四格里读不到的那两格写「未知」并说明原因。
   */
  const loadDetail = useCallback(async (sourceId: string, active: () => boolean): Promise<void> => {
    setDetails((current) => ({ ...current, [sourceId]: { state: 'loading' } }))
    try {
      const state = await intelligenceSourcesClient.getPageState(sourceId)
      if (!active()) return
      const detail = state?.detail
      setDetails((current) => ({
        ...current,
        [sourceId]: detail === undefined ? { state: 'failed' } : { state: 'ready', detail }
      }))
    } catch {
      if (!active()) return
      setDetails((current) => ({ ...current, [sourceId]: { state: 'failed' } }))
    }
  }, [])

  useEffect(() => {
    if (!showSourceDetails) return
    let active = true
    const sources = provider.sources.filter((source) => !isCalendar(source))
    setDetails((current) => {
      const next: Record<string, SourceDetailRead> = {}
      for (const source of provider.sources) {
        next[source.sourceId] = isCalendar(source)
          ? { state: 'skipped' }
          // 同一屏重渲染时保留已读到的结果：重读由「重试」触发，不因为父级刷新把四格闪空。
          : current[source.sourceId]?.state === 'ready' ? current[source.sourceId]! : { state: 'loading' }
      }
      return next
    })
    for (const source of sources) void loadDetail(source.sourceId, () => active)
    return () => { active = false }
  }, [provider.providerId, showSourceDetails, loadDetail])

  /** 读失败后的重试：重新问这一次源，不改任何设置。 */
  const retryDetail = useCallback((sourceId: string): void => {
    void loadDetail(sourceId, () => true)
  }, [loadDetail])



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
    const rollback = (): void => {
      setSources((current) => current.map((item) => item.sourceId === source.sourceId ? { ...item, enabled: !enabled } : item))
    }
    if (onToggleSource !== undefined) {
      if (!(await onToggleSource(source, enabled))) rollback()
      return
    }
    // 尚未迁移的宿主（看板抽屉，S2 收口）：旧路径，写完由宿主自己重读。
    await setSourceEnabled(source, enabled).then(() => onChanged?.()).catch(rollback)
  }

  const providerName = labels.providerNames[provider.providerId] ?? provider.displayName
  const hasProxySource = provider.sources.some((source) => source.requiresProxy)

  return <ErrorBoundary scope="source-detail"><section className="source-provider-detail">
    {/* 分工（2026-11-10 界面设计定）：**横幅只管「配了没通」**，未配代理由行尾那颗「需要代理」
        药丸承担——同一件事不许两处说，未配时代理只需要一个入口。所以这里是 `proxyConfigured`
        **且** `networkFailure`，不再是「未配或失败」。 */}
    {hasProxySource && proxyConfigured && networkFailure ? <NetworkProxyBanner
      tone="failed"
      configured
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
            {/* 一行药丸：只报**状态**。原因、上次成功、能不能立刻采都收进下面那四格——
                同一个事实两处说，迟早一处新一处旧。 */}
            <span className="source-provider-detail__status">
              <SourceHealthPill
                state={source.collection === 'none' ? undefined : source.healthState}
                resolveText={resolveText}
                unavailable={Boolean(unavailable)} />
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
          {/* B4 四格：读不到逐次记录的源（日历 feed）不画成「没有」，写「未知」并说明原因。 */}
          <SourceHealthDetail
            automaticSyncStopped={labels.automaticSyncStopped}
            labels={labels.health}
            onRetry={() => retryDetail(source.sourceId)}
            {...(onRunNow === undefined ? {} : { onRunNow })}
            read={details[source.sourceId] ?? { state: 'loading' }}
            resolveText={resolveText}
            source={source}
            {...(supportsRunNowById?.[source.sourceId] === undefined ? {} : { supportsRunNow: supportsRunNowById[source.sourceId] })}
            timeZone={timeZone}
          />
          {/* 采集策略（频率档 / 范围 / 是否纳入舆情）：每个源常显，读者不必先选中它。
              产品自有采集的源只留启用开关，预设与范围不适用（组件自己写那句说明）。 */}
          {/* 采集策略（频率档 / 范围 / 纳入情绪分析）：每个源一组，**默认收起**。
              壳 `CollapsibleGroup` 已有自定义内容形态，头行档位、箭头、`aria-controls`、缩进都由
              壳提供（另一条线 e20dd88 落地），本页不再自绘折叠头。 */}
          {policy && policy.profiles[source.sourceId]
            ? <CollapsibleGroup
              resolveText={(key) => key === 'settings.intelligenceSources.collectionPolicy.title' ? policy.labels.title : ''}
              titleKey="settings.intelligenceSources.collectionPolicy.title"
              /* 收起态头行只挂一枚**短标**（这组现在不能改）：不搬展开区那句原因，两处不重复。
                 没有它，头行看起来完全正常，读者点开才发现里面全灰，会以为自己点坏了。
                 用的是壳自己的 `meta` 槽（「共 N 条」那一格），不为这一枚标去改共享组件。 */
              {...(unavailable ? { metaText: policy.labels.stoppedBadge } : {})}
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
                  resolveText={resolveText}
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
  </section></ErrorBoundary>
}
