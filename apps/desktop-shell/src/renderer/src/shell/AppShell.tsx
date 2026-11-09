import {
  Activity,
  Settings,
} from 'lucide-react'
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {ConfigProvider} from 'antd'

import type {LocalizedText} from '@platform/product-manifest'

import type {AppLanguage, AppSettings, AppSettingsPatch, NetworkSettings} from '@platform/settings/schema/appSettings'
import {createDefaultAppSettings} from '@platform/settings/schema/appSettings'
import {LoadingState} from '@platform/ui/components/loading'
import {resolveThemeMode, toThemeAttributes} from '@platform/ui/theme/themeModel'
import {ShellLanguageProvider} from '@platform/ui/shell/ShellLanguageContext'
import {AppShellToastLayer} from './window/AppShellToastLayer'
import {useDocumentLanguage} from './hooks/useDocumentLanguage'
import {useNavigationFocusHandoff} from './navigation/useNavigationFocusHandoff'
import {ShellTimeZoneProvider} from '@platform/ui/shell/ShellTimeZoneContext'
import {resolveShellTimeZone} from '@platform/ui/time/shellTimeFormat'

import brandMarkUrl from '../assets/brand/mark.svg'
import {platformText} from '../i18n/platformText'
import {AppMenuBar} from './window/AppMenuBar'
import {WindowControls} from './window/WindowControls'
import {productMenuEntries, productSettingsEntries} from '@products/generated/shellRegistry'
import {isBuiltInNavItemId, isBuiltInSettingsPanelId} from './navigation/builtInNavEntries'
import {builtInWorkspacePages} from '@platform/workspace/registry/builtInWorkspacePages'
import {resolveHomeMenuKey, toProductHomeMenuCandidate} from './navigation/homeMenuKey'
import './navigation/settingsNav.css'
import {UpdateActionButton} from './updates/UpdateActionButton'
import {resolveAvailableSettingsPanelKey, resolveSettingsPanelKeyFromHash} from './navigation/settingsPanelKey'
import {ModelServiceProviderPage} from './model-service/ModelServiceProviderPage'
import {ModelServiceLoadSurface} from './model-service/ModelServiceLoadSurface'
import {useModelServiceProviders} from './model-service/useModelServiceProviders'
import {InUseModelRetiredBanner} from './model-service/InUseModelRetiredBanner'
import {ModelServiceDefaultModelsSection} from './model-service/ModelServiceDefaultModelsSection'
import {useInUseModelPatrol} from './model-service/useInUseModelPatrol'
import {resolveProviderHost} from './model-service/ModelServiceBrandBlock'
import {sanitizeProxyAddressForDisplay} from './proxyAddressDisplay'
import {NotificationBell} from './notifications/NotificationBell'
import {NOTIFICATION_CENTER_PANEL_ID, NotificationCenterDrawer} from './notifications/NotificationCenterDrawer'
import {NotificationBanner} from './notifications/NotificationBanner'
import {useNotificationNavigation} from './notifications/notificationDeeplinkWiring'
import {AppShellPreferencesPane} from './AppShellPreferencesPane'
import {AppShellSettingsLayout} from './AppShellSettingsLayout'
import {ModelServiceSection} from './model-service/ModelServiceSection'
import {useModelServiceActions} from './model-service/useModelServiceActions'
import {useModelServiceDrafts} from './model-service/useModelServiceDrafts'
import {useModelServiceProviderActions} from './model-service/useModelServiceProviderActions'
import {
  buildProxyProbeUrl,
  describeProxySelfTest,
  type ProxySelfTestResult,
} from './proxySelfTestDisplay'
import {
  findProductMenuEntry,
  findProductSettingsEntry,
  groupShellSettingsPanels,
  mergeShellNavItems,
  splitShellSidebarNavItems,
} from './navigation/mergeShellNavigation'
import {resolveLocalizedTitle} from './navigation/shellIconRegistry'
import {ProductContributionHost} from './workspace/ProductContributionHost'
import {createBuiltInPageAdapters, type BuiltInPageMounts} from './workspace/builtInPageAdapters'
import {createShellWorkspacePageRegistry, type ShellWorkspacePage} from './navigation/workspacePageRegistry'
import {WorkspacePageHost} from './workspace/WorkspacePageHost'
import {createWorkspacePageContentProvider} from './workspace/workspacePageContentProvider'
import {WorkspaceTabStrip, type WorkspaceTabDraftGuard} from './workspace/WorkspaceTabStrip'
import {useWorkspaceTabSession} from './workspace/useWorkspaceTabSession'
import {applyRootThemeAttributes, WorkspaceWindowRoot} from './workspace/WorkspaceWindowRoot'
import {MainWindowPanelArea} from './workspace/workspaceMainPanelContext'
import {resolveAntDesignLocale} from './shellOptionTables'
import {resolvePreferencesText} from './shellOptionTables'
import {ConfirmProvider} from '@platform/ui/components/confirm'

