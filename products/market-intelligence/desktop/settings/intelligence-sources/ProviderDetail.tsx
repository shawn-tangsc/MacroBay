import { Alert, Button, Input, Switch } from 'antd'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CollapsibleGroup } from '@platform/ui/components/collapsible-group'
import { ErrorBoundary } from '@platform/ui/components/error-boundary'
import { StateView } from '@platform/ui/components/state'
import { IconButton } from '@platform/ui/components/icon-button'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { setSourceEnabled } from '../../shared/intelligenceSourceToggle'
import type { CollectionPolicyLabels } from './collectionPolicyLabels'
import { SettingsInfo } from '../settingsInfo'
import { needsJob } from './SourceRows'
import { ProviderSourceRow } from './ProviderSourceRow'
import type { SourceRunOutcome } from './intelligenceSourceProfileEditor'
import { TranslationPreferencesSection } from './TranslationPreferencesSection'
import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import { isNetworkConnectionFailure, testSourceConnection } from '../../shared/intelligenceSourceTest'
import { openProxySettings } from '../../shared/navigation/productShellNavigation'
import { NetworkProxyBanner } from '../../shared/NetworkProxyBanner'
import { NoticeBanner } from '../../shared/NoticeBanner'
import { useProxyConfigured } from '../../shared/useProxyConfigured'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { isAcceptedCredentialSave } from '../../shared/intelligenceCredentialResultPolicy'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'
import { useProductTextKey } from '../../shared/i18n/productTextKey'

/**
 * 说明横幅的类别 → 文案键（类别来自注册表 `ProviderDefinition.notice`，组件里不出现源名）。
 * 新增一种同类源：注册表标一个值 + 两语文案各一条，不动组件逻辑。
 */
const PROVIDER_NOTICE_KEYS: Readonly<Record<NonNullable<ProviderView['notice']>, string>> = {
  'private-data-source': 'settings.intelligenceSources.providerNotices.privateDataSource'
}

