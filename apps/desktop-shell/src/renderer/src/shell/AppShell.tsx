import {
  Activity,
  Settings,
} from 'lucide-react'
import {useEffect, useLayoutEffect, useMemo, useState} from 'react'


import type {AppLanguage, AppSettings, AppSettingsPatch, NetworkSettings} from '@platform/settings/schema/appSettings'
import type {SettingsStartupReadState} from '@platform/settings/store/settingsStore'
import {createDefaultAppSettings} from '@platform/settings/schema/appSettings'
import {resolveThemeMode, toThemeAttributes} from '@platform/ui/theme/themeModel'
import {AppShellToastLayer} from './window/AppShellToastLayer'
import {useDocumentLanguage} from './hooks/useDocumentLanguage'
import {useNavigationFocusHandoff} from './navigation/useNavigationFocusHandoff'

import brandMarkUrl from '../assets/brand/mark.svg'
import {platformText} from '../i18n/platformText'
import {AppMenuBar} from './window/AppMenuBar'
import {WindowControls} from './window/WindowControls'
import {productMenuEntries, productSettingsEntries} from '@products/generated/shellRegistry'
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
import {NotificationBell} from './notifications/NotificationBell'
import {NotificationCenterDrawer} from './notifications/NotificationCenterDrawer'
import {NotificationBanner} from './notifications/NotificationBanner'
import {useNotificationNavigation} from './notifications/notificationDeeplinkWiring'
import {AppShellPreferencesPane} from './AppShellPreferencesPane'
import {AppShellSettingsLayout} from './AppShellSettingsLayout'
import {useProxySelfTest} from './useProxySelfTest'
import {AppShellView, type AppInfo, type AssistantOpenRequest, type ProductSummary} from './AppShellView'
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
import {ProductContributionHost} from './workspace/ProductContributionHost'
import {createBuiltInPageAdapters} from './workspace/builtInPageAdapters'
import {createShellWorkspacePageRegistry, type ShellWorkspacePage} from './navigation/workspacePageRegistry'
import {WorkspacePageHost} from './workspace/WorkspacePageHost'
import {WorkspaceTabStrip} from './workspace/WorkspaceTabStrip'
import {useWorkspaceTabSession} from './workspace/useWorkspaceTabSession'
import {applyRootThemeAttributes, WorkspaceWindowRoot} from './workspace/WorkspaceWindowRoot'
import {resolveAntDesignLocale} from './shellOptionTables'
import {resolvePreferencesText} from './shellOptionTables'

export { resolveAntDesignLocale } from './shellOptionTables'
import {buildWindowAntdTheme} from '@platform/ui/theme/windowAntdTheme'
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



type ProviderDraft = {
  enabled: boolean
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
  /**
   * 启动期设置文件读不到：当前跑在默认值上，横幅要说出来。
   * 状态由主进程给（`settings.recovery('state')`），渲染层不自己推断"是不是读失败"。
   */
  const [settingsRecovery, setSettingsRecovery] = useState<SettingsStartupReadState>({ unreadable: false, copyPath: null })
  const [settingsReadRetrying, setSettingsReadRetrying] = useState(false)
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
  const { proxySelfTest, proxySelfTestView, runProxySelfTest } = useProxySelfTest({ settings, t, selectedProvider })
  // 提示与状态在渲染时解析：存的是「怎么生成这句话」，所以切语言后连历史提示一起变。
  const noticeText = resolveLiveText(liveNotice.notice, t)
  // 解析器与两张键表都在 `shellOptionTables`：同一件事只有一处定义。
  const preferencesText = (key: string): string =>
    resolvePreferencesText(t.preferences as unknown as Record<string, unknown>, key)
  // 结果行的文案、语气、第二行同时算出来：渲染层只照着 tone 上样式，不另算成败。
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

  // 启动降级状态：单独读一次，失败就当"正常"（不能因为查状态把界面拦住）。
  useEffect(() => {
    let cancelled = false
    void window.platform.settings
      .recovery('state')
      .then((state) => { if (!cancelled) setSettingsRecovery(state) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  async function reloadSettingsFromMain(): Promise<void> {
    try {
      setSettings((await window.platform.settings.get()) as AppSettings)
    } catch {
      // 仍在降级：保留默认值，横幅继续显示。
    }
  }

  /** 「重试读取」：读成功才换回真实设置，失败保持降级——**不抛**。 */
  async function retrySettingsRead(): Promise<void> {
    setSettingsReadRetrying(true)
    try {
      const state = await window.platform.settings.recovery('retry')
      setSettingsRecovery(state)
      if (!state.unreadable) await reloadSettingsFromMain()
    } catch {
      // 查询本身失败：保持现有状态，别把降级画成正常。
    } finally {
      setSettingsReadRetrying(false)
    }
  }

  /** 危险区确认后的重置：只在读者显式确认后调用（主进程写默认值）。 */
  async function resetSettingsFile(): Promise<void> {
    const state = await window.platform.settings.recovery('reset')
    setSettingsRecovery(state)
    await reloadSettingsFromMain()
  }

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
        settingsRecovery={settingsRecovery}
        settingsReadRetrying={settingsReadRetrying}
        onRetrySettingsRead={() => void retrySettingsRead()}
        onResetSettingsFile={resetSettingsFile}
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

  return (
    <AppShellView
      t={t}
      settings={settings}
      appInfo={appInfo}
      products={products}
      activeNavKey={activeNavKey}
      sidebarNavLayout={sidebarNavLayout}
      onActivateNavKey={activateNavKey}
      notificationCenterOpen={notificationCenterOpen}
      setNotificationCenterOpen={setNotificationCenterOpen}
      onOpenNotificationTarget={openNotificationTarget}
      inUseRetiredModels={inUseRetiredModels}
      setSettingsPanelKey={setSettingsPanelKey}
      builtInPages={builtInPages}
      providers={providers}
      providersState={providersState}
      pinnedModelIds={pinnedModelIds}
      assistantOpenRequest={assistantOpenRequest}
      focusEntityId={focusEntityId}
      productMenuEntries={productMenuEntries}
      tabClientRef={tabClientRef}
      workspaceTabState={workspaceTabState}
      shellWorkspacePages={shellWorkspacePages}
      settingsDraftOwner={settingsDraftOwner}
      getAntdTheme={getAntdTheme}
      renderSettings={renderSettings}
      onUpdateSettings={updateSettings}
    />
  )
}
