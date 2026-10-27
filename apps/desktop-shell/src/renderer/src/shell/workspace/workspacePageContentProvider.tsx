import { useCallback, useEffect, useState, type ReactNode } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { GeneratedProductMenuEntry, GeneratedProductSettingsEntry } from '@platform/product-registry/types'
import type { AppLanguage, AppSettings, AppSettingsPatch } from '@platform/settings/schema/appSettings'
import { LoadingState } from '@platform/ui/components/loading'
import { productMenuEntries, productSettingsEntries } from '@products/generated/shellRegistry'
import { platformText } from '../../i18n/platformText'
import { AgentPage } from '../agents/AgentPage'
import { AssistantPage } from '../assistants/AssistantPage'
import { isBuiltInSettingsPanelId } from '../navigation/builtInNavEntries'
import {
  findProductMenuEntry,
  findProductSettingsEntry,
  groupShellSettingsPanels
} from '../navigation/mergeShellNavigation'
import { resolveLocalizedTitle } from '../navigation/shellIconRegistry'
import {
  PINNED_MODEL_IDS_STORAGE_KEY, parsePinnedModelIds, serializePinnedModelIds, togglePinnedModelId
} from '../modelPins'
import { AssistantLibrarySettingsPage } from '../settings/assistants/AssistantLibrarySettingsPage'
import { NotificationSettingsPane } from '../settings/NotificationSettingsPane'
import { StorageCacheSettingsPage } from '../settings/storage-cache/StorageCacheSettingsPage'
import { TaskAutomationSettingsPage } from '../settings/task-automation/TaskAutomationSettingsPage'
import { ChannelSettingsPage } from '../settings/channels/ChannelSettingsPage'
import { WebSearchSettingsPage } from '../settings/web-search/WebSearchSettingsPage'
import { createBuiltInPageAdapters, type BuiltInPageMounts } from './builtInPageAdapters'
import { ProductContributionHost } from './ProductContributionHost'

/**
 * Owner: apps/desktop-shell renderer / workspace 页面正文 provider（P2-03 F1，PM 批准的新模块）。
 * 权威：技术设计 §3（一个 workspaceInstanceKey = 一个逻辑页面）、§6（容器移动只重新 attach/订阅）。
 *
 * 在**独立页面窗**里挂载该 Tab 的**真实页面正文**，且不是第二份业务/布局权威：
 *  - 内置页派发表仍只有 `builtInPageAdapters` 一处，本模块只提供「页窗版本」的 mounts；
 *  - 页窗数据全部来自**受控 IPC**（`settings.get`、`modelProviders.list`、`agents.*`/`assistants.*` 订阅、
 *    产品 loader 动态 import），不读主窗全局状态、不复制 Main 权威；
 *  - 每个页面各自订阅受控增量 ⇒ detach 之后**新窗继续收增量**，旧窗卸载即退订；
 *  - 渲染不出来（未知产品页 / 读不到受控 IPC）一律 fail closed：`render` 返回 null，由
 *    `WorkspacePageHost` 给出成对 i18n 安全壳（`data-page-missing`），绝不伪造正文。
 *
 * 跨窗连续性边界（如实声明）：`assistants`/`agents` 完整交互；`settings` 的 assistant-library、
 * web-search、storage-cache、task-automation、channels、notifications 完整交互；`models` 与
 * `preferences` 正文由主窗 shell 内部状态持有，页窗不复制，选中时给 `data-page-panel="host-only"` 边界元素。
 */

export type WorkspacePageContentInput = {
  pageId: string
  menuKey: string
  language: AppLanguage
  /** false = 宿主里被就地隐藏（不卸载）；页窗恒为 true。 */
  active: boolean
}

export type WorkspacePageContentProvider = {
  /** 该页面在本 provider 里的真实正文；null ⇒ 调用方必须 fail closed（安全壳）。 */
  render: (input: WorkspacePageContentInput) => ReactNode | null
  /** 覆盖的 pageId（诊断/一致性 guard；绝不替代 `render` 的判定）。 */
  pageIds: () => readonly string[]
}

