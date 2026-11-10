import { Alert, Button, Input } from 'antd'
import { Eye, EyeOff } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'

import { ErrorBoundary } from '@platform/ui/components/error-boundary'
import { IconButton } from '@platform/ui/components/icon-button'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { setSourceEnabled } from '../../shared/intelligenceSourceToggle'
import { CollectionPolicySection, type CollectionPolicyLabels } from './CollectionPolicySection'
import { SourceEnabledRow, needsJob } from './SourceRows'
import { SourceHealthDetail, type SourceHealthLabels } from './SourceHealthDetail'
import { isCalendarSource, useSourceDetailReads } from './useSourceDetailReads'
import type { SourceRunOutcome } from './intelligenceSourceProfileEditor'
import { TranslationPreferencesSection } from './TranslationPreferencesSection'
import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import { isNetworkConnectionFailure, testSourceConnection } from '../../shared/intelligenceSourceTest'
import { openProxySettings } from '../../shared/navigation/productShellNavigation'
import { NetworkProxyBanner } from '../../shared/NetworkProxyBanner'
import { useProxyConfigured } from '../../shared/useProxyConfigured'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { isAcceptedCredentialSave } from '../../shared/intelligenceCredentialResultPolicy'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'
import { useProductTextKey } from '../../shared/i18n/productTextKey'

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

/** The one rule for the probe button, so a test can hold it without rendering the pane. */
export function offersConnectionTest(provider: { credential: string; sources: ReadonlyArray<{ capabilities?: { testConnection?: boolean } }> }): boolean {
  return provider.credential !== 'api-key' && provider.sources.some((source) => source.capabilities?.testConnection === true)
}

