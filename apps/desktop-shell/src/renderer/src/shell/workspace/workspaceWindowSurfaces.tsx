import { useEffect, useState, type ReactNode } from 'react'

import { isAppLanguage, type AppLanguage } from '@platform/settings/schema/appSettings'
import type {
  WorkspacePanelRegistration,
  WorkspacePanelResult,
  WorkspacePendingTransferView,
  WorkspaceSize,
  WorkspaceSnapshot
} from '@platform/workspace/contracts'
import { WorkspaceRegistrationPolicy } from '@platform/workspace/policies'
import { LoadingSpinner } from '@platform/ui/components/loading'
import { platformText } from '../../i18n/platformText'
import { FileText } from 'lucide-react'
import { useWindowDocumentTitle, WorkspaceWindowTopBar } from './workspaceWindowTopBar'
import { PanelWindowRedockControl } from './PanelWindowRedockControl'
import type { WorkspacePanelView } from './WorkspacePanelHost'
import { createWorkspaceContentAdapter, type WorkspaceContentAdapter } from './workspaceHostAdapter'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import type { WorkspaceHostContext, WorkspaceHostMount } from './workspaceClient'

/**
 * Owner: apps/desktop-shell renderer / workspace —— 窗口根的**呈现面与壳**。
 *
 * PLAT-02（行数纪律）：这些呈现面原先都内联在 `WorkspaceWindowRoot.tsx`（706 行，>500 建议线）。
 * 它们只被窗口根消费、彼此同族，因此整体搬到本文件；`WorkspaceWindowRoot.tsx` 只保留角色判定、
 * ACK 链与页面窗根的守卫面（那两个源码守卫要求 `createWorkspacePageContentProvider` /
 * `WorkspacePageHost` / `className="workspace-window-shell workspace-window-page"` 仍在原文件里）。
 *
 * 搬运纪律：**只有位置变了**——判据文案、DOM 结构、class、内联样式、fail-closed 姿态一字未改；
 * 回归由既有测试取证（workspacePageWindowLayout.test.tsx P2-14、WorkspaceWindowRoot.test.tsx 的
 * error-shell / 准备期壳 / 主题 / 语言用例、workspacePageContentProvider.test.tsx 等）。
 */

/** 面板内容注入的解析输入：只带受控的 mount 标识与注册信息，绝不带面板内容/路径/密钥。 */
export type WorkspacePanelContentInput = {
  mount: WorkspaceHostMount
  registration: WorkspacePanelRegistration
  language: AppLanguage
}

/** 源侧内容适配器的解析输入：只带受控的 panel 标识与注册信息，绝不带面板内容/路径/密钥。 */
export type WorkspacePanelAdapterInput = {
  panelInstanceKey: string
  panelId: string
  registration: WorkspacePanelRegistration
  language: AppLanguage
}

/** 只有「上下文声明的挂载」且「权威快照里真实存在」的面板才可承载；否则 fail closed。 */
export function hostableMounts(context: WorkspaceHostContext, snapshot: WorkspaceSnapshot): readonly WorkspaceHostMount[] {
  const panelKeys = new Set(snapshot.panels.map((panel) => panel.panelInstanceKey))
  return context.mounts.filter((mount) => panelKeys.has(mount.panelInstanceKey)
    && snapshot.pageLayouts.some((layout) => layout.panelOrder.includes(mount.panelInstanceKey)))
}

export function placeholderRegistration(panelId: string): WorkspacePanelRegistration {
  return {
    panelId,
    title: { 'en-US': panelId, 'zh-CN': panelId },
    icon: 'panel-left',
    module: 'platform.shell.workspace',
    pageIds: [],
    supportedModes: WorkspaceRegistrationPolicy.modes,
    defaultMode: WorkspaceRegistrationPolicy.fallbackMode,
    allowMultipleInstances: false,
    minSize: WorkspaceRegistrationPolicy.minSize,
    preferredSize: WorkspaceRegistrationPolicy.preferredSize,
    binding: { persistence: 'none', maxKeyBytes: WorkspaceRegistrationPolicy.maxBindingKeyBytes },
    lifecycleEvents: []
  }
}

/** 安全空适配器：内容尚未接线时 prepare 恒 ready、release 恒 no-op（与 P1-03 之前的占位语义一致）。 */
export function placeholderAdapter(): WorkspaceContentAdapter {
  return createWorkspaceContentAdapter({ prepare: () => ({ status: 'ready' }), release: () => undefined })
}

function readViewportSize(pageMinSize: WorkspaceSize): WorkspaceSize {
  const width = typeof window === 'undefined' ? pageMinSize.width : window.innerWidth
  const height = typeof window === 'undefined' ? pageMinSize.height : window.innerHeight
  return { width: Math.max(width, pageMinSize.width), height: Math.max(height, pageMinSize.height) }
}