/** 受控 IPC 的最小形状（结构子集；缺一即视为「没有页面数据能力」并 fail closed）。 */
export type DetachedPagePlatform = {
  settings: { get: () => Promise<unknown>; update: (patch: unknown) => Promise<unknown> }
  modelProviders: { list: () => Promise<unknown> }
  storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }
}

/** 形状校验：不满足即返回 null（页窗绝不自造数据）。 */
export function readDetachedPagePlatform(host: unknown = globalThis): DetachedPagePlatform | null {
  const record = host as { platform?: unknown; localStorage?: unknown } | null
  const platform = record?.platform as Record<string, unknown> | undefined
  const settings = platform?.settings as Record<string, unknown> | undefined
  const modelProviders = platform?.modelProviders as Record<string, unknown> | undefined
  const storage = record?.localStorage as Partial<Storage> | undefined
  if (typeof settings?.get !== 'function' || typeof settings.update !== 'function') return null
  if (typeof modelProviders?.list !== 'function') return null
  if (typeof storage?.getItem !== 'function' || typeof storage.setItem !== 'function') return null
  const call = <T,>(target: Record<string, unknown>, name: string, ...args: unknown[]): T =>
    (target[name] as (...inner: unknown[]) => T).call(target, ...args)
  return {
    settings: { get: () => Promise.resolve(call<Promise<unknown>>(settings, 'get')), update: (patch) => Promise.resolve(call<Promise<unknown>>(settings, 'update', patch)) },
    modelProviders: { list: () => Promise.resolve(call<Promise<unknown>>(modelProviders, 'list')) },
    storage: {
      getItem: (key) => call<string | null>(storage as Record<string, unknown>, 'getItem', key),
      setItem: (key, value) => { call<void>(storage as Record<string, unknown>, 'setItem', key, value) }
    }
  }
}

/** 页窗页面数据：一次受控读取 + 受控写回；失败即 fail closed（不猜、不回退主窗状态）。 */
function useDetachedPageData() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  // 可变数组：既有页面 props 形状要求 `T[]`（不是 readonly）
  const [providers, setProviders] = useState<SafeModelProvider[]>([])
  const [pinnedModelIds, setPinnedModelIds] = useState<string[]>([])

  useEffect(() => {
    const api = readDetachedPagePlatform()
    if (api === null) { setStatus('failed'); return }
    let cancelled = false
    void Promise.all([api.settings.get(), api.modelProviders.list()]).then(([rawSettings, rawProviders]) => {
      if (cancelled) return
      if (typeof rawSettings !== 'object' || rawSettings === null) { setStatus('failed'); return }
      setSettings(rawSettings as AppSettings)
      setProviders(Array.isArray(rawProviders) ? rawProviders as SafeModelProvider[] : [])
      setPinnedModelIds(parsePinnedModelIds(api.storage.getItem(PINNED_MODEL_IDS_STORAGE_KEY)))
      setStatus('ready')
    }).catch(() => { if (!cancelled) setStatus('failed') })
    return () => { cancelled = true }
  }, [])

  const updateSettings = useCallback(async (patch: AppSettingsPatch): Promise<void> => {
    const api = readDetachedPagePlatform()
    if (api === null) return
    const next = await api.settings.update(patch)
    if (typeof next === 'object' && next !== null) setSettings(next as AppSettings)
  }, [])

  const togglePin = useCallback((modelId: string): void => {
    const api = readDetachedPagePlatform()
    if (api === null) return
    setPinnedModelIds((current) => {
      const next = togglePinnedModelId(current, modelId)
      api.storage.setItem(PINNED_MODEL_IDS_STORAGE_KEY, serializePinnedModelIds(next))
      return next
    })
  }, [])

  return { status, settings, providers, pinnedModelIds, updateSettings, togglePin }
}

/** 加载/失败态：只报状态、绝不渲染假正文（`data-page-body-status` 供诊断）。 */
function DetachedPageStatus({ language, status }: { language: AppLanguage; status: 'loading' | 'failed' }): React.ReactElement {
  const text = platformText[language]
  return (
    <section className="workspace-page-body-status" data-page-body-status={status}>
      {status === 'loading'
        ? <LoadingState label={text.status.loading} fill />
        : <p role="status">{text.status.failed}</p>}
    </section>
  )
}

