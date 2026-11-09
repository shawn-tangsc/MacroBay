import { useMemo, useRef, type ReactNode } from 'react'

import type { AppSettings } from '@platform/settings/schema/appSettings'
import { LoadingState } from '@platform/ui/components/loading'
import { ConfirmProvider } from '@platform/ui/components/confirm'
import { Activity } from 'lucide-react'

import type { LocalizedText } from '@platform/product-manifest'
import type { WorkspaceTabState } from '@platform/workspace/contracts'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { GeneratedProductMenuEntry, GeneratedProductSettingsEntry } from '@platform/product-registry/types'

import type { PlatformText } from '../i18n/platformText'
import type { BuiltInPageMounts, createBuiltInPageAdapters } from './workspace/builtInPageAdapters'
import type { ShellWorkspacePage } from './navigation/workspacePageRegistry'
import type { useWorkspaceTabSession } from './workspace/useWorkspaceTabSession'
import type { useNotificationNavigation } from './notifications/notificationDeeplinkWiring'
import type { useModelServiceProviders } from './model-service/useModelServiceProviders'
import type { ThemeConfig } from 'antd'
import brandMarkUrl from '../assets/brand/mark.svg'
import { resolveAntDesignLocale } from './shellOptionTables'
import { resolveShellTimeZone } from '@platform/ui/time/shellTimeFormat'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { AppMenuBar } from './window/AppMenuBar'
import { UpdateActionButton } from './updates/UpdateActionButton'
import { WindowControls } from './window/WindowControls'
import { NotificationBell } from './notifications/NotificationBell'
import { NotificationBanner } from './notifications/NotificationBanner'
import { NOTIFICATION_CENTER_PANEL_ID, NotificationCenterDrawer } from './notifications/NotificationCenterDrawer'
import { InUseModelRetiredBanner } from './model-service/InUseModelRetiredBanner'
import { MainWindowPanelArea } from './workspace/workspaceMainPanelContext'
import { WorkspaceTabStrip, type WorkspaceTabDraftGuard } from './workspace/WorkspaceTabStrip'
import { WorkspacePageHost } from './workspace/WorkspacePageHost'
import { SettingsDraftPrompt } from './settings/SettingsWorkspaceAdapter'
import { createSettingsDraftOwnerPort, type SettingsDraftOwner } from './settings/SettingsWorkspaceAdapter'
import { AssistantPage } from './assistants/AssistantPage'
import { AgentPage } from './agents/AgentPage'
import { ProductContributionHost } from './workspace/ProductContributionHost'
import { createWorkspacePageContentProvider } from './workspace/workspacePageContentProvider'
import { findProductMenuEntry } from './navigation/mergeShellNavigation'
import { isBuiltInNavItemId } from './navigation/builtInNavEntries'
import { resolveLocalizedTitle } from './navigation/shellIconRegistry'
import { WINDOW_ANTD_BUTTON_CONFIG, WINDOW_ANTD_WAVE_CONFIG } from '@platform/ui/theme/windowAntdTheme'
import { ConfigProvider } from 'antd'

/**
 * 主窗视图（从 `AppShell.tsx` 原样搬出）：顶栏、侧栏、通知层、页面区域与 Tab 宿主。
 *
 * 只搬运：元素、类名、文案键、顺序与布局一字未改。状态仍归 `AppShellContent`，这里接收它算好的值
 * 与回调；页面正文的派发（`renderWorkspace` / `renderActivePage` / Tab 宿主）随视图一起搬来，
 * 因为它们与这些 JSX 是同一件事。
 */
export type AppInfo = {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  osRelease: string
  theme: string
}

export type ProductSummary = {
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

export type AssistantOpenRequest = {
  assistantId: string
  topicId: string
}

export type InUseRetiredModel = { providerId: string; modelId: string; modelName: string }

export type AppShellViewProps = {
  t: PlatformText
  settings: AppSettings
  appInfo: AppInfo | null
  products: ProductSummary[]
  activeNavKey: string
  sidebarNavLayout: ReturnType<typeof import('./navigation/mergeShellNavigation').splitShellSidebarNavItems>
  onActivateNavKey: (navKey: string) => void
  notificationCenterOpen: boolean
  setNotificationCenterOpen: (open: boolean) => void
  onOpenNotificationTarget: ReturnType<typeof useNotificationNavigation>['openNotificationTarget']
  inUseRetiredModels: React.ComponentProps<typeof InUseModelRetiredBanner>['items']
  setSettingsPanelKey: (panelKey: string) => void
  builtInPages: ReturnType<typeof createBuiltInPageAdapters>
  providers: SafeModelProvider[]
  providersState: ReturnType<typeof useModelServiceProviders>['state']
  pinnedModelIds: string[]
  assistantOpenRequest: AssistantOpenRequest | null
  focusEntityId: string | null
  productMenuEntries: readonly GeneratedProductMenuEntry[]
  tabClientRef: ReturnType<typeof useWorkspaceTabSession>['clientRef']
  workspaceTabState: WorkspaceTabState | null
  shellWorkspacePages: readonly Omit<ShellWorkspacePage, 'kind' | 'load'>[]
  settingsDraftOwner: SettingsDraftOwner
  getAntdTheme: () => ThemeConfig
  renderSettings: () => ReactNode
  onUpdateSettings: (patch: import('@platform/settings/schema/appSettings').AppSettingsPatch) => Promise<void>
}

export function AppShellView(props: AppShellViewProps): React.ReactElement {
  const {
    t, settings, appInfo, products, activeNavKey, sidebarNavLayout, onActivateNavKey,
    notificationCenterOpen, setNotificationCenterOpen, onOpenNotificationTarget: openNotificationTarget,
    inUseRetiredModels, setSettingsPanelKey, builtInPages, providers, providersState, pinnedModelIds,
    assistantOpenRequest, focusEntityId, productMenuEntries, tabClientRef, workspaceTabState,
    shellWorkspacePages, settingsDraftOwner, getAntdTheme, renderSettings, onUpdateSettings: updateSettings
  } = props
  const activateNavKey = onActivateNavKey
  const setActiveNavKey = onActivateNavKey

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
                // 当前页：整行即动作、保留现形，组件表达不了（侧栏导航是一个列表，不是按钮组），
                // 所以补的是可访问名与「当前项」——高亮靠 class 是给眼睛的，读屏拿不到。
                {...(item.key === activeNavKey ? { 'aria-current': 'page' as const } : {})}
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
                // 当前页：整行即动作、保留现形，组件表达不了（侧栏导航是一个列表，不是按钮组），
                // 所以补的是可访问名与「当前项」——高亮靠 class 是给眼睛的，读屏拿不到。
                {...(item.key === activeNavKey ? { 'aria-current': 'page' as const } : {})}
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
