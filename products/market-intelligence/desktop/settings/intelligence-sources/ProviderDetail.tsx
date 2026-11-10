import { Alert, Button, Input } from 'antd'
import { Eye, EyeOff } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'

import { CollapsibleGroup } from '@platform/ui/components/collapsible-group'
import { ErrorBoundary } from '@platform/ui/components/error-boundary'
import { IconButton } from '@platform/ui/components/icon-button'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { setSourceEnabled } from '../../shared/intelligenceSourceToggle'
import { CollectionPolicySection, type CollectionPolicyLabels } from './CollectionPolicySection'
import { SourceEnabledRow, needsJob } from './SourceRows'
import { SourceDetailsBlock } from './SourceDetailsBlock'
import type { SourceHealthLabels } from './SourceHealthDetail'
import { useSourceDetailReads } from './useSourceDetailReads'
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

/**
 * 「这一行为什么不能改」的两句话与那颗 ⓘ 的读屏名（都是键，句子由 `resolveText` 解析）。
 * 取不到的源说第一句、还没接入的源说第二句——同一个位置只挂一颗 ⓘ，正文里没有它们的位置。
 */
const NOT_CONFIGURABLE_ARIA_KEY = 'settings.intelligenceSources.collectionPolicy.notConfigurableAria'
const COLLECTION_POLICY_STOPPED_KEY = 'settings.intelligenceSources.collectionPolicyStopped'
const PLANNED_NOT_CONFIGURABLE_KEY = 'settings.intelligenceSources.collectionPolicy.plannedNotConfigurable'

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
  automaticSyncStopped: string
  lastSuccessfulSync: string
  /** B4 四格：今天有没有读数 / 上次成功 / 为什么没在采 / 能不能立刻采。 */
  health: SourceHealthLabels
}

/**
 * The one rule for the probe button, so a test can hold it without rendering the pane.
 *
 * 凭据是不是 API Key 不再影响它：那颗按钮已经移到**源名旁**、全屏只有这一颗
 * （用户 2026-11-10：行内动作跟着源名走），凭据块里只剩「保存并验证连接」。
 */