export { resolveAntDesignLocale } from './shellOptionTables'
import {buildWindowAntdTheme, WINDOW_ANTD_BUTTON_CONFIG, WINDOW_ANTD_WAVE_CONFIG} from '@platform/ui/theme/windowAntdTheme'
import {
  createSettingsDraftOwnerPort,
  SettingsDraftPrompt,
} from './settings/SettingsWorkspaceAdapter'
import {ProviderConnectionCheckDrawer} from './ProviderConnectionCheckDrawer'
import {ProviderModelSyncDrawer} from './ProviderModelSyncDrawer'

import {AgentPage} from './agents/AgentPage'
import {AssistantPage} from './assistants/AssistantPage'
import {resolveLiveText} from './liveText'
import {useLiveNotice} from './useLiveNotice'

import {ModelServiceAddProviderDialog} from './model-service/ModelServiceAddProviderDialog'
import {ModelServiceModelDrawer} from './model-service/ModelServiceModelDrawer'
import {PINNED_MODEL_IDS_STORAGE_KEY, serializePinnedModelIds} from './modelPins'
import {NotificationSettingsScreen} from './settings/NotificationSettingsScreen'
import {AboutSettingsPage} from './settings/about/AboutSettingsPage'
import {AssistantLibrarySettingsPage} from './settings/assistants/AssistantLibrarySettingsPage'
import {StorageCacheSettingsPage} from './settings/storage-cache/StorageCacheSettingsPage'
import {TaskAutomationSettingsPage} from './settings/task-automation/TaskAutomationSettingsPage'
import {ChannelSettingsPage} from './settings/channels/ChannelSettingsPage'
import {WebSearchSettingsPage} from './settings/web-search/WebSearchSettingsPage'
import {VisualIdentityAvatar} from './VisualIdentityAvatar'

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
    // 提示宿主与语言上下文收在 AppShellToastLayer：两个渲染根都经这里进入，宿主只挂一次。
    <AppShellToastLayer language={appLanguage}>
      <WorkspaceWindowRoot fallbackLanguage={appLanguage}>
        <AppShellContent onLanguageChange={setAppLanguage} />
      </WorkspaceWindowRoot>
    </AppShellToastLayer>
  )
}

/**
 * 首次落点（口径 A）：**只在没有可恢复的活动页**（首次打开 / 布局被重置）时被问到。
 * 有历史时下面 `.tabs.*` 的快照会接管（高亮跟随权威活动项），这个初始值压根不参与。
 *
 * 三层来源，逐层降级：菜单声明的 `home` → 菜单 `order` 第一项 → 常量 `'assistants'`。
 * 那个常量现在的**唯一触发条件**是「菜单里一页都没有」（解析器返回 `null`）；正常构建里内置页总在，
 * 所以它只是装配残缺时的最后兜底，不是「默认页」。判据见 `navigation/homeMenuKey.test.ts`。
 */
const LANDING_NAV_KEY_FALLBACK = 'assistants'