export function ProviderDetail({ labels, provider, onChanged, policy, showSourceDetails, sourceDetailLabels, translation, supportsRunNowById, onRunNow, onToggleSource, onDraftChange, surface }: {
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
  /** 本页有没有未保存的输入（凭据框）：另一处保存时，有草稿就只提示、不覆盖。 */
  onDraftChange?: (dirty: boolean) => void
  /**
   * 这一份渲染在哪个面上（`settings` = 设置页；默认 `panel` = 看板/日历抽屉）。
   *
   * **判定只在本组件内部做一次**（下面那个 `isSettingsSurface`）；调用点只声明自己是哪个面，
   * 不各自传布尔、也不各自决定「要不要走注册表」——同一个事实两处判，迟早两处不一致。
   */
  surface?: 'settings' | 'panel'
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
  /**
   * 派生出的源列表：**以这次收到的 `provider.sources` 为底**，只把刚拨过、还没被服务端确认的
   * 开关值叠上去。以前用 `useState(provider.sources)`，切供应商的那一帧还在渲染上一个供应商的源
   * （旧详情可能已经坏了），崩溃就会在切走之后又把新的一帧炸掉。
   */
  const [optimisticEnabled, setOptimisticEnabled] = useState<Readonly<Record<string, boolean>>>({})
  const sources = provider.sources.map((source) => {
    const pending = optimisticEnabled[source.sourceId]
    // ① 自愈：没有待确认值，或服务端已经等于刚拨的值 → 以服务端为准。
    if (pending === undefined || pending === source.enabled) return source
    return { ...source, enabled: pending }
  })
  useEffect(() => { setOptimisticEnabled({}) }, [provider.providerId])
  /**
   * ② 一旦投影追上待确认值，就把这条乐观值删掉。否则一次成功拨动之后，这个源在整个挂载期
   * 都被本地旧值遮住——设置页拨开 X、另一处关掉 X、这里重读了，行还显示开（C8 的联动失效）。
   */
  useEffect(() => {
    setOptimisticEnabled((current) => {
      const next = { ...current }
      let changed = false
      for (const source of provider.sources) {
        if (next[source.sourceId] !== undefined && next[source.sourceId] === source.enabled) {
          delete next[source.sourceId]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [provider])
  const [credentialDraft, setCredentialDraft] = useState('')
  const [credentialPristine, setCredentialPristine] = useState(true)
  const [rawKey, setRawKey] = useState<string>()
  const [revealed, setRevealed] = useState(false)
  const [revealFailed, setRevealFailed] = useState(false)
  const [credentialStatus, setCredentialStatus] = useState<{ hasCredential: boolean; maskedPreview?: string }>()
  const [credentialFeedback, setCredentialFeedback] = useState<'saved' | 'failed'>()
  const [savingCredential, setSavingCredential] = useState(false)
  const [runningSourceId, setRunningSourceId] = useState<string>()
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionFeedback, setConnectionFeedback] = useState<'succeeded' | 'failed' | 'unsupported'>()
  const resolveText = useProductTextKey()
  /** 唯一一处「这是哪个面」的判定：注册表渲染只发生在设置页那一侧。 */
  const isSettingsSurface = (surface ?? 'panel') === 'settings'
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


  const { details, retryDetail, refreshDetail, refreshStaleById, beginRun } = useSourceDetailReads(provider, showSourceDetails)

  const runAndRefresh = useCallback(async (sourceId: string): Promise<SourceRunOutcome> => {
    // 上一轮留下的「读数还没刷新」在这一轮开始时就该消失：否则它会和「正在运行」同时出声。
    beginRun(sourceId)
    const outcome = await onRunNow!(sourceId)
    await refreshDetail(sourceId)
    return outcome
  }, [beginRun, onRunNow, refreshDetail])



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

  /**
   * 草稿 = 凭据框被改过且非空。只回报「有没有草稿」，内容不外传：
   * 另一处保存时，本页据此决定「静默换新值」还是「提示不覆盖」。
   */
  useEffect(() => {
    onDraftChange?.(!credentialPristine && credentialDraft.trim() !== '')
  }, [credentialDraft, credentialPristine, onDraftChange])
  useEffect(() => () => onDraftChange?.(false), [onDraftChange])

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
    setOptimisticEnabled((current) => ({ ...current, [source.sourceId]: enabled }))
    const rollback = (): void => {
      setOptimisticEnabled((current) => {
        const next = { ...current }
        delete next[source.sourceId]
        return next
      })
    }
    if (onToggleSource !== undefined) {
      if (!(await onToggleSource(source, enabled))) rollback()
      // 成功不立刻删：那次重读还没回来之前删掉会闪回旧值；投影追上后由上面的自愈 effect 清掉。
      return
    }
    // 尚未迁移的宿主（看板抽屉，S2 收口）：旧路径，写完由宿主自己重读（投影追上后同样自愈）。
    await setSourceEnabled(source, enabled).then(() => onChanged?.()).catch(rollback)
  }

  const providerName = labels.providerNames[provider.providerId] ?? provider.displayName
  const hasProxySource = provider.sources.some((source) => source.requiresProxy)

  return <ErrorBoundary key={provider.providerId} scope="source-detail"><section className="source-provider-detail">
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
          isCalendarSource(source) ? labels.badges.calendar : null,
          ...source.panels.map((panel) => labels.panelNames[panel] ?? panel)
        ].filter((tag): tag is string => Boolean(tag))
        /* 启用行：设置页那一面按菜单 1 的声明渲染，看板/日历那一面仍是旧形状——
           两条路径在同一组件里，状态药丸与标签行只有一份。 */
        return <div key={source.sourceId}>
          <SourceEnabledRow
            labels={labels}
            name={name}
            onToggle={(enabled) => void toggle(source, enabled)}
            proxyConfigured={proxyConfigured}
            resolveText={resolveText}
            source={source}
            tags={tags}
            unavailable={Boolean(unavailable)}
          />
          {/* B4 四格：读不到逐次记录的源（日历 feed）不画成「没有」，写「未知」并说明原因。 */}
          <SourceHealthDetail
            automaticSyncStopped={labels.automaticSyncStopped}
            labels={labels.health}
            onRetry={() => retryDetail(source.sourceId)}
            {...(onRunNow === undefined ? {} : { onRunNow: runAndRefresh })}
            read={details[source.sourceId] ?? { state: 'loading' }}
            refreshStale={refreshStaleById[source.sourceId] === true}
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
            ? <section className="intelligence-section source-provider-detail__policy">
              {/* 「采集策略」**常显**，不再收起展开：用户 2026-11-10 要它默认露在外面。
                  标题 13/650（`--font-section` 档），短标与原因句随内容一起常显——拆掉折叠头不等于
                  可以把「暂不可改」「同步已停止…」丢掉。 */}
              <div className="intelligence-section-title">{policy.labels.title}
                {unavailable && policy.labels.stoppedBadge !== undefined
                  ? <span className="source-provider-detail__policy-badge">{policy.labels.stoppedBadge}</span>
                  : null}
              </div>
              {/* 不可用的源不该还能改采集策略：整组停用，并说清为什么、什么时候恢复。
                  这句是**通用结构**——所有不可用源同一句，不针对某一个源。 */}
              {unavailable
                ? <p className="source-provider-detail__policy-stopped" id={policyStoppedId}>{labels.collectionPolicyStopped}</p>
                : null}
              {/* 原因必须能被读屏关联到**这一组控件**：可用时不留组语义、也不留悬空 id。 */}
              <div {...(unavailable ? { 'aria-describedby': policyStoppedId, role: 'group' } : {})}>
                <CollectionPolicySection
                  configurable={source.collection !== 'none' && source.visibility !== 'pending' && !unavailable}
                  sourceId={source.sourceId}
                  draftProfile={policy.profiles[source.sourceId]!}
                  enabledConfigurable={source.visibility !== 'pending' && !unavailable}
                  labels={policy.labels}
                  onChange={(patch) => policy.onChange(source.sourceId, patch)}
                  resolveText={resolveText}
                  supportsSentiment={policy.supportsSentimentById[source.sourceId] === true}
                />
              </div>
            </section>
            : null}
        </div>
      })}
    </div>
    {showSourceDetails ? <div className="source-provider-detail__details">

      {translation ? <TranslationPreferencesSection {...translation} sourceIds={provider.sources.map((source) => source.sourceId)} /> : null}
    </div> : null}
  </section></ErrorBoundary>
}