/** 内置 `assistants` 页正文（页窗版）：真实 `AssistantPage`，数据与订阅全走受控 IPC。 */
function DetachedAssistantBody({ language }: { language: AppLanguage }): React.ReactElement {
  const data = useDetachedPageData()
  if (data.status !== 'ready') return <DetachedPageStatus language={language} status={data.status} />
  if (data.settings === null) return <DetachedPageStatus language={language} status="failed" />
  return (
    <AssistantPage
      language={language}
      providers={data.providers}
      chatSettings={data.settings.chat}
      pinnedModelIds={data.pinnedModelIds}
      openRequest={null}
    />
  )
}

/** 内置 `agents` 页正文（页窗版）：真实 `AgentPage`，状态/运行时增量来自 `agents.*` 订阅。 */
function DetachedAgentBody({ language }: { language: AppLanguage }): React.ReactElement {
  const data = useDetachedPageData()
  if (data.status !== 'ready') return <DetachedPageStatus language={language} status={data.status} />
  if (data.settings === null) return <DetachedPageStatus language={language} status="failed" />
  return (
    <AgentPage
      language={language}
      agentSettings={data.settings.agent}
      chatSettings={data.settings.chat}
      providers={data.providers}
      pinnedModelIds={data.pinnedModelIds}
      onUpdateSettings={data.updateSettings}
    />
  )
}

/** 页窗可完整交互的设置面板（正文由各自受控 IPC 驱动）。 */
const DETACHED_SETTINGS_PANELS = Object.freeze([
  'assistant-library', 'web-search', 'storage-cache', 'task-automation', 'notifications'
])
/** 主窗 shell 专属面板（正文由 AppShell 内部状态持有）：页窗不复制，给边界元素。 */
const HOST_ONLY_SETTINGS_PANELS = Object.freeze(['models', 'preferences'])
const DEFAULT_DETACHED_SETTINGS_PANEL = 'web-search'

/** 内置 `settings` 页正文（页窗版）：真实导航 + 真实面板；分组复用 shell 同一投影，不复制菜单顺序。 */
function DetachedSettingsBody({ language, settingsPanelEntries }: {
  language: AppLanguage
  settingsPanelEntries: readonly GeneratedProductSettingsEntry[]
}): React.ReactElement {
  const data = useDetachedPageData()
  const text = platformText[language]
  const [panelKey, setPanelKey] = useState(DEFAULT_DETACHED_SETTINGS_PANEL)
  const groups = groupShellSettingsPanels(language, settingsPanelEntries)
  const productEntry = findProductSettingsEntry(panelKey, settingsPanelEntries)
  if (data.status !== 'ready') return <DetachedPageStatus language={language} status={data.status} />
  if (data.settings === null) return <DetachedPageStatus language={language} status="failed" />
  const settings = data.settings

  return (
    <div className="settings-layout" data-page-body-panel={panelKey}>
      <aside className="settings-nav" aria-label={text.nav.settings}>
        {groups.map((group) => (
          <section key={group.id} className="settings-nav-group" aria-label={group.title ?? undefined}>
            {group.title ? <div className="settings-nav-group-title">{group.title}</div> : null}
            {group.panels.map((panel) => {
              const Icon = panel.icon
              return (
                <button
                  key={panel.key}
                  type="button"
                  className={panelKey === panel.key ? 'settings-nav-item active' : 'settings-nav-item'}
                  onClick={() => setPanelKey(panel.key)}>
                  <Icon size={17} />
                  <span>{panel.label}</span>
                </button>
              )
            })}
          </section>
        ))}
      </aside>

      {productEntry ? (
        <ProductContributionHost
          language={language}
          load={productEntry.load}
          title={resolveLocalizedTitle(productEntry.title, language)}
        />
      ) : null}
      {isBuiltInSettingsPanelId(panelKey) && panelKey === 'assistant-library'
        ? <AssistantLibrarySettingsPage language={language} onManageAssistants={() => undefined} /> : null}
      {isBuiltInSettingsPanelId(panelKey) && panelKey === 'web-search' ? <WebSearchSettingsPage language={language} /> : null}
      {isBuiltInSettingsPanelId(panelKey) && panelKey === 'storage-cache' ? <StorageCacheSettingsPage language={language} /> : null}
      {isBuiltInSettingsPanelId(panelKey) && panelKey === 'task-automation' ? <TaskAutomationSettingsPage language={language} /> : null}
      {isBuiltInSettingsPanelId(panelKey) && panelKey === 'channels' ? <ChannelSettingsPage language={language} /> : null}
      {isBuiltInSettingsPanelId(panelKey) && panelKey === 'notifications' ? (
        <NotificationSettingsPane
          title={text.settings.notifications}
          notice={null}
          settings={settings.notifications}
          labels={text.notifications}
          onChange={(patch) => void data.updateSettings({ notifications: patch })}
        />
      ) : null}
      {HOST_ONLY_SETTINGS_PANELS.includes(panelKey) ? (
        // 明确边界：正文由主窗 shell 持有，页窗不复制、不伪造；文案复用既有成对 i18n 安全壳键
        <section className="settings-workspace" data-page-panel="host-only" role="note"><p>{text.workspace.tabPageMissing}</p></section>
      ) : null}
    </div>
  )
}

