import {
  Activity,
  Bot,
  Database,
  Globe2,
  Home,
  KeyRound,
  Languages,
  Moon,
  Palette,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sun
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, ConfigProvider, Input, Segmented, Select } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'

import type { ModelDefinition, ModelProviderInput, ProviderChatEndpoint, ProviderImageEndpoints, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { isProviderDraftConnectionTestable } from '@platform/ai/providers/providerConfigDraft'
import type { LocalizedText } from '@platform/product-manifest'

import type { WorkspaceTabState } from '@platform/workspace/contracts'
import type { AppLanguage, AppSettings, AppSettingsPatch, NetworkSettings, NotificationSettings, ProxyMode, ThemeMode } from '@platform/settings/schema/appSettings'
import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'
import { resolveThemeMode, toThemeAttributes } from '@platform/ui/theme/themeModel'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellTimeZoneLabel, resolveShellTimeZone, resolveSystemTimeZone } from '@platform/ui/time/shellTimeFormat'

import brandMarkUrl from '../assets/brand/mark.svg'
import { platformText } from '../i18n/platformText'
import { productMenuEntries, productSettingsEntries } from '@products/generated/shellRegistry'
import { isBuiltInNavItemId, isBuiltInSettingsPanelId } from './navigation/builtInNavEntries'
import { resolveAvailableSettingsPanelKey, resolveSettingsPanelKeyFromHash } from './navigation/settingsPanelKey'
import { ModelServiceProviderPage } from './model-service/ModelServiceProviderPage'
import { firstProviderIdForRail } from './model-service/ModelServiceProviderRail'
import { InUseModelRetiredBanner } from './model-service/InUseModelRetiredBanner'
import { ModelServiceDefaultModelsSection } from './model-service/ModelServiceDefaultModelsSection'
import { useInUseModelPatrol } from './model-service/useInUseModelPatrol'
import { resolveProviderHost } from './model-service/ModelServiceBrandBlock'
import { sanitizeProxyAddressForDisplay } from './proxyAddressDisplay'
import {
  buildProxyProbeUrl,
  formatProxySelfTestLine,
  type ProxySelfTestResult
} from './proxySelfTestDisplay'
import {
  findProductMenuEntry,
  findProductSettingsEntry,
  groupShellSettingsPanels,
  mergeShellNavItems,
  splitShellSidebarNavItems
} from './navigation/mergeShellNavigation'
import { resolveLocalizedTitle } from './navigation/shellIconRegistry'
import { ProductContributionHost } from './workspace/ProductContributionHost'
import { TimeZonePreference } from './settings/TimeZonePreference'
import { createBuiltInPageAdapters, type BuiltInPageMounts } from './workspace/builtInPageAdapters'
import { createShellWorkspacePageRegistry, type ShellWorkspacePage } from './navigation/workspacePageRegistry'
import { WorkspacePageHost } from './workspace/WorkspacePageHost'
import { createWorkspacePageContentProvider } from './workspace/workspacePageContentProvider'
import { WorkspaceTabStrip, type WorkspaceTabDraftGuard } from './workspace/WorkspaceTabStrip'
import {
  createWorkspaceTabClient,
  readWorkspaceTabsBridge,
  type WorkspaceTabClient
} from './workspace/workspaceClient'
import { applyRootThemeAttributes, WorkspaceWindowRoot } from './workspace/WorkspaceWindowRoot'
import { MainWindowPanelArea } from './workspace/workspaceMainPanelContext'
import { buildWindowAntdTheme } from '@platform/ui/theme/windowAntdTheme'
import {
  createModelServiceSettingsDraftOwner,
  createSettingsDraftOwnerPort,
  SettingsDraftPrompt,
  type SettingsDraftOwner
} from './settings/SettingsWorkspaceAdapter'
import { ProviderConnectionCheckDrawer, type ProviderConnectionCheckResult } from './ProviderConnectionCheckDrawer'
import { ProviderModelSyncDrawer } from './ProviderModelSyncDrawer'
import {
  buildModelSyncPlan,
  clearModelSyncSelection,
  createModelSyncSelection,
  toggleAllModelSyncSelection,
  toggleModelSyncSelection,
  type ProviderModelSyncSelection
} from './model-service/modelSyncPlan'
import { AgentPage } from './agents/AgentPage'
import { AssistantPage } from './assistants/AssistantPage'
import { createConnectionCheckApiKeyOptions, selectDefaultConnectionCheckModelId } from './modelProviderConnectionCheck'
import { formatProviderRuntimeCheckReason, resolveProviderRuntimeCheckReasonCode } from './providerRuntimeCheckReason'
import {
  sanitizeIpcErrorMessage,
  type ModelSyncErrorState
} from './modelServiceSyncError'
import { isProviderModelSyncFailure, type ModelSyncPreviewOutcome } from '@platform/ai/providers/providerModelSync'
import { groupModelsForDisplay } from './modelProviderDisplay'
import { buildModelDefinitionFromDraft, createEmptyModelDraft, createModelDraftFromModel, type ModelDraft } from './modelDrafts'
import { ModelServiceAddProviderDialog, type AddProviderInput } from './model-service/ModelServiceAddProviderDialog'
import { ModelServiceModelDrawer } from './model-service/ModelServiceModelDrawer'
import { resolveProviderDisplayName } from './model-service/providerDisplayName'
import { buildProviderInputFromDraft } from '@platform/ai/providers/providerConfigDraft'
import { resolveProviderChatBase } from '@platform/ai/providers/providerChatEndpoints'
import type { ModelSyncPreview } from '@platform/ai/providers/providerModelSync'
import { PINNED_MODEL_IDS_STORAGE_KEY, parsePinnedModelIds, serializePinnedModelIds, togglePinnedModelId } from './modelPins'
import { NotificationSettingsPane } from './settings/NotificationSettingsPane'
import { AssistantLibrarySettingsPage } from './settings/assistants/AssistantLibrarySettingsPage'
import { StorageCacheSettingsPage } from './settings/storage-cache/StorageCacheSettingsPage'
import { TaskAutomationSettingsPage } from './settings/task-automation/TaskAutomationSettingsPage'
import { WebSearchSettingsPage } from './settings/web-search/WebSearchSettingsPage'
import { VisualIdentityAvatar } from './VisualIdentityAvatar'

type AppInfo = {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  osRelease: string
  theme: string
}

type ProductSummary = {
  id: string
  name: LocalizedText
  version: string
  description?: string
  routeCount: number
  toolCount: number
  skillCount: number
  agentCount: number
  workflowCount: number
}

type ProviderDraft = {
  enabled: boolean
}

type AssistantOpenRequest = {
  assistantId: string
  topicId: string
}

type AppShellNavigateDetail = {
  navKey?: string
  settingsPanelKey?: string
  assistant?: AssistantOpenRequest
}

type PlatformModelText = typeof platformText['zh-CN']['models']

const languageOptions: Array<{ value: AppLanguage; labelKey: 'chinese' | 'english' }> = [
  { value: 'zh-CN', labelKey: 'chinese' },
  { value: 'en-US', labelKey: 'english' }
]

const themeOptions: Array<{ value: ThemeMode; labelKey: 'system' | 'light' | 'dark'; icon: typeof Sun }> = [
  { value: 'system', labelKey: 'system', icon: Palette },
  { value: 'light', labelKey: 'light', icon: Sun },
  { value: 'dark', labelKey: 'dark', icon: Moon }
]

const proxyModeOptions: Array<{ value: ProxyMode; labelKey: 'proxySystem' | 'proxyCustom' | 'proxyNone' }> = [
  { value: 'system', labelKey: 'proxySystem' },
  { value: 'custom', labelKey: 'proxyCustom' },
  { value: 'none', labelKey: 'proxyNone' }
]

const antDesignLocalePolicy = {
  'zh-CN': zhCN,
  'en-US': enUS
} as const

export function resolveAntDesignLocale(language: AppLanguage) {
  return antDesignLocalePolicy[language]
}

function createEmptyProviderDraft(): ProviderDraft {
  return {
    enabled: true
  }
}

/**
 * 主窗**不再**在偏好写入后单飞读取受控上下文（**PLAT-36**：S1 残留清理）。
 *
 * 历史：PLAT-10 时平台没有设置变更广播通道，于是渲染侧在 `settings.update` 成功后单飞调用一次
 * `workspace.getHostContext()`，让 Main 在那次**受控读取里**做偏好漂移对账并用既有 `snapshot` 词汇定向通知
 * 已打开页窗/面板窗。PLAT-32/S1 把对账点改成 Main 的**显式通知**（`app.ts` 的 `settingsUpdate` 成功路径：
 * `panelWorkspaceForDisposal?.notifyPreferencesChanged()`）之后，受控读取**不再带副作用** —— 那次单飞读取
 * 退化成一条无产出的额外 IPC（每次语言/主题切换 +1 条）。
 *
 * 因此这里**只保留设置写入本身**：偏好跟随仍由 Main 的显式通知承担（一次切换恰 1 条、主窗 0 条），
 * 渲染侧不再自建第二个触发点。判据：`workspacePreferenceWriteSideEffect.test.tsx`（行为：切换后
 * `getHostContext` 调用次数不增加）+ `workspace/workspaceWindowPreferenceFollow.test.tsx` 尾部的源码护栏。
 */