export type ProviderDetailLabels = {
  sourceNames: Record<string, string>
  providerNames: Record<string, string>
  panelNames: Record<string, string>
  badges: { pending: string; advanced: string; calendar: string; proxy: string }
  status: { enabled: string; disabled: string }
  toggleSource: Readonly<{ enable: string; disable: string }>
  /** 页头那颗**整组**启停的可访问名（带来源名）。缺省时退回源开关那套说法。 */
  toggleProvider?: Readonly<{ enable: string; disable: string }>
  credentials: string
  website: string
  signup: string
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
  /**
   * 健康四格已按用户 2026-11-12 删除；字段保留只为宿主契约兼容，界面不再读它。
   */
  health: unknown
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

export function ProviderDetail({ labels, provider, onChanged, policy, showSourceDetails, translation, supportsRunNowById, onRunNow, onToggleSource, onDraftChange, surface, initialSourceId }: {
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
  /** 只作初值：挂载时把这一源所在行带进视野一次（不做受控、不写回状态；找不到就什么都不做）。 */
  initialSourceId?: string
  /**
   * 每个源的采集策略（频率档 / 范围 / 保留）。页面上常显：读者不必先选中某个源。
   * 数据与写入都来自页面的 profile 列表，这里只画。
   */
  policy?: {
    profiles: Readonly<Record<string, IntelligenceSourceProfile>>
    labels: CollectionPolicyLabels
    onChange: (sourceId: string, patch: Partial<IntelligenceSourceProfile>) => void
  }
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
  // 读者已经配好自定义代理时，不再把「需要连接 本地代理」当成他还没做的事（MI-11-R196）。
  const proxyConfigured = useProxyConfigured()
  // 「上次成功同步」是读者可见的日期：走统一格式化（跟读者时区），不自己切 ISO 字符串。
  const timeZone = useShellTimeZone()
  /** Set only by a transport-level refusal, so a rejected key never points at the proxy setting. */
  const [networkFailure, setNetworkFailure] = useState(false)


  // `focus.sourceId` 的落点：只在这块详情挂载时定位一次。找不到该行就什么都不做（不抛错、不改选中）。
  useEffect(() => {
    if (initialSourceId === undefined) return
    const row = document.querySelector<HTMLElement>(`[data-source-row="${initialSourceId}"]`)
    if (row === null) return
    row.scrollIntoView?.({ block: 'nearest' })
    // 唯一的「标记」：一个属性 + 一条 CSS 描边。不隐藏 DOM、不动富行形状。
    row.setAttribute('data-focused', 'true')
    // 看得见 ≠ 到了：把焦点也交给目标行（读屏用户要能听见落点）。行默认不可聚焦，
    // 临时给 `tabIndex=-1`，离开时还原——不把整屏每一行都变成可 Tab 的停靠点。
    const hadTabIndex = row.hasAttribute('tabindex')
    if (!hadTabIndex) row.setAttribute('tabindex', '-1')
    row.focus({ preventScroll: true })
    return () => {
      row.removeAttribute('data-focused')
      if (!hadTabIndex) row.removeAttribute('tabindex')
    }
  }, [initialSourceId])




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
      if (!(await onToggleSource(source, enabled))) {
        rollback()
        // 宿主那条路同样可能因为缺凭据被拒：切回「缺凭据」态，开关灰着并给出同一句提示。
        if (provider.credential === 'api-key') setCredentialStatus({ hasCredential: false })
      }
      // 成功不立刻删：那次重读还没回来之前删掉会闪回旧值；投影追上后由上面的自愈 effect 清掉。
      return
    }
    // 尚未迁移的宿主（看板抽屉，S2 收口）：旧路径，写完由宿主自己重读（投影追上后同样自愈）。
    // 缺凭据时不发写请求（后端另有同一条拒绝；这里是界面侧的第一道闸）。
    if (provider.credential === 'api-key' && credentialStatus?.hasCredential === false) return
    await setSourceEnabled(source, enabled).then(() => onChanged?.()).catch((error: unknown) => {
      rollback()
      /* 后端拒绝（例如还没配钥匙）：**保持关闭**，并把这一行切回「缺凭据」态——
         同一颗 ⓘ 说同一句「先配置 API Key」，不另写一份文案。 */
      if ((error as { reasonCode?: string }).reasonCode === 'credential-required') {
        setCredentialStatus({ hasCredential: false })
      }
    })
  }

  const providerName = labels.providerNames[provider.providerId] ?? provider.displayName
  /**
   * 整组启停**按能力算**（用户 2026-11-11）：只有「已接入」的能力参与——
   * 组里有待接入的项不影响开关能不能用，点击时也不写它们。
   */
  const operableSources = sources.filter((source) => source.visibility !== 'pending')
  /** 可操作的能力全开 = on、全关 = off、**混合按 off**（点击后把这些可操作项全开）。 */
  const providerGroupEnabled = operableSources.length > 0 && operableSources.every((source) => source.enabled)
  const providerCredentialMissing = provider.credential === 'api-key' && credentialStatus?.hasCredential === false
  /* 待接入 > 缺凭据 > 可操作：**整组一个可操作能力都没有**时才锁死并提示「还没接入」。 */
  const providerPending = operableSources.length === 0 && sources.length > 0
  const toggleProvider = async (next: boolean): Promise<void> => {
    if (providerCredentialMissing || providerPending) return
    // 只写**已接入**的能力；待接入的项不写、不会被打开、状态不变。
    for (const source of operableSources) if (source.enabled !== next) await toggle(source, next)
  }
  const hasProxySource = provider.sources.some((source) => source.requiresProxy)

  return <ErrorBoundary key={provider.providerId} scope="source-detail"><section className="source-provider-detail">
    {/* 分工（2026-11-10 界面设计定）：**横幅只管「配了没通」**，未配代理由行尾那颗「需要代理」
        药丸承担——同一件事不许两处说，未配时代理只需要一个入口。所以这里是 `proxyConfigured`
        **且** `networkFailure`，不再是「未配或失败」。 */}
    {/* 说明横幅在页头卡上方、代理横幅之前（界面设计 2026-11-12 签字）：无动作、不可关闭；
        窄窗折行可以，截断不行。类别来自注册表，组件不认识具体源。 */}
    {provider.notice === undefined ? null : <div
      className={`mi-source-notice-banner${hasProxySource && proxyConfigured && networkFailure ? '' : ' mi-source-notice-banner--alone'}`}
      data-source-notice={provider.notice}>
      <NoticeBanner title={resolveText(PROVIDER_NOTICE_KEYS[provider.notice])} />
    </div>}
    {hasProxySource && proxyConfigured && networkFailure ? <NetworkProxyBanner
      tone="failed"
      configured
      onOpenProxySettings={openProxySettings}
    /> : null}
    {/* 卡一 = 页头卡：源名行 + 注册/获取 Key 按钮 + API Key 行**同一张卡**（用户 2026-11-11：
        它们属于同一个「这个来源是什么、怎么连上」的事实，不该拆成三块）。 */}
    <header className="source-provider-detail__header source-provider-detail__card">
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
              className="source-provider-detail__name-action"
              onClick={() => window.open(provider.website!, '_blank', 'noopener,noreferrer')}
              size="small">{labels.website}</Button>
            : null}
          {offersConnectionTest(provider)
            ? <Button
              className="source-provider-detail__name-action"
              disabled={testingConnection}
              loading={testingConnection}
              onClick={() => void testConnection()}
              size="small">{labels.testConnection}</Button>
            : null}
          {provider.signupUrl
            ? <Button
              className="source-provider-detail__name-action"
              onClick={() => window.open(provider.signupUrl!, '_blank', 'noopener,noreferrer')}
              size="small">{labels.signup}</Button>
            : null}
        </span>
        {/* 整组启停：这一行代表一个来源，开关管它下面**全部能力**（用户 2026-11-11，照模型服务供应商那排布）。
            全开 = on、全关 = off、**混合按 off 显示**（点击后全开）——否则读者看不出到底开没开。 */}
        <span className="source-provider-detail__group-toggle">
          {providerPending || providerCredentialMissing
            ? <SettingsInfo
              ariaLabelKey={providerPending
                ? 'settings.intelligenceSources.providerPendingAria'
                : 'settings.intelligenceSources.credentialRequiredToEnableAria'}
              labelKeys={[providerPending
                ? 'settings.intelligenceSources.providerPending'
                : 'settings.intelligenceSources.credentialRequiredToEnable']}
              resolveText={resolveText} />
            : null}
          <Switch
            /* 页头这颗是**源采集开关的唯一编辑入口**（用户 2026-11-12 撤回「关格顺带停源」后回归）：
               它写源自己的 `enabled`（整组写；待接入项不参与，缺凭据时禁用）。
               下面能力行的开关仍然只读——行上显示的是「采集与数据」里有没有用它。 */
            aria-disabled={providerPending || providerCredentialMissing ? true : undefined}
            aria-label={((providerGroupEnabled ? labels.toggleProvider?.disable : labels.toggleProvider?.enable)
              ?? (providerGroupEnabled ? labels.toggleSource.disable : labels.toggleSource.enable)).replace('{name}', providerName)}
            checked={providerGroupEnabled}
            disabled={providerPending || providerCredentialMissing}
            onChange={(next) => void toggleProvider(next)}
            size="small" />
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
      {/* 「官网 / 测试连接」那一排动作整行去掉：两颗都上到源名旁边（同一屏一个动作只有一处）。
          连接反馈仍要留在页头，它是这次点击的结果。 */}
      {connectionFeedback ? <Alert
        message={connectionFeedback === 'succeeded' ? labels.connectionSucceeded : connectionFeedback === 'unsupported' ? labels.connectionUnsupported : labels.connectionFailed}
        showIcon
        type={connectionFeedback === 'succeeded' ? 'success' : connectionFeedback === 'unsupported' ? 'warning' : 'error'}
      /> : null}
    </header>
    {/* 卡二 = 源项列表卡：所有能力行装进**一张卡**，行间只用细分隔线（外层已经有卡了，双层框会显脏）。 */}
    <div className="source-provider-detail__list source-provider-detail__card">
      {/* 空列表：卡二给平台的空态，不留一张空壳卡（用户 2026-11-11）。 */}
      {sources.length === 0
        ? <StateView reasonCode="not-yet" size="md" state="empty" />
        : null}
      {sources.map((source) => <ProviderSourceRow
        /* 组开关（页头最右那颗）是**唯一可编辑入口**：行上只写这个源自己开没开（文字状态，
           不是开关——点不动的开关是假控件）；「某一格用不用它」属于「采集与数据」那面。 */
        credentialMissing={provider.credential === 'api-key' && credentialStatus?.hasCredential === false}
        key={source.sourceId}
        labels={labels}
        proxyConfigured={proxyConfigured}
        resolveText={resolveText}
        source={source}
      />)}
    </div>
    {showSourceDetails ? <div className="source-provider-detail__details">

      {translation ? <TranslationPreferencesSection {...translation} sourceIds={provider.sources.map((source) => source.sourceId)} /> : null}
    </div> : null}
  </section></ErrorBoundary>
}