/**
 * 页面正文 dispatcher（**唯一**「哪个 pageId 渲染什么」的派发表，两窗共用）：主窗由组合根注入
 * 内置页 mounts（含 AppShell 内部 Settings 正文）；不传 mounts ⇒ 用页窗 mounts（正文只来自受控 IPC）。
 * 未命中内置页时按 `menuKey`（产品路由路径）解析产品页 loader；都不命中 ⇒ null（调用方 fail closed）。
 */
export function createWorkspacePageContentProvider(options: {
  mounts?: BuiltInPageMounts
  menuEntries?: readonly GeneratedProductMenuEntry[]
  settingsPanelEntries?: readonly GeneratedProductSettingsEntry[]
} = {}): WorkspacePageContentProvider {
  const builtIn = createBuiltInPageAdapters()
  const menuEntries = options.menuEntries ?? productMenuEntries
  const settingsPanelEntries = options.settingsPanelEntries ?? productSettingsEntries
  /**
   * 页窗正文 mounts：**每次 render 用本次入参语言现构**（判据与 P2-11 的 `pageMountsRef` 完全相同）。
   *
   * 本 provider 被页窗以 `useMemo(() => createWorkspacePageContentProvider(), [])` **长期持有**（跨窗口/跨挂载），
   * 因此绝不允许把渲染期值（这里是窗口级受控语言 `context.preferences.language`）写进实例级可变变量再由
   * mounts 闭包读取 —— 那正是 P2-11「正文冻结在 provider 创建那次渲染」的同一形态。语言只在本调用内使用，
   * 不留下任何实例状态；产品页分支一直用 `render` 入参，与此保持一致。
   */
  const detachedMountsFor = (language: AppLanguage): BuiltInPageMounts => ({
    assistants: () => <DetachedAssistantBody language={language} />,
    agents: () => <DetachedAgentBody language={language} />,
    settings: () => <DetachedSettingsBody language={language} settingsPanelEntries={settingsPanelEntries} />
  })
  return Object.freeze({
    render({ pageId, menuKey, language }): ReactNode | null {
      const builtInPageId = builtIn.list().find((candidate) => candidate === pageId)
      if (builtInPageId !== undefined) {
        const mounts = options.mounts ?? detachedMountsFor(language)
        return (
          <div className="workspace-page-body" data-page-body={pageId}>
            {builtIn.render(builtInPageId, mounts)}
          </div>
        )
      }
      const entry = findProductMenuEntry(menuKey, menuEntries)
      if (entry === undefined) return null
      return (
        <div className="workspace-page-body" data-page-body={pageId}>
          <ProductContributionHost language={language} load={entry.load} title={resolveLocalizedTitle(entry.title, language)} />
        </div>
      )
    },
    pageIds: () => Object.freeze([...builtIn.list(), ...menuEntries.map((entry) => entry.routePath)])
  })
}

/** 页窗可完整交互 / 仅边界呈现的设置面板（诊断与回交证据用）。 */
export const DETACHED_SETTINGS_PANEL_POLICY = Object.freeze({
  interactive: DETACHED_SETTINGS_PANELS,
  hostOnly: HOST_ONLY_SETTINGS_PANELS
})