/** 主窗 shell 内容：语言变化时回传给 AppShell，供面板窗 error-shell/准备期壳兜底使用（P1-06h / N2）。 */
function AppShellContent(props: { onLanguageChange?: (language: AppLanguage) => void } = {}): React.ReactElement {
  // 默认首页的输入不依赖语言（只用菜单键、order、home 声明），所以放在 state 外面算一次即可：
  // 它必须在这一行就有值，否则首帧会先画 `'assistants'` 再跳走——那就是「打开时闪一下别页」。
  const landingNavKey = useMemo(
    () => resolveHomeMenuKey(builtInWorkspacePages, productMenuEntries.map(toProductHomeMenuCandidate))
      ?? LANDING_NAV_KEY_FALLBACK,
    []
  )
  const [activeNavKey, setActiveNavKey] = useState(landingNavKey)
  const [settingsPanelKey, setSettingsPanelKey] = useState('models')
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false)
  // 装配与定位状态收在 `notificationDeeplinkWiring`：绑错 `navigate` 只换高亮不切页，那件事要有守卫盯着。
  const { openNotificationTarget, focusEntityId } = useNotificationNavigation({
    productMenuEntries,
    navigate: activateNavKey,
    setSettingsPanelKey,
    productSettingsEntries,
    setNotificationCenterOpen
  })
  const [settings, setSettings] = useState<AppSettings>(createDefaultAppSettings)
  const [assistantOpenRequest, setAssistantOpenRequest] = useState<AssistantOpenRequest | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [products, setProducts] = useState<ProductSummary[]>([])
  // 供应商列表、选中项与它的读数生命周期收在 hook 里：外壳只拿「现在能不能画」和「重读一次」。
  const {
    state: providersState,
    providers,
    selectedProviderId,
    selectProvider,
    reload: reloadProviders
  } = useModelServiceProviders()
  // PLAT-75：巡检已挪到主进程的每日任务；界面只读它的全局结论。
  const inUseRetiredModels = useInUseModelPatrol()
  const [proxySelfTest, setProxySelfTest] = useState<{ running: boolean; result: ProxySelfTestResult | null }>({
    running: false,
    result: null
  })
  const t = platformText[settings.language]

  // 模型服务屏：草稿/派生、写入动作、供应商与模型动作三块各自成模块，外壳只接线（只搬运）。
  const drafts = useModelServiceDrafts({ providers, selectedProviderId, t })
  const sync = useModelServiceActions({ drafts, reloadProviders })
  const providerActions = useModelServiceProviderActions({
    drafts,
    persistSelectedProviderDraft: sync.persistSelectedProviderDraft,
    reloadProviders,
    providers,
    selectProvider,
    setActiveNavKey,
    setSettingsPanelKey,
    t
  })
  const liveNotice = drafts.liveNotice
  const pinnedModelIds = drafts.pinnedModelIds
  const selectedProvider = drafts.selectedProvider
  // 提示与状态在渲染时解析：存的是「怎么生成这句话」，所以切语言后连历史提示一起变。
  const noticeText = resolveLiveText(liveNotice.notice, t)
  // 解析器与两张键表都在 `shellOptionTables`：同一件事只有一处定义。
  const preferencesText = (key: string): string =>
    resolvePreferencesText(t.preferences as unknown as Record<string, unknown>, key)
  // 结果行的文案、语气、第二行同时算出来：渲染层只照着 tone 上样式，不另算成败。
  const proxySelfTestView =
    proxySelfTest.result === null
      ? null
      : describeProxySelfTest(proxySelfTest.result, t, {
          expectsProxy: settings.network.proxyMode === 'custom',
          fallbackProxyLabel: resolveProxyDisplayLabel()
        })
  const navItems = useMemo(() => mergeShellNavItems(settings.language, productMenuEntries), [settings.language])
  const sidebarNavLayout = useMemo(() => splitShellSidebarNavItems(navItems), [navItems])
  const settingsNavGroups = useMemo(
    () => groupShellSettingsPanels(settings.language, productSettingsEntries),
    [settings.language]
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
  const settingsDraftOwner = drafts.settingsDraftOwner

  /**
   * P2-03：**生产 Tab 宿主接线**（这是移除「单 active 页面销毁」旧路径的挂载点）。
   *
   * 唯一来源是受控 `.tabs.*` 桥：没有桥（例如既有 shell 单测注入的 platform 不含 workspace）时
   * `tabClientRef.current` 为 null，本组件保持 P2-02 之前的直接切页行为 —— 绝不在 renderer 复制一份 Tab 权威。
   * 页面正文仍只来自 `builtInPageAdapters` / 产品 loader，Tab 宿主只是容器。
   *
   * 会话主体（桥 → client → 快照 state，含首次落点补开首页）收在 `useWorkspaceTabSession`：
   * 这段只在「没有可恢复的活动页」时才补首页，而那个判定点只存在于它内部。
   */
  const {
    clientRef: tabClientRef, state: workspaceTabState, openMenuPage
  } = useWorkspaceTabSession({ landingNavKey, onActiveMenuKey: setActiveNavKey })

  /**
   * 一级菜单点击：有 Tab 桥即走受控命令（打开/激活同一实例），否则保持既有直接切页（无桥兜底）。
   * 「开没开成」的判定与拒绝诊断都在 `openMenuPage` 里（一处实现）；这里只决定没开成时退到高亮。
   */
  function activateNavKey(navKey: string): void {
    if (tabClientRef.current === null) {
      setActiveNavKey(navKey)
      return
    }
    void openMenuPage(navKey).then((outcome) => { if (outcome === 'rejected') setActiveNavKey(navKey) })
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.platform.app.getInfo().then((value) => { if (!cancelled) setAppInfo(value) }),
      window.platform.app.getProductSummaries().then((value) => { if (!cancelled) setProducts(value) }),
      window.platform.settings.get().then((value) => { if (!cancelled) setSettings(value as AppSettings) })
    ]).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  // PLAT-82：检测结束会把「本次实测通过」的协议写回模型 ⇒ 重新拉一次供应商列表，
  // 行内协议 chip / 协议 pill 才能立刻反映新证据（状态文案仍在内存，不参与刷新）。
  useEffect(() => {
    const api = window.platform?.modelProviders
    if (!api?.onModelDetectionDone) return undefined
    const unsubscribe = api.onModelDetectionDone(() => {
      void reloadProviders()
    })
    return () => { unsubscribe() }
  }, [reloadProviders])

  // P1-06h（N2）：语言是「当前设置」的一部分，切换后必须回传给 AppShell 下发给 error-shell/准备期壳。
  useEffect(() => {
    props.onLanguageChange?.(settings.language)
  }, [props.onLanguageChange, settings.language])

  useDocumentLanguage(settings.language)

  // 导航后的焦点交接收在 hook 里（契约 §14）：导航成功后调一次，effect 在渲染后执行。
  const scheduleNavFocusHandoff = useNavigationFocusHandoff()
  useEffect(() => {
    const applyNavigation = (detail?: AppShellNavigateDetail): void => {
      // A tab-hosted shell must activate the target tab, not only repaint the sidebar highlight.
      // `activateNavKey` falls back to the old direct page switch when the tab bridge is absent.
      if (detail?.navKey) activateNavKey(detail.navKey)
      if (detail?.settingsPanelKey) {
        setSettingsPanelKey(resolveAvailableSettingsPanelKey(detail.settingsPanelKey, productSettingsEntries))
      }
      if (detail?.assistant) setAssistantOpenRequest(detail.assistant)
      scheduleNavFocusHandoff()
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
    // 如实说明：这里写出的 `data-accent` 目前**没有任何样式消费者**（样式表零命中、组件库主题硬编码 lime），
    // 改值不会改变外观；按 2026-11-01 用户裁决先保留写入与存储、不给设置入口，等真正接通再露出来。
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

  async function updateNetworkSettings(patch: Partial<NetworkSettings>): Promise<void> {
    await updateSettings({
      network: {
        ...settings.network,
        ...patch
      }
    })
  }


  async function updateSettings(patch: AppSettingsPatch): Promise<void> {
    liveNotice.clear()
    try {
      const nextSettings = (await window.platform.settings.update(patch)) as AppSettings
      setSettings(nextSettings)
      liveNotice.showSaved()
    } catch (error) {
      liveNotice.showSaveFailed(error)
    }
  }

  /**
   * T4/T5：端点清单保存（编辑器里改地址 / 添加 / 删除 / 设为默认都走它）。
   *
   * 传进来的是**整份有序清单**（`[0]` = 默认端点），所以不存在"只改了一个字段、
   * 其余字段被抹掉"的合并问题；`baseUrl` 由端点清单派生，不需要单独回写。
   */
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
          targetHost: typeof result?.targetHost === 'string' ? result.targetHost : resolveProviderHost(target),
          resolvedProxy: typeof result?.resolvedProxy === 'string' ? result.resolvedProxy : undefined,
          proxied: typeof result?.proxied === 'boolean' ? result.proxied : undefined,
          endpointReachable: typeof result?.endpointReachable === 'boolean' ? result.endpointReachable : null,
          proxyEndpoint: typeof result?.proxyEndpoint === 'string' ? result.proxyEndpoint : null,
          proxyEndpointLoopback: typeof result?.proxyEndpointLoopback === 'boolean' ? result.proxyEndpointLoopback : null,
          directProbeReachable: typeof result?.directProbeReachable === 'boolean' ? result.directProbeReachable : null,
          directProbeEndpoint: typeof result?.directProbeEndpoint === 'string' ? result.directProbeEndpoint : null
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
    return (
      <AppShellSettingsLayout
        t={t}
        settings={settings}
        noticeText={noticeText}
        resolveText={preferencesText}
        settingsPanelKey={settingsPanelKey}
        onSelectPanel={setSettingsPanelKey}
        navGroups={settingsNavGroups}
        productSettingsEntries={productSettingsEntries}
        providersState={providersState}
        providers={providers}
        onReloadProviders={() => void reloadProviders()}
        onUpdateSettings={updateSettings}
        onUpdateNetworkSettings={updateNetworkSettings}
        onDraftSettingsChange={setSettings}
        onRunProxySelfTest={runProxySelfTest}
        onManageAssistants={() => setActiveNavKey('assistants')}
        focusEntityId={focusEntityId}
        appInfoName={appInfo?.name ?? ''}
        proxySelfTest={proxySelfTest}
        proxySelfTestView={proxySelfTestView}
        modelService={renderModelService()}
      />
    )
  }

  /**
   * PLAT-61：模型服务 → 供应商配置。正文全部抽取到 `model-service/`，
   * 本函数**只保留接线**：状态来自本组件，写入仍是既有 IPC 包装，抽屉/宿主仍在这里挂载。
   */
  function renderModelService(): React.ReactElement {
    return (
      <ModelServiceSection
        t={t}
        settings={settings}
        noticeText={noticeText}
        drafts={drafts}
        sync={sync}
        provider={providerActions}
        onSelectProvider={selectProvider}
        onOpenExternal={openProviderUrl}
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
            <span>{appInfo
              ? `${appInfo.platform} / Electron ${appInfo.electron}`
              : <LoadingState layout="inline" size="sm" label={t.status.loading} />}</span>
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
                loadingModelService={providersState.status === 'loading'}
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
    <ConfigProvider locale={resolveAntDesignLocale(settings.language)} theme={getAntdTheme()} button={WINDOW_ANTD_BUTTON_CONFIG} wave={WINDOW_ANTD_WAVE_CONFIG}>
      {/* 确认框宿主：必须在 ConfigProvider 里面，`Modal.useModal()` 才吃得到当前主题（深浅色一致）。 */}
      <ConfirmProvider>
      {/* 主窗所有内容（含产品页）共用 Main 已解析的显示时区；分离窗由 WorkspaceWindowRoot 提供。 */}
      <ShellTimeZoneProvider timeZone={resolveShellTimeZone(settings.timeZone)}>
      {/* 语言上下文：platform/ui 与其他共享组件按显示语言取文案（产品页/停靠面板由各自的外层提供）。 */}
      <ShellLanguageProvider language={settings.language}>
      <div className="app-shell">
      <header className="topbar">
        <div className="traffic-light-space" aria-hidden="true" />
        {/* Windows 常规做法：标题栏最左是应用图标，其后才是菜单（macOS 同位置是红绿灯，故默认不显示） */}
        <span className="titlebar-brand" aria-hidden="true">
          <img src={brandMarkUrl} alt="" />
        </span>
        {/* Windows：OS 不再绘制菜单栏，应用菜单画在自绘标题栏里（macOS 用屏幕顶部的原生菜单，这里不渲染） */}
        <AppMenuBar />
        {/* 拖动区：页面名不再重复显示（当前页由 Tab 条承载），这里是纯粹的窗口拖动留白 */}
        <div className="titlebar-drag" aria-hidden="true" />
        <div className="topbar-actions">
          {/* 搜索 / 布局两颗图标已删除：它们从来没有 onClick，标签承诺的动作不存在。
              等真有面板时再连功能一起加回来，别只把按钮补回顶栏。 */}
          <UpdateActionButton language={settings.language} />
          <NotificationBell labels={t.notifications} open={notificationCenterOpen}
            controlsId={NOTIFICATION_CENTER_PANEL_ID} onOpen={() => setNotificationCenterOpen(true)} />
        </div>
        {/* Windows：自绘标题栏的最小化/最大化/关闭（macOS 用系统红绿灯，这里不渲染） */}
        <WindowControls />
      </header>

      {/* 右上角横幅：挂载点只占一行，文案与语言由组件自己取。 */}
      <NotificationBanner onOpen={() => setNotificationCenterOpen(true)} />

      <NotificationCenterDrawer
        open={notificationCenterOpen}
        onOpenDeeplink={openNotificationTarget}
        onClose={() => {
          setNotificationCenterOpen(false)
          // 关闭后焦点回铃铛：键盘用户不该被扔回文档开头。
          queueMicrotask(() => document.querySelector<HTMLElement>('[data-notification-bell] button')?.focus())
        }}
        labels={t.notifications}
      />

      <InUseModelRetiredBanner
        labels={t.models}
        items={inUseRetiredModels}
        onChangeModel={() => {
          setSettingsPanelKey('models')
          setActiveNavKey('settings')
        }}
      />

      <aside className="global-sidebar">
        {/* 品牌图标已上移到自绘标题栏最左（Windows 常规做法），侧栏不再留一块只有 logo 的空白区 */}
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
                // 稳定键：外壳的行为用例要能点到「具体哪一页」，而不是靠本地化后的可读文案去找按钮。
                data-nav-key={item.key}
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
                // 稳定键：外壳的行为用例要能点到「具体哪一页」，而不是靠本地化后的可读文案去找按钮。
                data-nav-key={item.key}
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
      </ConfirmProvider>
    </ConfigProvider>
  )
}