export function offersConnectionTest(provider: { credential: string; sources: ReadonlyArray<{ capabilities?: { testConnection?: boolean } }> }): boolean {
  return provider.sources.some((source) => source.capabilities?.testConnection === true)
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
    「健康」与「采集策略」两块各自的展开集合：**默认收起**，读者点开才记进来（用户 2026-11-10：
    两块加起来太长）。两块都收起后，右栏那行摘要常显——一眼仍能看到这条源通不通。
    折叠是**视图状态**，不是读者设置：不进 store、不落盘；换了源（provider）回到默认收起。
  */
  const [expandedBlocks, setExpandedBlocks] = useState<ReadonlySet<string>>(() => new Set())
  /** 展开区容器 id 的前缀：`高级` 那颗按钮的 `aria-controls` 要指向一个**始终存在**的节点。 */
  const detailsRegionIdBase = useId()
  const setBlockOpen = useCallback((key: string, open: boolean) => {
    setExpandedBlocks((current) => {
      const next = new Set(current)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])
  useEffect(() => { setExpandedBlocks(new Set()) }, [provider.providerId])
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
    // 缺凭据时不发写请求（后端另有同一条拒绝；这里是界面侧的第一道闸）。
    if (provider.credential === 'api-key' && credentialStatus?.hasCredential === false) return
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
      {/* 源名同一行：名字 + 「官网」+「测试连接」，三样一行、都是小号文字按钮（用户 2026-11-10）。
          它们属于「这是哪个源、它通不通」，不是页头的一排实心大按钮——所以整屏不再有
          「只装按钮的独立行」，provider 级测试连接也只有这一颗。 */}
      <div className="source-provider-detail__title-row">
        <h2>{providerName}</h2>
        {/* 这一屏所有**行内动作**都跟着源名走，不跟着字段标签走：官网 → 测试连接 → 注册 / 获取 Key，
            同一行 inline、间距 8、与名字基线对齐，全是小号文字按钮。
            一行放不下时整组换到名字下方、左缘仍与名字对齐（flex-wrap 就是这个行为）。 */}
        <span className="source-provider-detail__name-actions">
          {provider.website && !hideWebsite
            ? <Button
              autoInsertSpace={false}
              className="source-provider-detail__name-action"
              onClick={() => window.open(provider.website!, '_blank', 'noopener,noreferrer')}
              size="small">{labels.website}</Button>
            : null}
          {offersConnectionTest(provider)
            ? <Button
              autoInsertSpace={false}
              className="source-provider-detail__name-action"
              disabled={testingConnection}
              loading={testingConnection}
              onClick={() => void testConnection()}
              size="small">{labels.testConnection}</Button>
            : null}
          {provider.signupUrl
            ? <Button
              autoInsertSpace={false}
              className="source-provider-detail__name-action"
              onClick={() => window.open(provider.signupUrl!, '_blank', 'noopener,noreferrer')}
              size="small">{labels.signup}</Button>
            : null}
        </span>
      </div>
      {/* 「需要 API Key」那行分组标题删掉了（用户 2026-11-10）：下面那行的标签 `API Key` 自己就说清了，
          再来一个标题只是同一件事说两遍。 */}
      {provider.credential === 'api-key' ? <>
        <div className="source-provider-detail__credential">
          <label>
            {/* 标签行只放字段名：按钮跟着源名走，不跟着字段标签走（用户 2026-11-10）。 */}
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
            {/* 「保存并验证连接」自己就验证；provider 级的「测试连接」只有源名旁那一颗。 */}
            <Button disabled={credentialPristine || !credentialDraft.trim() || savingCredential} loading={savingCredential} onClick={() => void saveCredential()}>{labels.apiKey.save}</Button>
          </label>
          {revealFailed ? <small>{labels.apiKey.revealFailed}</small> : null}
          {credentialFeedback ? <Alert message={credentialFeedback === 'saved' ? labels.apiKey.savedHint : labels.credentials} showIcon type={credentialFeedback === 'saved' ? 'success' : 'error'} /> : null}
        </div>
      </> : null}
      {inviteProvider && provider.signupUrl ? <p className="source-provider-detail__invite">{labels.inviteNote}</p> : null}
      {/* 「官网 / 测试连接」那一排动作整行去掉：两颗都上到源名旁边（同一屏一个动作只有一处）。
          连接反馈仍要留在页头，它是这次点击的结果。 */}
      {connectionFeedback ? <Alert
        message={connectionFeedback === 'succeeded' ? labels.connectionSucceeded : connectionFeedback === 'unsupported' ? labels.connectionUnsupported : labels.connectionFailed}
        showIcon
        type={connectionFeedback === 'succeeded' ? 'success' : connectionFeedback === 'unsupported' ? 'warning' : 'error'}
      /> : null}
    </header>
    <div className="source-provider-detail__list">
      {sources.map((source) => {
        const name = labels.sourceNames[source.sourceId] ?? source.displayName
        const unused = source.panels.length === 0
        const unavailable = source.unavailable
        /* meta 只放**读者要判断的东西**：未接入 / 高级这类可见性，以及后面的运行/代理状态。
           「看板 / 日历 / 舆情」这种**面板用途**不进 meta（用户 2026-11-10：它只说这个源供哪块用，
           读者不需要；面板在哪块出现，看板里自己看得见）。 */
        const tags = [
          unused || source.visibility === 'pending'
            ? labels.badges.pending
            : source.visibility === 'advanced'
              // 「已启用／已停用」不进标签行：开关就在行尾，词说的是开关位置。
              ? labels.badges.advanced
              : null
        ].filter((tag): tag is string => Boolean(tag))
        /* 启用行：设置页那一面按菜单 1 的声明渲染，看板/日历那一面仍是旧形状——
           两条路径在同一组件里，状态药丸与标签行只有一份。 */
        return <div className="source-provider-detail__block" key={source.sourceId}>
          <SourceEnabledRow
            /* 需要 API Key 的源，Key 没配好之前开关灰着（判据在服务层：`hasCredential`）。
               界面只画，不自己造默认值——投影给什么 `enabled` 就画什么。 */
            {...(provider.credential === 'api-key' && credentialStatus?.hasCredential === false
              ? { credentialMissing: true }
              : {})}
            {...(source.enabled
              ? {
                advanced: {
                  controlsId: `${detailsRegionIdBase}-${source.sourceId}`,
                  expanded: expandedBlocks.has(source.sourceId),
                  onToggle: () => setBlockOpen(source.sourceId, !expandedBlocks.has(source.sourceId))
                }
              }
              /* 未启用的源不出现「高级」：没有采集在进行，展开看四行没有意义（用户 2026-11-10）。
                 整颗不渲染——不是禁用、不是灰掉、也不占位。 */
              : {})}
            labels={labels}
            name={name}
            onToggle={(enabled) => void toggle(source, enabled)}
            proxyConfigured={proxyConfigured}
            resolveText={resolveText}
            source={source}
            tags={tags}
            unavailable={Boolean(unavailable)}
          />
          {/* 展开后那张表单（健康四行 + 采集策略两行）：默认收起，靠行尾那颗「高级」开。 */}
          <SourceDetailsBlock
            automaticSyncStopped={labels.automaticSyncStopped}
            collectionPolicy={policy && policy.profiles[source.sourceId]
              ? {
                configurable: source.collection !== 'none' && source.visibility !== 'pending' && !unavailable,
                enabledConfigurable: source.visibility !== 'pending' && !unavailable,
                labels: policy.labels,
                notConfigurable: unavailable
                  ? { ariaLabelKey: NOT_CONFIGURABLE_ARIA_KEY, labelKey: COLLECTION_POLICY_STOPPED_KEY }
                  : source.visibility === 'pending'
                    ? { ariaLabelKey: NOT_CONFIGURABLE_ARIA_KEY, labelKey: PLANNED_NOT_CONFIGURABLE_KEY }
                    : undefined,
                onChange: (patch) => policy.onChange(source.sourceId, patch),
                profile: policy.profiles[source.sourceId]!,
                supportsSentiment: policy.supportsSentimentById[source.sourceId] === true
              }
              : undefined}
            healthLabels={labels.health}
            hidden={!expandedBlocks.has(source.sourceId)}
            id={`${detailsRegionIdBase}-${source.sourceId}`}
            {...(onRunNow === undefined ? {} : { onRunNow: runAndRefresh })}
            onRetry={() => retryDetail(source.sourceId)}
            read={details[source.sourceId] ?? { state: 'loading' }}
            refreshStale={refreshStaleById[source.sourceId] === true}
            resolveText={resolveText}
            source={source}
            {...(supportsRunNowById?.[source.sourceId] === undefined ? {} : { supportsRunNow: supportsRunNowById[source.sourceId] })}
            timeZone={timeZone}
          />
        </div>
      })}
    </div>
    {showSourceDetails ? <div className="source-provider-detail__details">

      {translation ? <TranslationPreferencesSection {...translation} sourceIds={provider.sources.map((source) => source.sourceId)} /> : null}
    </div> : null}
  </section></ErrorBoundary>
}