/**
 * 入口委托（P1-06b）：角色由 WorkspaceWindowRoot 依据受控 `workspace.getHostContext()` 决定。
 * `role:'main'` 时渲染下面这份既有 shell 内容，行为与此前完全一致（无 workspace 桥的渲染环境同样走主窗兜底）；
 * `role:'panel'` 的独立面板窗口只渲染面板宿主，不加载本 shell。P1-06b 不改变 AppShell 的任何既有行为。
 *
 * P1-06h（N2）：面板窗里 `AppShellContent` 根本不会挂载（它只属于主窗），因此**当前语言必须由本组件自己**
 * 从与 shell 同一来源（`settings.get()`）读取并作为 `fallbackLanguage` 下发；用户切换语言时由 shell 内容回传，
 * 使 error-shell/准备期壳的语言与设置保持同步（此前缺省 en-US ⇒ 真机上错误页恒英文）。
 */
export function AppShell(): React.ReactElement {
  const [appLanguage, setAppLanguage] = useState<AppLanguage>(() => createDefaultAppSettings().language)
  useEffect(() => {
    let cancelled = false
    void window.platform.settings
      .get()
      .then((value) => { if (!cancelled) setAppLanguage((value as AppSettings).language) })
      // 设置桥不可用（例如没有 preload 的渲染环境）时保持默认语言，绝不因为语言读取失败而阻断窗口
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  return (
    <WorkspaceWindowRoot fallbackLanguage={appLanguage}>
      <AppShellContent onLanguageChange={setAppLanguage} />
    </WorkspaceWindowRoot>
  )
}

/** 主窗 shell 内容：语言变化时回传给 AppShell，供面板窗 error-shell/准备期壳兜底使用（P1-06h / N2）。 */
function AppShellContent(props: { onLanguageChange?: (language: AppLanguage) => void } = {}): React.ReactElement {
  const [activeNavKey, setActiveNavKey] = useState('assistants')
  const [settingsPanelKey, setSettingsPanelKey] = useState('models')
  const [settings, setSettings] = useState<AppSettings>(createDefaultAppSettings)
  const [bootDataReady, setBootDataReady] = useState(false)
  const [assistantOpenRequest, setAssistantOpenRequest] = useState<AssistantOpenRequest | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [products, setProducts] = useState<ProductSummary[]>([])
  const [providers, setProviders] = useState<SafeModelProvider[]>([])
  // PLAT-75：在用模型巡检（启动 + 每天一次；只探默认聊天模型与智能体绑定模型，最多 3 个）。
  const inUseRetiredModels = useInUseModelPatrol({
    providers,
    configuredDefaultModelIds: Object.values(settings.modelDefaults).filter((value) => value.trim().length > 0),
    loadAgentModelIds: async () => {
      const state = await window.platform.agents.getState() as {
        agents?: Array<{ model?: string; planModel?: string; smallModel?: string }>
      }
      return (state.agents ?? []).flatMap((agent) =>
        [agent.model, agent.planModel, agent.smallModel].filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    }
  })
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(createEmptyProviderDraft)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [modelDraft, setModelDraft] = useState<ModelDraft>(createEmptyModelDraft)
  const [isAddModelOpen, setIsAddModelOpen] = useState(false)
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [providerSearch, setProviderSearch] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null)
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [preserveProviderDraftForId, setPreserveProviderDraftForId] = useState<string | null>(null)
  const [isConnectionCheckOpen, setIsConnectionCheckOpen] = useState(false)
  const [connectionCheckModelId, setConnectionCheckModelId] = useState('')
  const [connectionCheckApiKeyOptionId, setConnectionCheckApiKeyOptionId] = useState('')
  const [connectionCheckResult, setConnectionCheckResult] = useState<ProviderConnectionCheckResult | null>(null)
  const [isModelSyncOpen, setIsModelSyncOpen] = useState(false)
  const [isSyncingModels, setIsSyncingModels] = useState(false)
  const [isAddProviderOpen, setIsAddProviderOpen] = useState(false)
  const [modelSyncPreview, setModelSyncPreview] = useState<ModelSyncPreview | null>(null)
  const [modelSyncError, setModelSyncError] = useState<ModelSyncErrorState | null>(null)
  const [proxySelfTest, setProxySelfTest] = useState<{ running: boolean; result: ProxySelfTestResult | null }>({
    running: false,
    result: null
  })
  const [modelSyncSelection, setModelSyncSelection] = useState<ProviderModelSyncSelection>(clearModelSyncSelection)
  const [collapsedModelGroups, setCollapsedModelGroups] = useState<Set<string>>(() => new Set())
  const [pinnedModelIds, setPinnedModelIds] = useState<string[]>(() =>
    parsePinnedModelIds(window.localStorage.getItem(PINNED_MODEL_IDS_STORAGE_KEY))
  )
  const autoSyncedProviderSignaturesRef = useRef<Set<string>>(new Set())
  const previousSelectedProviderIdRef = useRef<string | null>(null)

  const t = platformText[settings.language]
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  )
  const providerConnectionTestable = selectedProvider
    ? isProviderDraftConnectionTestable(selectedProvider, { enabled: providerDraft.enabled, apiKey: apiKeyDraft })
    : false
  // PLAT-63 C：归档模型（presetStale）不参与计数 / 列表 / 探测候选，但数据仍保留。
  const connectionCheckModels = useMemo(
    () => selectedProvider?.models.filter((model) => model.presetStale !== true && model.capabilities.chat) ?? [],
    [selectedProvider]
  )
  const connectionCheckApiKeyOptions = useMemo(
    () => (selectedProvider ? createConnectionCheckApiKeyOptions(selectedProvider, apiKeyDraft) : []),
    [apiKeyDraft, selectedProvider]
  )
  const modelGroups = useMemo(
    () => (selectedProvider
      ? groupModelsForDisplay(
          selectedProvider.models.filter((model) => model.presetStale !== true),
          t.models.ungroupedModels,
          pinnedModelIds,
          selectedProvider.id
        )
      : []),
    [pinnedModelIds, selectedProvider, t.models.ungroupedModels]
  )
  const filteredProviders = useMemo(() => {
    const keyword = providerSearch.trim().toLowerCase()
    if (!keyword) return providers

    return providers.filter((provider) => {
      const searchText = `${resolveProviderDisplayName(t.models, provider)} ${provider.name} ${provider.id}`.toLowerCase()
      return searchText.includes(keyword)
    })
  }, [providerSearch, providers, t.models])
  const navItems = useMemo(() => mergeShellNavItems(settings.language, productMenuEntries), [settings.language])
  const sidebarNavLayout = useMemo(() => splitShellSidebarNavItems(navItems), [navItems])
  const settingsNavGroups = useMemo(
    () => groupShellSettingsPanels(settings.language, productSettingsEntries),
    [settings.language]
  )
  const activeLabel = useMemo(
    () => navItems.find((item) => item.key === activeNavKey)?.label ?? t.nav.workspace,
    [activeNavKey, navItems, t]
  )
  /**
   * P2-02 挂载边缘抽取（只组合，不改业务）：内置一级菜单页的正文组合收敛到 `builtInPageAdapters`，
   * 本组件只注入受控输入。Tab 宿主（P2-03）接同一组适配器，因此这里不复制任何页面业务状态。
   */
  const builtInPages = useMemo(() => createBuiltInPageAdapters(), [])
  /**
   * Tab 视图的可见文案/图标**唯一来源**仍是 shell 本地投影（`createShellWorkspacePageRegistry`）：
   * 内置页 loader 在这里只作为「存在性」占位（正文由 `renderPageForTab` 提供），绝不复制页面业务。
   */
  const shellWorkspacePages = useMemo(
    () => createShellWorkspacePageRegistry({
      language: settings.language,
      productMenuEntries,
      builtInPageLoaders: {
        assistants: () => Promise.resolve(null),
        agents: () => Promise.resolve(null),
        settings: () => Promise.resolve(null)
      }
    }).list().map((page: ShellWorkspacePage) => ({
      pageId: page.pageId, menuKey: page.menuKey, label: page.label, icon: page.icon,
      supportsDetached: page.supportsDetached, allowMultipleInstances: page.allowMultipleInstances
    })),
    [settings.language]
  )
  /**
   * P2-02 既有 Settings 草稿 owner 接点：模型服务设置窗的 API Key 表单草稿。
   * **只**绑定既有草稿状态与既有保存回调（`window.platform.modelProviders.upsert`）；
   * ProviderStore、保存 IPC、草稿 state 的所有权一行未改。
   */
  const settingsDraftOwner = useMemo<SettingsDraftOwner>(() => createModelServiceSettingsDraftOwner({
    readDraft: () => ({ provider: selectedProvider, enabled: providerDraft.enabled, apiKey: apiKeyDraft }),
    clearApiKeyDraft: () => setApiKeyDraft(''),
    save: (provider) => window.platform.modelProviders.upsert(provider)
  }), [apiKeyDraft, providerDraft.enabled, selectedProvider])

  /**
   * P2-03：**生产 Tab 宿主接线**（这是移除「单 active 页面销毁」旧路径的挂载点）。
   *
   * 唯一来源是受控 `.tabs.*` 桥：没有桥（例如既有 shell 单测注入的 platform 不含 workspace）时
   * `tabClient` 为 null，本组件保持 P2-02 之前的直接切页行为 —— 绝不在 renderer 复制一份 Tab 权威。
   * 页面正文仍只来自 `builtInPageAdapters` / 产品 loader，Tab 宿主只是容器。
   */
  const tabClientRef = useRef<WorkspaceTabClient | null>(null)
  const [workspaceTabState, setWorkspaceTabState] = useState<WorkspaceTabState | null>(null)

  useEffect(() => {
    const bridge = readWorkspaceTabsBridge()
    if (bridge === null) return
    const client = createWorkspaceTabClient(bridge)
    tabClientRef.current = client
    let cancelled = false
    const adopt = (next: WorkspaceTabState | null): void => {
      if (cancelled || next === null) return
      setWorkspaceTabState(next)
      const active = next.tabs.find((tab) => tab.open && tab.workspaceInstanceKey === next.activeWorkspaceInstanceKey)
      // 顶栏/侧栏高亮跟随权威活动项（menuKey 就是导航键），不在本层维护第二份「当前页」
      if (active !== undefined) setActiveNavKey((previous) => (previous === active.menuKey ? previous : active.menuKey))
    }
    void client.load().then(adopt)
    const stop = client.observe(adopt)
    return () => {
      cancelled = true
      stop()
      client.dispose()
      tabClientRef.current = null
    }
  }, [])

  /** 一级菜单点击：有 Tab 桥即走受控命令（打开/激活同一实例），否则保持既有直接切页（无桥兜底）。 */
  function activateNavKey(navKey: string): void {
    const client = tabClientRef.current
    if (client === null) {
      setActiveNavKey(navKey)
      return
    }
    void client.port.openTab({ menuKey: navKey })
      .then((result) => {
        setWorkspaceTabState(result.snapshot)
      })
      .catch(() => { setActiveNavKey(navKey) })
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.platform.app.getInfo().then((value) => { if (!cancelled) setAppInfo(value) }),
      window.platform.app.getProductSummaries().then((value) => { if (!cancelled) setProducts(value) }),
      window.platform.settings.get().then((value) => { if (!cancelled) setSettings(value as AppSettings) }),
      refreshProviders()
    ]).finally(() => { if (!cancelled) setBootDataReady(true) })
    return () => { cancelled = true }
  }, [])

  // PLAT-82：检测结束会把「本次实测通过」的协议写回模型 ⇒ 重新拉一次供应商列表，
  // 行内协议 chip / 协议 pill 才能立刻反映新证据（状态文案仍在内存，不参与刷新）。
  useEffect(() => {
    const api = window.platform?.modelProviders
    if (!api?.onModelDetectionDone) return undefined
    // `refreshProviders` 只依赖稳定的 setState 与 IPC，挂载时抓一次即可。
    const unsubscribe = api.onModelDetectionDone(() => {
      void refreshProviders()
    })
    return () => { unsubscribe() }
  }, [])

  // P1-06h（N2）：语言是「当前设置」的一部分，切换后必须回传给 AppShell 下发给 error-shell/准备期壳。
  useEffect(() => {
    props.onLanguageChange?.(settings.language)
  }, [props.onLanguageChange, settings.language])

  useEffect(() => {
    const applyNavigation = (detail?: AppShellNavigateDetail): void => {
      // A tab-hosted shell must activate the target tab, not only repaint the sidebar highlight.
      // `activateNavKey` falls back to the old direct page switch when the tab bridge is absent.
      if (detail?.navKey) activateNavKey(detail.navKey)
      if (detail?.settingsPanelKey) {
        setSettingsPanelKey(resolveAvailableSettingsPanelKey(detail.settingsPanelKey, productSettingsEntries))
      }
      if (detail?.assistant) setAssistantOpenRequest(detail.assistant)
    }

    const onNavigate = (event: Event): void => {
      applyNavigation((event as CustomEvent<AppShellNavigateDetail>).detail)
    }

    const hash = window.location.hash.replace(/^#/, '')
    if (hash.startsWith('settings/')) {
      const panelSlug = hash.slice('settings/'.length)
      const panelKey = resolveAvailableSettingsPanelKey(
        resolveSettingsPanelKeyFromHash(panelSlug, productSettingsEntries),
        productSettingsEntries
      )
      applyNavigation({ navKey: 'settings', settingsPanelKey: panelKey })
    }

    window.addEventListener('app-shell:navigate', onNavigate)
    return () => window.removeEventListener('app-shell:navigate', onNavigate)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(PINNED_MODEL_IDS_STORAGE_KEY, serializePinnedModelIds(pinnedModelIds))
  }, [pinnedModelIds])

  // 主题必须在 paint 前写入：loading 期间/其它 effect 抛错都不能让根节点停在 system 初始浅色。
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    // P1-06i（A）：主窗属性组逐字不变（仍由 toThemeAttributes 决定），只是写入动作与面板窗共用同一函数。
    const applyTheme = (): void => {
      try {
        applyRootThemeAttributes(toThemeAttributes(settings.themeMode, settings.accentColor, media.matches))
      } catch {
        // 主题写入失败不能阻断后续渲染；下一次 settings 变化会再次尝试。
      }
    }

    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [settings.accentColor, settings.themeMode])

  useEffect(() => {
    const currentProviderId = selectedProvider?.id ?? null
    const providerChanged = previousSelectedProviderIdRef.current !== currentProviderId
    previousSelectedProviderIdRef.current = currentProviderId

    if (!selectedProvider) {
      setProviderDraft(createEmptyProviderDraft())
      if (providerChanged) {
        setApiKeyDraft('')
        setConnectionStatus(null)
        setConnectionCheckResult(null)
        setIsConnectionCheckOpen(false)
        setConnectionCheckModelId('')
        setConnectionCheckApiKeyOptionId('')
        resetModelSyncState()
      }
      return
    }

    setProviderDraft({
      enabled: selectedProvider.enabled
    })
    if (preserveProviderDraftForId === selectedProvider.id) {
      setPreserveProviderDraftForId(null)
    } else if (providerChanged) {
      setApiKeyDraft('')
      setConnectionStatus(null)
      setConnectionCheckResult(null)
      setIsTestingConnection(false)
      setIsConnectionCheckOpen(false)
      setConnectionCheckModelId('')
      setConnectionCheckApiKeyOptionId('')
      resetModelSyncState()
    }

    if (providerChanged) {
      setModelDraft(createEmptyModelDraft())
      setIsAddModelOpen(false)
      setEditingModelId(null)
      setCollapsedModelGroups(new Set())
    }
  }, [preserveProviderDraftForId, selectedProvider])

  useEffect(() => {
    if (!selectedProvider || !selectedProvider.enabled || !selectedProvider.hasApiKey || selectedProvider.models.length > 0) return
    const signature = `${selectedProvider.id}:${selectedProvider.apiKeyPreview}:${selectedProvider.baseUrl}`
    if (autoSyncedProviderSignaturesRef.current.has(signature)) return
    autoSyncedProviderSignaturesRef.current.add(signature)
    void previewModelSync({ autoApplyWhenOnlyAdded: true, openDrawerWhenDiff: false })
  }, [selectedProvider])

  async function refreshProviders(preferredProviderId?: string): Promise<void> {
    const nextProviders = (await window.platform.modelProviders.list()) as SafeModelProvider[]
    setProviders(nextProviders)
    setSelectedProviderId((current) => {
      if (preferredProviderId && nextProviders.some((provider) => provider.id === preferredProviderId)) return preferredProviderId
      if (current && nextProviders.some((provider) => provider.id === current)) return current
      return firstProviderIdForRail(nextProviders)
    })
  }

  async function updateNetworkSettings(patch: Partial<NetworkSettings>): Promise<void> {
    await updateSettings({
      network: {
        ...settings.network,
        ...patch
      }
    })
  }

  async function updateNotificationSettings(patch: Partial<NotificationSettings>): Promise<void> {
    await updateSettings({
      notifications: {
        ...settings.notifications,
        ...patch
      }
    })
  }

  async function updateSettings(patch: AppSettingsPatch): Promise<void> {
    setNotice(null)
    try {
      const nextSettings = (await window.platform.settings.update(patch)) as AppSettings
      setSettings(nextSettings)
      setNotice(t.status.saved)
    } catch {
      setNotice(t.status.failed)
    }
  }

  async function addProvider(input: AddProviderInput): Promise<void> {
    const id = `provider-${Date.now()}`
    const provider: ModelProviderInput = {
      id,
      name: input.name,
      // 自建供应商没有预设 ⇒ 端点清单由用户填的两个地址组成（Chat 在前 = 默认端点）。
      endpoints: input.endpoints,
      enabled: true,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      models: []
    }
    await window.platform.modelProviders.upsert(provider)
    await refreshProviders(id)
    setIsAddProviderOpen(false)
  }

  /**
   * PLAT-61：改动即存 —— 密钥草稿由「焦点离开密钥行」触发。
   * 仍走既有 Settings 草稿 owner（同一个 buildProviderInputFromDraft + 同一个 upsert 回调），
   * 不新增 IPC。失败向上抛：由页面回滚草稿并给行内错误（不回退整页）。
   */
  async function saveApiKeyDraft(): Promise<void> {
    if (!selectedProvider) return
    await persistSelectedProviderDraft()
    await refreshProviders(selectedProvider.id)
    // 保存成功后清掉输入草稿 ⇒ 控件回到「已保存掩码」，不会把明文 Key 留在界面上。
    setApiKeyDraft('')
    setConnectionStatus(null)
  }

  async function persistSelectedProviderDraft(enabledOverride?: boolean): Promise<void> {
    // P2-02：保存路径收敛到既有 Settings 草稿 owner（同一个 buildProviderInputFromDraft + 同一个
    // upsert 回调），行为与此前逐字一致；owner 让 Tab 关闭/分离时能读到这份已有表单草稿。
    if (enabledOverride === undefined) {
      await settingsDraftOwner.save()
      return
    }
    // PLAT-61：抽屉里「就地启用后自动重跑」需要在同一个渲染周期内带着新 enabled 落盘，
    // 否则刚启用就会被旧闭包里的 providerDraft.enabled=false 又写回去。
    if (!selectedProvider) return
    await window.platform.modelProviders.upsert(
      buildProviderInputFromDraft(selectedProvider, { enabled: enabledOverride, apiKey: apiKeyDraft })
    )
  }

  /**
   * T4/T5：端点清单保存（编辑器里改地址 / 添加 / 删除 / 设为默认都走它）。
   *
   * 传进来的是**整份有序清单**（`[0]` = 默认端点），所以不存在"只改了一个字段、
   * 其余字段被抹掉"的合并问题；`baseUrl` 由端点清单派生，不需要单独回写。
   */
  async function saveProviderEndpoints(endpoints: readonly ProviderChatEndpoint[]): Promise<void> {
    if (!selectedProvider) return
    await window.platform.modelProviders.upsert({
      ...buildProviderInputFromDraft(selectedProvider, { enabled: providerDraft.enabled, apiKey: apiKeyDraft }),
      endpoints: [...endpoints]
    })
    await refreshProviders(selectedProvider.id)
  }

  /** 图像端点（生成 / 编辑）保存：不是聊天协议，单独一份字段。 */
  async function saveProviderImageEndpoint(
    kind: 'generation' | 'edit',
    value: string | undefined
  ): Promise<void> {
    if (!selectedProvider) return
    const next: ProviderImageEndpoints = { ...selectedProvider.imageEndpoints }
    const trimmed = value?.trim() ?? ''
    if (trimmed) next[kind] = trimmed
    else delete next[kind]
    await window.platform.modelProviders.upsert({
      ...buildProviderInputFromDraft(selectedProvider, { enabled: providerDraft.enabled, apiKey: apiKeyDraft }),
      ...(Object.keys(next).length > 0 ? { imageEndpoints: next } : { imageEndpoints: undefined })
    })
    await refreshProviders(selectedProvider.id)
  }

  /** PLAT-61：右上角唯一启用开关（点一下立即保存）；失败回滚由页面负责。 */
  async function setProviderEnabled(enabled: boolean): Promise<void> {
    if (!selectedProvider) return
    await window.platform.modelProviders.setEnabled(selectedProvider.id, enabled)
    await refreshProviders(selectedProvider.id)
  }

  /**
   * PLAT-61 诊断可用性：抽屉顶部「启用」→ 走既有 setEnabled 保存路径 → 就地重跑一次检查。
   * 失败只更新行内状态，不关闭抽屉。
   */
  async function enableProviderAndRecheck(): Promise<void> {
    if (!selectedProvider) return
    try {
      await window.platform.modelProviders.setEnabled(selectedProvider.id, true)
      await refreshProviders(selectedProvider.id)
      setProviderDraft((current) => ({ ...current, enabled: true }))
    } catch (error) {
      setConnectionStatus(sanitizeIpcErrorMessage(error) ?? t.status.failed)
      return
    }
    await startConnectionCheck({ enabledOverride: true })
  }

  function handleApiKeyDraftChange(nextValue: string): void {
    setApiKeyDraft(nextValue)
    setConnectionStatus(null)
    setConnectionCheckResult(null)
  }

  async function removeProviderById(providerId: string): Promise<void> {
    const target = providers.find((provider) => provider.id === providerId)
    if (!target || target.isSystem) return
    const index = providers.findIndex((provider) => provider.id === providerId)
    const adjacent = providers[index + 1] ?? providers[index - 1]
    await window.platform.modelProviders.remove(providerId)
    await refreshProviders(adjacent?.id)
  }

  async function removeSelectedProvider(): Promise<void> {
    if (selectedProvider) await removeProviderById(selectedProvider.id)
  }

  async function setProviderEnabledById(providerId: string, enabled: boolean): Promise<void> {
    await window.platform.modelProviders.setEnabled(providerId, enabled)
    await refreshProviders(providerId)
  }

  function resetModelSyncState(): void {
    setIsModelSyncOpen(false)
    setModelSyncPreview(null)
    setModelSyncError(null)
    setModelSyncSelection(clearModelSyncSelection())
    setIsSyncingModels(false)
  }

  async function previewModelSync(options: { autoApplyWhenOnlyAdded?: boolean; openDrawerWhenDiff?: boolean } = {}): Promise<void> {
    if (!selectedProvider) return
    // PLAT-61：拉取模型清单是只读操作 ⇒ 只要求 baseUrl + Key，停用状态也允许（便于先看免费模型）。
    if (!selectedProvider.baseUrl.trim() || !(selectedProvider.hasApiKey || apiKeyDraft.trim())) {
      setConnectionStatus(t.models.modelSyncNeedsApiKey)
      return
    }

    setIsSyncingModels(true)
    setNotice(null)
    setModelSyncError(null)
    try {
      setPreserveProviderDraftForId(selectedProvider.id)
      await persistSelectedProviderDraft()
      const outcome = (await window.platform.modelProviders.previewModelSync(selectedProvider.id)) as
        | ModelSyncPreview
        | ModelSyncPreviewOutcome
      // PLAT-61：主进程把失败改成结构化结果；原始 IPC Error 不再进入 UI。
      if (isProviderModelSyncFailure(outcome)) {
        setModelSyncError({
          reasonCode: outcome.reasonCode,
          message: outcome.message,
          ...(outcome.upstreamMessage ? { upstreamMessage: outcome.upstreamMessage } : {})
        })
        return
      }
      const preview: ModelSyncPreview = 'ok' in outcome
        ? { added: outcome.added, updated: outcome.updated ?? [], missing: outcome.missing, stale: outcome.stale ?? [] }
        : { ...outcome, stale: outcome.stale ?? [] }
      setModelSyncPreview(preview)
      // 三组默认全选（含「本地多余」）；应用时只有勾选的 id 会真正删除。
      setModelSyncSelection(createModelSyncSelection(preview))

      const hasDiff =
        preview.added.length > 0 ||
        preview.updated.length > 0 ||
        preview.missing.length > 0 ||
        preview.stale.length > 0
      // 静默自动应用只在「纯新增/更新」时发生：任何删除（含本地多余）都必须由用户确认。
      const shouldAutoApply =
        options.autoApplyWhenOnlyAdded &&
        preview.missing.length === 0 &&
        preview.stale.length === 0 &&
        (preview.added.length > 0 || preview.updated.length > 0)
      if (shouldAutoApply) {
        await applyModelSyncPreview(preview, {
          addedIds: new Set(preview.added.map((model) => model.id)),
          missingIds: new Set(),
          staleIds: new Set()
        })
        return
      }

      if (hasDiff || options.openDrawerWhenDiff !== false) {
        setIsModelSyncOpen(true)
      } else {
        setNotice(t.models.modelSyncUpToDate)
      }
    } catch (error) {
      const friendly = sanitizeIpcErrorMessage(error)
      console.warn('[model-providers] preview model sync failed', friendly ?? 'unknown error')
      setModelSyncError({ reasonCode: 'unknown', message: friendly ?? '' })
      if (options.autoApplyWhenOnlyAdded) {
        autoSyncedProviderSignaturesRef.current.delete(`${selectedProvider.id}:${selectedProvider.apiKeyPreview}:${selectedProvider.baseUrl}`)
      }
    } finally {
      setIsSyncingModels(false)
    }
  }

  async function applyModelSyncPreview(
    preview = modelSyncPreview,
    selection = modelSyncSelection,
    options: { closeDrawer?: boolean } = {}
  ): Promise<void> {
    if (!selectedProvider || !preview) return

    setIsSyncingModels(true)
    setModelSyncError(null)
    try {
      const plan = buildModelSyncPlan(preview, selection)
      const outcome = await window.platform.modelProviders.applyModelSync(selectedProvider.id, plan)
      if (isProviderModelSyncFailure(outcome)) {
        setModelSyncError({
          reasonCode: outcome.reasonCode,
          message: outcome.message,
          ...(outcome.upstreamMessage ? { upstreamMessage: outcome.upstreamMessage } : {})
        })
        return
      }
      await refreshProviders(selectedProvider.id)
      const removed = plan.toRemove.length
      setNotice(t.models.modelSyncAppliedSummary(preview.added.length, preview.updated.length, removed))
      if (options.closeDrawer !== false) setIsModelSyncOpen(false)
    } catch (error) {
      const friendly = sanitizeIpcErrorMessage(error)
      console.warn('[model-providers] apply model sync failed', friendly ?? 'unknown error')
      setModelSyncError({ reasonCode: 'unknown', message: friendly ?? '' })
    } finally {
      setIsSyncingModels(false)
    }
  }

  function toggleModelSyncAdded(modelId: string): void {
    setModelSyncSelection((current) => toggleModelSyncSelection(current, 'added', modelId))
  }

  function toggleModelSyncMissing(modelId: string): void {
    setModelSyncSelection((current) => toggleModelSyncSelection(current, 'missing', modelId))
  }

  /** PLAT-63 C：本地多余（预设已变更）——默认勾选，取消即保留。 */
  function toggleModelSyncStale(modelId: string): void {
    setModelSyncSelection((current) => toggleModelSyncSelection(current, 'stale', modelId))
  }

  function toggleAllModelSyncAdded(): void {
    if (!modelSyncPreview) return
    setModelSyncSelection((current) => toggleAllModelSyncSelection(current, 'added', modelSyncPreview))
  }

  function toggleAllModelSyncMissing(): void {
    if (!modelSyncPreview) return
    setModelSyncSelection((current) => toggleAllModelSyncSelection(current, 'missing', modelSyncPreview))
  }

  function toggleAllModelSyncStale(): void {
    if (!modelSyncPreview) return
    setModelSyncSelection((current) => toggleAllModelSyncSelection(current, 'stale', modelSyncPreview))
  }

  function resolveProxyDisplayLabel(): string {
    if (settings.network.proxyMode === 'custom') {
      return sanitizeProxyAddressForDisplay(settings.network.proxyUrl) ?? t.preferences.proxyCustom
    }
    return settings.network.proxyMode === 'system' ? t.preferences.proxySystem : t.preferences.proxyNone
  }

  /**
   * PLAT-61 代理自检：通过既有 testConnection 通道的 additive 参数 `proxyProbeUrl`，
   * 主进程用 Electron `net.fetch`（当前 session 代理）发**无鉴权 GET**；只显示归类与耗时。
   */
  async function runProxySelfTest(): Promise<void> {
    const target = buildProxyProbeUrl(selectedProvider?.baseUrl)
    setProxySelfTest({ running: true, result: null })
    try {
      const result = (await window.platform.modelProviders.testConnection('', {
        proxyProbeUrl: target
      })) as ProxySelfTestResult
      setProxySelfTest({
        running: false,
        result: {
          ok: result?.ok === true,
          status: typeof result?.status === 'number' ? result.status : null,
          durationMs: typeof result?.durationMs === 'number' ? result.durationMs : 0,
          reasonCode: typeof result?.reasonCode === 'string' ? result.reasonCode : null,
          targetHost: typeof result?.targetHost === 'string' ? result.targetHost : resolveProviderHost(target)
        }
      })
    } catch {
      setProxySelfTest({
        running: false,
        result: { ok: false, status: null, durationMs: 0, reasonCode: 'unknown', targetHost: resolveProviderHost(target) }
      })
    }
  }

  /** PLAT-61：网关未启用时可在抽屉里就地开启（复用既有 agents.setModelGatewayEnabled），成功后重跑一次。 */
  async function enableModelGatewayAndRecheck(): Promise<void> {
    try {
      await window.platform.agents.setModelGatewayEnabled(true)
    } catch (error) {
      setConnectionStatus(sanitizeIpcErrorMessage(error) ?? t.status.failed)
      return
    }
    await startConnectionCheck()
  }

  /** PLAT-61：抽屉里的「去设置代理」只跳转到「基础设置」的代理段，不就地改设置。 */
  function openProxySettings(): void {
    setIsConnectionCheckOpen(false)
    setActiveNavKey('settings')
    setSettingsPanelKey('preferences')
  }

  function openConnectionCheck(): void {
    if (!selectedProvider) return
    if (!providerConnectionTestable) {
      setConnectionStatus(t.models.connectionNeedsConfig)
      return
    }

    const defaultModelId = selectDefaultConnectionCheckModelId(selectedProvider)
    if (!defaultModelId) {
      setConnectionStatus(t.models.noChatModelForConnectionCheck)
      return
    }

    const apiKeyOptions = createConnectionCheckApiKeyOptions(selectedProvider, apiKeyDraft)
    if (apiKeyOptions.length === 0) {
      setConnectionStatus(t.models.connectionNeedsConfig)
      return
    }

    setConnectionCheckModelId(defaultModelId)
    setConnectionCheckApiKeyOptionId(apiKeyOptions[0].id)
    setConnectionCheckResult(null)
    setConnectionStatus(null)
    setIsConnectionCheckOpen(true)
  }

  async function startConnectionCheck(options: { enabledOverride?: boolean } = {}): Promise<void> {
    if (!selectedProvider) return
    const selectedModel = connectionCheckModels.find((model) => model.id === connectionCheckModelId) ?? connectionCheckModels[0]
    const selectedApiKeyOption =
      connectionCheckApiKeyOptions.find((option) => option.id === connectionCheckApiKeyOptionId) ?? connectionCheckApiKeyOptions[0]

    if (!selectedModel) {
      setConnectionCheckResult({ ok: false, message: t.models.noChatModelForConnectionCheck })
      return
    }

    if (!selectedApiKeyOption) {
      setConnectionCheckResult({ ok: false, message: t.models.connectionNeedsConfig })
      return
    }

    setIsTestingConnection(true)
    setConnectionStatus(null)
    setConnectionCheckResult(null)
    try {
      setPreserveProviderDraftForId(selectedProvider.id)
      await persistSelectedProviderDraft(options.enabledOverride)
      await refreshProviders(selectedProvider.id)
      const report = (await window.platform.modelProviders.runRuntimeChecks(selectedProvider.id, {
        modelId: selectedModel.id,
        apiKey: selectedApiKeyOption.apiKey,
        runtimeId: 'claude-code',
        checkGateway: true
      })) as import('@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes').ProviderRuntimeCheckReport
      const overallOk = report.finalCompatibility.selectable
      // PLAT-61：最终结论文案同样「把原因说出来」（例如供应商停用），不再只回英文 summary。
      const finalReason = formatProviderRuntimeCheckReason(
        resolveProviderRuntimeCheckReasonCode({
          status: report.finalCompatibility.status,
          summary: report.finalCompatibility.summary,
          providerEnabled: options.enabledOverride === true || providerDraft.enabled,
          hasApiKey: connectionCheckApiKeyOptions.length > 0
        }),
        t.models
      )
      const chatOk = report.ordinaryChat.status === 'ready'
      const message = overallOk
        ? t.models.connectionCheckAgentReady
        : chatOk
          ? t.models.connectionCheckAgentMixed
          : finalReason || report.finalCompatibility.summary || t.models.connectionCheckAgentNotReady
      setConnectionCheckResult({ ok: overallOk, message, report })
      setConnectionStatus(chatOk && overallOk ? null : message)
    } catch (error) {
      const message = sanitizeIpcErrorMessage(error) ?? t.status.failed
      setConnectionCheckResult({ ok: false, message })
      setConnectionStatus(message)
    } finally {
      setIsTestingConnection(false)
    }
  }

  async function saveModel(): Promise<void> {
    if (!selectedProvider) return

    const model = buildModelDefinitionFromDraft(modelDraft)
    model.capabilities.capabilitiesEdited = true

    await window.platform.modelProviders.addOrUpdateModel(selectedProvider.id, model)
    setModelDraft(createEmptyModelDraft())
    setIsAddModelOpen(false)
    setEditingModelId(null)
    await refreshProviders(selectedProvider.id)
  }

  function openAddModelDrawer(): void {
    setEditingModelId(null)
    setModelDraft(createEmptyModelDraft())
    setIsAddModelOpen(true)
  }

  function openEditModelDrawer(model: ModelDefinition): void {
    setEditingModelId(model.id)
    setModelDraft(createModelDraftFromModel(model))
    setIsAddModelOpen(true)
  }

  function closeModelDrawer(): void {
    setIsAddModelOpen(false)
    setEditingModelId(null)
    setModelDraft(createEmptyModelDraft())
  }

  async function removeModel(modelId: string): Promise<void> {
    if (!selectedProvider) return
    await window.platform.modelProviders.removeModel(selectedProvider.id, modelId)
    await refreshProviders(selectedProvider.id)
    setNotice(t.models.modelRemovedNotice(1))
  }

  /**
   * PLAT-72：一键清空该供应商的全部模型。
   * 复用 `applyModelSync` 的 `toRemove`（不新增 IPC）：主进程按**一次** store mutation 落库，
   * 预设来源的模型由既有逻辑写墓碑 ⇒ 下次合并不会复活；失败整体不写入。
   */
  async function clearAllProviderModels(): Promise<void> {
    if (!selectedProvider) return
    const modelIds = selectedProvider.models.map((model) => model.id)
    if (modelIds.length === 0) return
    const outcome = await window.platform.modelProviders.applyModelSync(selectedProvider.id, {
      toAdd: [],
      toUpdate: [],
      toRemove: modelIds
    })
    if (isProviderModelSyncFailure(outcome)) throw new Error(outcome.reasonCode)
    await refreshProviders(selectedProvider.id)
  }

  function toggleModelPinned(modelId: string): void {
    setPinnedModelIds((current) => togglePinnedModelId(current, modelId))
  }

  function toggleModelGroup(groupName: string): void {
    setCollapsedModelGroups((current) => {
      const next = new Set(current)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  /**
   * 主窗的 antd 主题：**唯一来源**与分离窗共用（PLAT-39 ②：分离窗此前没有 ConfigProvider ⇒ 同一组件
   * 在分离窗退化成 antd 默认浅色 token）。PLAT-42：token 值已上移到 `platform/ui/theme` 单源
   * （`buildWindowAntdTheme`），本函数只负责把**当前外观**解析成单源需要的两个参数。
   */
  function getAntdTheme() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    return buildWindowAntdTheme(resolveThemeMode(settings.themeMode, prefersDark), 'lime')
  }

  function openProviderUrl(url?: string): void {
    if (!url) return
    void window.platform.app.openExternal(url)
  }

  function renderSettings(): React.ReactElement {
    const productSettingsEntry = findProductSettingsEntry(settingsPanelKey, productSettingsEntries)

    return (
      <div className="settings-layout">
        <aside className="settings-nav" aria-label={t.nav.settings}>
          {settingsNavGroups.map((group) => (
            <section key={group.id} className="settings-nav-group" aria-label={group.title ?? undefined}>
              {group.title ? <div className="settings-nav-group-title">{group.title}</div> : null}
              {group.panels.map((panel) => {
                const Icon = panel.icon
                return (
                  <button
                    key={panel.key}
                    type="button"
                    className={settingsPanelKey === panel.key ? 'settings-nav-item active' : 'settings-nav-item'}
                    onClick={() => setSettingsPanelKey(panel.key)}>
                    <Icon size={17} />
                    <span>{panel.label}</span>
                  </button>
                )
              })}
            </section>
          ))}
        </aside>

        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'models' ? (
          <div className="model-service-with-defaults" data-model-service-with-defaults>
            <ModelServiceDefaultModelsSection
              labels={t.models}
              providers={providers}
              values={settings.modelDefaults}
              onChange={(field, value) => {
                void updateSettings({ modelDefaults: { ...settings.modelDefaults, [field]: value } })
              }}
            />
            {renderModelService()}
          </div>
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'assistant-library' ? (
          <AssistantLibrarySettingsPage language={settings.language} onManageAssistants={() => setActiveNavKey('assistants')} />
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'web-search' ? (
          <WebSearchSettingsPage language={settings.language} />
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'storage-cache' ? (
          <StorageCacheSettingsPage language={settings.language} />
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'task-automation' ? (
          <TaskAutomationSettingsPage language={settings.language} />
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'preferences' ? renderPreferences() : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'notifications' ? renderNotifications() : null}
        {productSettingsEntry ? (
          <ProductContributionHost
            language={settings.language}
            load={productSettingsEntry.load}
            title={resolveLocalizedTitle(productSettingsEntry.title, settings.language)}
          />
        ) : null}
      </div>
    )
  }

  /**
   * PLAT-61：模型服务 → 供应商配置。正文全部抽取到 `model-service/`，
   * 本函数**只保留接线**：状态来自本组件，写入仍是既有 IPC 包装，抽屉/宿主仍在这里挂载。
   */
  function renderModelService(): React.ReactElement {
    return (
      <ModelServiceProviderPage
        labels={t.models}
        language={settings.language}
        statusText={{ saved: t.status.saved, failed: t.status.failed }}
        providers={providers}
        filteredProviders={filteredProviders}
        selectedProvider={selectedProvider}
        selectedProviderId={selectedProviderId}
        providerSearch={providerSearch}
        enabled={providerDraft.enabled}
        apiKeyDraft={apiKeyDraft}
        modelGroups={modelGroups}
        collapsedGroups={collapsedModelGroups}
        connectionStatus={connectionStatus}
        isSyncingModels={isSyncingModels}
        notice={notice}
        syncError={modelSyncError}
        onProviderSearchChange={setProviderSearch}
        onSelectProvider={setSelectedProviderId}
        onAddProvider={() => setIsAddProviderOpen(true)}
        onApiKeyDraftChange={handleApiKeyDraftChange}
        onToggleGroup={toggleModelGroup}
        actions={{
          saveApiKeyDraft,
          clearApiKeyDraft: () => setApiKeyDraft(''),
          setProviderEnabled,
          saveEndpoints: saveProviderEndpoints,
          saveImageEndpoint: saveProviderImageEndpoint,
          removeModel,
          clearAllModels: clearAllProviderModels,
          removeProvider: removeSelectedProvider,
          removeProviderById,
          setProviderEnabledById,

          previewModelSync: () => void previewModelSync(),
          openAddModel: openAddModelDrawer,
          openEditModel: openEditModelDrawer,
          openConnectionCheck,
          openExternal: openProviderUrl,
          revealApiKey: (providerId) => window.platform.modelProviders.revealApiKey(providerId)
        }}
        overlays={(
          <>
            <ProviderConnectionCheckDrawer
          providerName={selectedProvider ? resolveProviderDisplayName(t.models, selectedProvider) : ''}
              open={isConnectionCheckOpen}
              models={connectionCheckModels}
              apiKeyOptions={connectionCheckApiKeyOptions}
              selectedModelId={connectionCheckModelId}
              selectedApiKeyOptionId={connectionCheckApiKeyOptionId}
              isSubmitting={isTestingConnection}
              result={connectionCheckResult}
              providerEnabled={providerDraft.enabled}
              hasApiKey={connectionCheckApiKeyOptions.length > 0}
              environment={{
                proxyMode: settings.network.proxyMode,
                proxyUrl: settings.network.proxyUrl,
                targetHost: selectedProvider ? resolveProviderHost(selectedProvider.baseUrl) : ''
              }}
              onEnableProvider={() => void enableProviderAndRecheck()}
              onOpenProxySettings={openProxySettings}
              onEnableModelGateway={() => void enableModelGatewayAndRecheck()}
              labels={{
                title: t.models.connectionCheckTitle,
                model: t.models.connectionCheckModel,
                apiKey: t.models.connectionCheckApiKey,
                cancel: t.models.cancel,
                start: t.models.connectionCheckStart,
                providerStatus: t.models.connectionCheckProviderStatus,
                statusEnabled: t.models.connectionCheckStatusEnabled,
                statusDisabled: t.models.connectionCheckStatusDisabled,
                enableProvider: t.models.connectionCheckEnableProvider,
                detailPrefix: t.models.connectionCheckDetailPrefix,
                environment: t.models.connectionCheckEnvironment,
                proxy: t.models.connectionCheckProxy,
                proxyDirect: t.models.connectionCheckProxyDirect,
                proxySystem: t.models.connectionCheckProxySystem,
                proxyCustom: t.models.connectionCheckProxyCustom,
                targetHost: t.models.connectionCheckTargetHost,
                networkDiagnosis: t.models.connectionCheckNetworkDiagnosis,
                networkDiagnosisNone: t.models.connectionCheckNetworkDiagnosisNone,
                proxyNote: t.models.connectionCheckProxyNote,
                networkFailureHint: t.models.connectionCheckNetworkFailureHint,
                customProxyFailureHint: t.models.connectionCheckCustomProxyFailureHint,
                openProxySettings: t.models.connectionCheckOpenProxySettings,
                gatewayDisabledHint: t.models.connectionCheckGatewayDisabledHint,
                enableModelGateway: t.models.connectionCheckEnableModelGateway,
                retry: t.models.retry,
                runtimeLanes: {
                  ordinaryChat: t.models.connectionCheckOrdinaryChat,
                  direct: t.models.connectionCheckDirect,
                  gateway: t.models.connectionCheckGateway,
                  final: t.models.connectionCheckFinal,
                  ready: t.models.connectionCheckAgentReady,
                  notReady: t.models.connectionCheckAgentNotReady,
                  checking: t.models.connectionCheckStart,
                  mixed: t.models.connectionCheckAgentMixed,
                  reasons: t.models,
                  detailPrefix: t.models.connectionCheckDetailPrefix,
                  irrelevantHint: t.models.connectionCheckIrrelevantHint,
                  gatewayDisabledHint: t.models.connectionCheckGatewayDisabledHint
                },
                noModels: t.models.noChatModelForConnectionCheck,
                noApiKeys: t.models.connectionNeedsConfig
              }}
              onClose={() => setIsConnectionCheckOpen(false)}
              onModelChange={(modelId) => {
                setConnectionCheckModelId(modelId)
                setConnectionCheckResult(null)
              }}
              onApiKeyOptionChange={(optionId) => {
                setConnectionCheckApiKeyOptionId(optionId)
                setConnectionCheckResult(null)
              }}
              onStart={() => void startConnectionCheck()}
            />

            <ProviderModelSyncDrawer
              open={isModelSyncOpen}
              preview={modelSyncPreview}
              selection={modelSyncSelection}
              isApplying={isSyncingModels}
              labels={{
                title: t.models.modelSyncTitle,
                added: t.models.modelSyncAdded,
                missing: t.models.modelSyncMissing,
                localSurplus: t.models.modelSyncLocalSurplus,
                localSurplusHint: t.models.modelSyncLocalSurplusHint,
                upToDate: t.models.modelSyncUpToDate,
                upToDateHint: t.models.modelSyncUpToDateHint,
                removedHint: t.models.modelSyncRemovedHint,
                selectAll: t.models.selectAll,
                deselectAll: t.models.deselectAll,
                cancel: t.models.cancel,
                apply: t.models.modelSyncApply,
                addSummary: (selected, total) => t.models.modelSyncAddSummary.replace('{selected}', String(selected)).replace('{total}', String(total)),
                removeSummary: (selected, total) =>
                  t.models.modelSyncRemoveSummary.replace('{selected}', String(selected)).replace('{total}', String(total))
              }}
              onClose={() => setIsModelSyncOpen(false)}
              onApply={() => void applyModelSyncPreview()}
              onToggleAdded={toggleModelSyncAdded}
              onToggleMissing={toggleModelSyncMissing}
              onToggleStale={toggleModelSyncStale}
              onToggleAllAdded={toggleAllModelSyncAdded}
              onToggleAllMissing={toggleAllModelSyncMissing}
              onToggleAllStale={toggleAllModelSyncStale}
            />

            <ModelServiceAddProviderDialog
              open={isAddProviderOpen}
              labels={t.models}
              providers={providers}
              onCancel={() => setIsAddProviderOpen(false)}
              onAdd={addProvider}
            />

            <ModelServiceModelDrawer
              open={isAddModelOpen}
              labels={t.models}
              draft={modelDraft}
              isEditing={editingModelId !== null}
              isSaving={false}
              chatProtocolAvailability={{
                responses: Boolean(selectedProvider && resolveProviderChatBase(selectedProvider, 'responses')),
                gemini: Boolean(selectedProvider && resolveProviderChatBase(selectedProvider, 'gemini')),
                messages: Boolean(selectedProvider && resolveProviderChatBase(selectedProvider, 'messages'))
              }}
              pinned={
                editingModelId !== null &&
                selectedProvider !== null &&
                pinnedModelIds.includes(`${selectedProvider.id}:${editingModelId}`)
              }
              onChange={setModelDraft}
              onTogglePin={() => {
                if (editingModelId !== null && selectedProvider !== null) {
                  toggleModelPinned(`${selectedProvider.id}:${editingModelId}`)
                }
              }}
              onSave={() => void saveModel()}
              onClose={closeModelDrawer}
            />
          </>
        )}
      />
    )
  }

  function renderPreferences(): React.ReactElement {
    return (
      <section className="settings-detail-pane preferences-pane">
        <div className="section-heading">
          <span>{t.settings.basicSettings}</span>
          {notice ? <small>{notice}</small> : null}
        </div>

        <div className="preference-section">
          <div className="preference-heading">
            <Languages size={18} />
            <span>{t.preferences.language}</span>
          </div>
          <Segmented<AppLanguage>
            className="settings-segmented"
            value={settings.language}
            options={languageOptions.map((option) => ({
              value: option.value,
              label: t.preferences[option.labelKey]
            }))}
            onChange={(value) => void updateSettings({ language: value })}
          />
        </div>

        <TimeZonePreference
          language={settings.language}
          value={settings.timeZone}
          onChange={(value) => void updateSettings({ timeZone: value })}
        />

        <div className="preference-section">
          <div className="preference-heading">
            <Palette size={18} />
            <span>{t.preferences.displayStyle}</span>
          </div>
          <Segmented<ThemeMode>
            className="settings-segmented"
            value={settings.themeMode}
            options={themeOptions.map((option) => {
              const Icon = option.icon
              return {
                value: option.value,
                label: (
                  <span className="segmented-icon-label">
                    <Icon size={15} />
                    <span>{t.preferences[option.labelKey]}</span>
                  </span>
                )
              }
            })}
            onChange={(value) => void updateSettings({ themeMode: value })}
          />
        </div>

        <div className="preference-section">
          <div className="preference-heading">
            <Globe2 size={18} />
            <span>{t.preferences.proxyMode}</span>
          </div>
          <Select<ProxyMode>
            className="preference-select"
            value={settings.network.proxyMode}
            options={proxyModeOptions.map((option) => ({
              value: option.value,
              label: t.preferences[option.labelKey]
            }))}
            onChange={(value) => void updateNetworkSettings({ proxyMode: value })}
          />
          <p className="preference-hint" data-preferences-proxy-hint>{t.preferences.proxyRequestHint}</p>
          <div className="preference-proxy-probe">
            <Button
              className="ant-secondary-button"
              size="small"
              loading={proxySelfTest.running}
              disabled={proxySelfTest.running}
              data-proxy-self-test
              onClick={() => void runProxySelfTest()}>
              {proxySelfTest.running ? t.preferences.proxySelfTestRunning : t.preferences.proxySelfTest}
            </Button>
            {proxySelfTest.result !== null ? (
              <p
                className={proxySelfTest.result.ok ? 'preference-proxy-probe-result ok' : 'preference-proxy-probe-result failed'}
                data-proxy-self-test-result>
                {formatProxySelfTestLine(proxySelfTest.result, resolveProxyDisplayLabel(), t.preferences)}
              </p>
            ) : null}
          </div>
          {settings.network.proxyMode === 'custom' ? (
            <div className="preference-fields">
              <label className="preference-field">
                <span>{t.preferences.proxyAddress}</span>
                <Input
                  value={settings.network.proxyUrl}
                  placeholder={t.preferences.proxyAddressPlaceholder}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      network: { ...current.network, proxyUrl: event.target.value }
                    }))
                  }
                  onBlur={(event) => void updateNetworkSettings({ proxyUrl: event.target.value.trim() })}
                />
              </label>
              <label className="preference-field">
                <span>{t.preferences.proxyBypassRules}</span>
                <Input
                  value={settings.network.proxyBypassRules}
                  placeholder={t.preferences.proxyBypassPlaceholder}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      network: { ...current.network, proxyBypassRules: event.target.value }
                    }))
                  }
                  onBlur={(event) =>
                    void updateNetworkSettings({ proxyBypassRules: event.target.value.trim() })
                  }
                />
              </label>
            </div>
          ) : null}
        </div>

      </section>
    )
  }

  function renderNotifications(): React.ReactElement {
    return (
      <NotificationSettingsPane
        title={t.settings.notifications}
        notice={notice}
        settings={settings.notifications}
        labels={t.notifications}
        onChange={(patch) => void updateNotificationSettings(patch)}
      />
    )
  }

  function renderWorkspace(): React.ReactElement {
    return (
      <section className="content">
        <div className="hero-panel">
          <div>
            <p className="eyebrow">{t.workspace.eyebrow}</p>
            <h1>{t.workspace.title}</h1>
            <p className="hero-copy">{t.workspace.copy}</p>
          </div>
          <div className="runtime-badge">
            <Activity size={18} />
            <span>{appInfo ? `${appInfo.platform} / Electron ${appInfo.electron}` : t.status.loading}</span>
          </div>
        </div>

        <div className="work-grid">
          <section className="primary-surface">
            <div className="section-heading">
              <span>{t.workspace.loadedProducts}</span>
              <small>{t.workspace.manifestDriven}</small>
            </div>
            <div className="product-list">
              {products.map((product) => (
                <article key={product.id} className="product-row">
                  <div>
                    <strong>{resolveLocalizedTitle(product.name, settings.language)}</strong>
                    <span>{product.description}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>{t.workspace.tools}</dt>
                      <dd>{product.toolCount}</dd>
                    </div>
                    <div>
                      <dt>{t.workspace.skills}</dt>
                      <dd>{product.skillCount}</dd>
                    </div>
                    <div>
                      <dt>{t.workspace.agents}</dt>
                      <dd>{product.agentCount}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <aside className="inspector">
            <div className="section-heading">
              <span>{t.workspace.runtime}</span>
              <small>{t.workspace.preloadApi}</small>
            </div>
            <ul className="runtime-list">
              <li>
                <span>{t.workspace.app}</span>
                <strong>{appInfo?.name ?? '...'}</strong>
              </li>
              <li>
                <span>{t.workspace.theme}</span>
                <strong>{appInfo?.theme ?? '...'}</strong>
              </li>
              <li>
                <span>{t.workspace.node}</span>
                <strong>{appInfo?.node ?? '...'}</strong>
              </li>
              <li>
                <span>{t.workspace.chrome}</span>
                <strong>{appInfo?.chrome ?? '...'}</strong>
              </li>
            </ul>
          </aside>
        </div>
      </section>
    )
  }

  /**
   * 页面正文的**唯一**挂载边缘：内置页派发收敛到 `builtInPageAdapters`，产品页走产品 loader，
   * 正文状态所有权仍在本组件。
   *
   * P2-03 起它有两种驱动方式，且**没有**第二条布局权威：
   *  - 有受控 Tab 桥（生产）⇒ `WorkspaceTabStrip` + `WorkspacePageHost` 驱动本函数逐 Tab 渲染
   *    （非活动 Tab 就地隐藏、不卸载，草稿因此不丢）；
   *  - 无 Tab 桥（既有 shell 单测注入的 platform 不含 workspace）⇒ 由 `activeNavKey` 直接渲染当前页。
   * 旧「直接切页 + 单 active 页面销毁」路径已随 `.tabs.*` 接通整体移除。
   */
  function renderActivePage(): React.ReactElement {
    if (isBuiltInNavItemId(activeNavKey)) {
      return (
        <>
          {builtInPages.render(activeNavKey, {
            assistants: () => (
              <AssistantPage
                language={settings.language}
                providers={providers}
                chatSettings={settings.chat}
                pinnedModelIds={pinnedModelIds}
                defaultAssistantModelId={settings.modelDefaults.assistantModelId}
                openRequest={assistantOpenRequest}
              />
            ),
            agents: () => (
              <AgentPage
                language={settings.language}
                agentSettings={settings.agent}
                chatSettings={settings.chat}
                providers={providers}
                pinnedModelIds={pinnedModelIds}
                defaultAgentModelId={settings.modelDefaults.agentModelId}
                loadingModelService={!bootDataReady}
                onUpdateSettings={updateSettings}
              />
            ),
            settings: () => renderSettings()
          })}
        </>
      )
    }

    const productMenuEntry = findProductMenuEntry(activeNavKey, productMenuEntries)
    if (productMenuEntry) {
      return (
        <ProductContributionHost
          language={settings.language}
          load={productMenuEntry.load}
          title={resolveLocalizedTitle(productMenuEntry.title, settings.language)}
        />
      )
    }

    return renderWorkspace()
  }

  /**
   * P2-11：memo 化的页面 provider **只创建一次**，正文以**稳定包装**每次转发到本渲染最新的 mounts
   * （`pageMountsRef.current`）。否则 `mounts.settings: () => renderSettings()` 会把闭包冻结在 memo
   * 创建时那一次渲染：Tab 路径下 Settings 的 `apiKeyDraft` 等正文状态更新后正文不跟着变，受控输入
   * 被旧闭包重置、提交读到旧草稿（用户可见：输入看不见、保存存不下）。
   */
  const pageMountsRef = useRef<BuiltInPageMounts | null>(null)
  pageMountsRef.current = {
    assistants: () => (
      <AssistantPage
        language={settings.language}
        providers={providers}
        chatSettings={settings.chat}
        pinnedModelIds={pinnedModelIds}
        defaultAssistantModelId={settings.modelDefaults.assistantModelId}
        openRequest={assistantOpenRequest}
      />
    ),
    agents: () => (
      <AgentPage
        language={settings.language}
        agentSettings={settings.agent}
        chatSettings={settings.chat}
        providers={providers}
        pinnedModelIds={pinnedModelIds}
        defaultAgentModelId={settings.modelDefaults.agentModelId}
        onUpdateSettings={updateSettings}
      />
    ),
    settings: () => renderSettings()
  }

  /**
   * 页面正文派发（**唯一**表：`workspacePageContentProvider`）。本组件只注入自己持有的 mounts
   * （内置页正文 + AppShell 内部 Settings 渲染器），页窗用同一 provider 但不传 mounts。
   */
  const pageContentProvider = useMemo(
    () => createWorkspacePageContentProvider({
      mounts: {
        assistants: () => pageMountsRef.current?.assistants() ?? null,
        agents: () => pageMountsRef.current?.agents() ?? null,
        settings: () => pageMountsRef.current?.settings() ?? null
      }
    }),
    []
  )

  /** 一个 Tab 的正文：provider 未命中 ⇒ null，由 `WorkspacePageHost` 给成对 i18n 安全壳。 */
  function renderPageForTab(pageId: string, menuKey: string): React.ReactNode {
    return pageContentProvider.render({ pageId, menuKey, language: settings.language, active: true })
  }

  /**
   * P2-10③（D2 接线）：Tab 条的三态草稿门**必须**由真实内容 owner 回答，因此这里把既有 Settings 草稿
   * owner（模型服务 API Key 表单，`settingsDraftOwner`）经 `createSettingsDraftOwnerPort` 投影成端口：
   *  - 只有 Settings 页的实例有草稿 owner；其它页一律 `undefined`（**绝不伪造保护**，也绝不错杀无草稿的页）；
   *  - 提示界面用 Settings 自己的 `SettingsDraftPrompt`（通用 strip 不伪造 Settings 语义）；
   *  - owner 只回答「干净/脏 + 敏感性」，草稿正文不进入端口 ⇒ 敏感草稿在结构上不可能进平台 handoff。
   */
  const workspaceDraftGuard = useMemo<WorkspaceTabDraftGuard>(() => ({
    owner: (workspaceInstanceKey) => {
      const tab = workspaceTabState?.tabs.find((entry) => entry.workspaceInstanceKey === workspaceInstanceKey)
      return tab !== undefined && tab.pageId === 'settings'
        ? createSettingsDraftOwnerPort(settingsDraftOwner)
        : undefined
    },
    renderPrompt: ({ probe, pending, onDecision }) => (
      <SettingsDraftPrompt
        language={settings.language}
        reason={probe.sensitivity === 'sensitive' ? 'sensitive-draft' : 'unsaved-content'}
        pending={pending}
        onDecision={onDecision}
      />
    )
  }), [settingsDraftOwner, settings.language, workspaceTabState])

  /**
   * 生产页面宿主：有 Tab 快照时由 `WorkspaceTabStrip` 提供 tablist 语义、`WorkspacePageHost` 提供
   * tabpanel 语义（全部 `open` 的实例同时挂载、非活动项 `hidden` 就地隐藏）；没有快照即回退既有直接切页。
   */
  function renderWorkspacePages(): React.ReactElement {
    const state = workspaceTabState
    const client = tabClientRef.current
    if (state === null || client === null) return renderActivePage()
    return (
      <WorkspaceTabStrip
        language={settings.language}
        state={state}
        pages={shellWorkspacePages}
        port={client.port}
        recentlyClosedCount={state.recentlyClosedCount ?? 0}
        draftGuard={workspaceDraftGuard}>
        <WorkspacePageHost
          language={settings.language}
          state={state}
          renderPage={({ tab }) => renderPageForTab(tab.pageId, tab.menuKey)}
        />
      </WorkspaceTabStrip>
    )
  }

  return (
    <ConfigProvider locale={resolveAntDesignLocale(settings.language)} theme={getAntdTheme()}>
      {/* 主窗所有内容（含产品页）共用 Main 已解析的显示时区；分离窗由 WorkspaceWindowRoot 提供。 */}
      <ShellTimeZoneProvider timeZone={resolveShellTimeZone(settings.timeZone)}>
      {/* PLAT-64：platform/ui 的 markdown 折叠/卡片文案走语言上下文（产品页/停靠面板由各自的外层提供）。 */}
      <ShellLanguageProvider language={settings.language}>
      <div className="app-shell">
      <header className="topbar">
        <div className="traffic-light-space" aria-hidden="true" />
        <div className="titlebar-drag">
          <span className="topbar-page-indicator" />
          <span>{activeLabel}</span>
        </div>
        <div className="topbar-actions">
          <button type="button" aria-label="Search" title="Search">
            <Search size={15} />
          </button>
          <button type="button" aria-label="Layout" title="Layout">
            <SlidersHorizontal size={15} />
          </button>
        </div>
      </header>

      <InUseModelRetiredBanner
        labels={t.models}
        items={inUseRetiredModels}
        onChangeModel={() => {
          setSettingsPanelKey('models')
          setActiveNavKey('settings')
        }}
      />

      <aside className="global-sidebar">
        <div className="sidebar-logo">
          <img src={brandMarkUrl} alt="" aria-hidden="true" />
        </div>
        <nav className="nav-list" aria-label="Primary">
          {sidebarNavLayout.primaryItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                type="button"
                className={item.key === activeNavKey ? 'nav-item active' : 'nav-item'}
                title={item.label}
                aria-label={item.label}
                onClick={() => activateNavKey(item.key)}>
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <nav className="sidebar-bottom-nav" aria-label="Secondary">
          {sidebarNavLayout.bottomItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                type="button"
                className={item.key === activeNavKey ? 'nav-item active' : 'nav-item'}
                title={item.label}
                aria-label={item.label}
                onClick={() => activateNavKey(item.key)}>
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="status-dot" />
          <span>{products.length} {products.length === 1 ? t.status.productLoaded : t.status.productsLoaded}</span>
        </div>
      </aside>

      <main className="app-main">
        {/* PLAT-35：主窗页面区域由 MainWindowPanelArea 承载 —— 工作区键取 Tab 链的活动实例键，
            停靠面板与页面正文因此同属一个实例（没有桥/活动 Tab 时原样渲染，行为逐字回到旧路径）。 */}
        <div className="page-body">
          <MainWindowPanelArea
            workspaceInstanceKey={workspaceTabState?.activeWorkspaceInstanceKey ?? null}
            language={settings.language}
            timeZone={resolveShellTimeZone(settings.timeZone)}>
            {renderWorkspacePages()}
          </MainWindowPanelArea>
        </div>
      </main>
      </div>
      </ShellLanguageProvider>
      </ShellTimeZoneProvider>
    </ConfigProvider>
  )
}