export function usePageSize(pageMinSize: WorkspaceSize): WorkspaceSize {
  const [size, setSize] = useState<WorkspaceSize>(() => readViewportSize(pageMinSize))
  useEffect(() => {
    const onResize = () => setSize(readViewportSize(pageMinSize))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [pageMinSize])
  return size
}

/**
 * **PLAT-29**：错误壳语言的有界重读周期（唯一时长来源，测试只引用这个常量，绝不另抄字面量）。
 * 错误壳没有可订阅的推送（见 `useErrorShellLanguage`），只能按这个周期拉取同源只读面。
 */
export const ERROR_SHELL_LANGUAGE_REFRESH_MS = 1000

/** 既有 preload 面（`platform.settings.get`）的结构子集；缺失即「没有设置只读面」⇒ 不读、不重试。 */
function readSettingsLanguageBridge(host: unknown = globalThis): { get: () => Promise<unknown> } | null {
  const platform = (host as { platform?: unknown } | null)?.platform as { settings?: unknown } | undefined
  const settings = platform?.settings as { get?: unknown } | undefined
  if (typeof settings?.get !== 'function') return null
  return { get: () => Promise.resolve((settings.get as () => Promise<unknown>).call(settings)) }
}

/**
 * **PLAT-29**：错误壳的语言来源与有界跟随。
 *
 * 错误壳窗口 = 受控 `getHostContext()` 被拒的窗口：它不在 workspace 归属图里，所以收不到 PLAT-10/28/31
 * 的受控 `snapshot` 事件（那两条链按归属/登记**定向**投递，未登记窗口零投递）。但它仍有一条**既有**
 * 且**与受控偏好同源**的只读面：`window.platform.settings.get()` —— Main 的
 * `getHostContext().preferences.language` 与它读的是**同一个** `settingsStore.get().language`
 * （`app.ts` 两处同源）。因此错误壳复用「准备期壳」的同一套语言投影（`isAppLanguage` 白名单 +
 * `platformText` 同一张表），只把取数口换成这条同源只读面：挂载即读一次，随后按
 * `ERROR_SHELL_LANGUAGE_REFRESH_MS` **有界重读**以跟随后续切换。
 *
 * 纪律：单个定时器、同时在飞至多一次读取、值未变不写 state、离开错误态立即清理；不读
 * URL/localStorage/OS；**不新增通道/preload 方法**。设置桥缺失 ⇒ 用调用方的 `fallbackLanguage`
 * （既有语义）；读取失败/白名单外 ⇒ 维持最后一次受控值（绝不因为一次失败渲染空白或未知语言）。
 */
export function useErrorShellLanguage(enabled: boolean, fallbackLanguage: AppLanguage): AppLanguage {
  const [controlled, setControlled] = useState<AppLanguage | null>(null)
  useEffect(() => {
    if (!enabled) return undefined
    const bridge = readSettingsLanguageBridge()
    if (bridge === null) return undefined
    let cancelled = false
    let reading = false
    const refresh = async (): Promise<void> => {
      if (reading) return
      reading = true
      try {
        const value = await bridge.get()
        if (cancelled) return
        const next = (value as { language?: unknown } | null)?.language
        if (isAppLanguage(next)) setControlled((previous) => (previous === next ? previous : next))
      } catch {
        // 一次读取失败只维持当前文案：绝不因此重试风暴，也绝不把错误壳换成空白
      } finally {
        reading = false
      }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, ERROR_SHELL_LANGUAGE_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled, fallbackLanguage])
  return controlled ?? fallbackLanguage
}

/**
 * 面板 views 构造（P1-06c 注册信息 + 注入 provider）。views 每次渲染重建：内容与适配器都无状态；
 * 未在注入注册表里的挂载退回**安全占位注册 + 空适配器**（绝不因为缺注入而跳过承载或假装已释放），
 * 注入 provider 返回 null 时退回成对 i18n 占位正文（绝不伪造内容）。
 */
export function buildPanelViews(input: {
  mounts: readonly WorkspaceHostMount[]
  language: AppLanguage
  registrations?: readonly WorkspacePanelRegistration[]
  renderPanelContent?: (input: WorkspacePanelContentInput) => ReactNode | null
  resolvePanelAdapter?: (input: WorkspacePanelAdapterInput) => WorkspaceContentAdapter | null
}): Record<string, WorkspacePanelView> {
  const labels = platformText[input.language].workspace
  const views: Record<string, WorkspacePanelView> = {}
  for (const mount of input.mounts) {
    const registration = input.registrations?.find((item) => item.panelId === mount.panelId)
      ?? placeholderRegistration(mount.panelId)
    const injected = input.renderPanelContent?.({ mount, registration, language: input.language }) ?? null
    views[mount.panelInstanceKey] = {
      registration,
      title: registration.title[input.language],
      content: injected ?? <p className="workspace-panel-placeholder">{labels.windowPanelPlaceholder}</p>,
      adapter: input.resolvePanelAdapter?.({
        panelInstanceKey: mount.panelInstanceKey, panelId: mount.panelId, registration, language: input.language
      }) ?? placeholderAdapter()
    }
  }
  return views
}

/**
 * 安全 error-shell（P1-06h / N2）：语言只取 AppShell 传来的**当前语言**兜底（白名单外一律回退 en-US），
 * 样式来自 `workspaceLayout.css` 的 `.workspace-window-error`（只用主题变量）。
 */
export function WorkspaceErrorShell({ language, reason }: { language: AppLanguage; reason: 'context-unavailable' | 'panel-unmounted' }): React.ReactElement {
  const labels = platformText[language].workspace
  return (
    <section
      className="workspace-window-shell workspace-window-error"
      role="alert"
      aria-label={labels.windowHostUnavailableTitle}
      data-window-shell="error"
    >
      <h1>{labels.windowHostUnavailableTitle}</h1>
      <p>{reason === 'panel-unmounted' ? labels.windowHostUnavailablePanel : labels.windowHostUnavailableContext}</p>
      <p className="workspace-window-shell-hint">{labels.windowHostUnavailableHint}</p>
    </section>
  )
}

/**
 * 待接管目标的准备期界面：不是错误壳，也不伪造面板帧。正文走 i18n（P1-06h 新增独立文案），
 * `data-transfer-phase` 只用于诊断（reserved/in-flight 相位）；样式来自 `.workspace-window-preparing`。
 */
export function WorkspacePreparingShell({ language, title, transfer }: {
  language: AppLanguage
  title: string
  transfer: WorkspacePendingTransferView
}): React.ReactElement {
  const text = platformText[language]
  return (
    <section
      className="workspace-window-shell workspace-window-preparing"
      role="status"
      aria-label={title}
      data-window-shell="preparing"
      data-pending-panel={transfer.panelInstanceKey}
      data-transfer-phase={transfer.status === 'in-flight' ? transfer.phase : 'reserved'}
    >
      <h1>{title}</h1>
      <p>{text.workspace.windowPreparingDetail}</p>
      <p className="workspace-window-shell-hint"><LoadingSpinner size="sm" />{text.status.loading}</p>
    </section>
  )
}

/**
 * 独立面板窗口的内容面：窗口本身就是这个面板的容器（原生标题栏由 Main 设置，回停靠走原生 X），
 * 因此不再套页面级区域布局（`WorkspacePanelHost` 的 embedded/right/bottom 轨道只服务「页面 + 停靠面板」，
 * 它有意不承载 detached 面板），也**绝不**把 detached 伪造成某个停靠模式。
 * 内容仍只来自注入 provider / 安全占位视图；样式只用主题变量，不引入第二套调色板。
 */
export function WorkspaceDetachedPanelSurface({ mounts, views, timeZone, language, redock }: {
  mounts: readonly WorkspaceHostMount[]
  views: Readonly<Record<string, WorkspacePanelView>>
  timeZone: string
  /** 当前语言（顶栏回停靠入口的 i18n 来源；缺省不渲染入口，绝不伪造文案）。 */
  language?: AppLanguage
  /** **PLAT-40**：受控回停靠端口（复用既有 `workspace.command` 的 `redockPanel`）；缺省 ⇒ 无入口。 */
  redock?: (input: { panelInstanceKey: string }) => Promise<WorkspacePanelResult>
}): React.ReactElement {
  /**
   * PLAT-39 ①：面板窗与页窗**同一份自绘顶栏**（同高、同 token、同为拖拽区），承载面板名；
   * 并设置原生标题（`document.title`）。面板名优先用注册信息（`view.title`），
   * 生产环境分离窗拿不到注册表 ⇒ 退回 `panelId`（如实，不伪造文案）。
   */
  const title = mounts.length === 1
    ? (views[mounts[0].panelInstanceKey]?.title ?? mounts[0].panelId)
    : (views[mounts[0]?.panelInstanceKey ?? '']?.title ?? mounts[0]?.panelId ?? '')
  useWindowDocumentTitle(title)
  /** PLAT-40：只有「恰好一个已提交面板」时才有唯一的回停靠目标（多面板/准备期一律不提供入口）。 */
  const redockPanelKey = mounts.length === 1 ? mounts[0]?.panelInstanceKey ?? null : null
  const topBarActions = language !== undefined && redockPanelKey !== null
    ? <PanelWindowRedockControl language={language} panelInstanceKey={redockPanelKey} {...(redock === undefined ? {} : { redock })} />
    : null
  // PLAT-37：布局/配色全部由 `.workspace-panel-window` 承载（内联样式不得再声明高度，
  // 否则「容器没有高度 ⇒ 1fr 行退化成内容高度」这条根因会被第二处来源掩盖）。
  return (
    <ShellTimeZoneProvider timeZone={timeZone}>
    <div className="workspace-panel-window">
      <WorkspaceWindowTopBar title={title} icon={FileText} actions={topBarActions} />
      {mounts.map((mount) => {
        const view = views[mount.panelInstanceKey]
        return (
          <section
            key={mount.panelInstanceKey}
            className="workspace-panel-surface"
            data-panel-key={mount.panelInstanceKey}
            data-dock={mount.mode}
            aria-label={view?.title ?? mount.panelId}
          >
            {view?.content ?? null}
          </section>
        )
      })}
    </div>
    </ShellTimeZoneProvider>
  )
}
