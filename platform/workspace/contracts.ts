import type { LocalizedText } from '../product-manifest'

export type PanelContainerMode = 'embedded' | 'docked-right' | 'docked-bottom' | 'detached'
export type BindingPolicy = { persistence: 'none' | 'session' | 'durable'; maxKeyBytes: number }
export type WorkspaceSize = { width: number; height: number }
export type WorkspaceBounds = WorkspaceSize & { x: number; y: number }
export type WorkspaceHost = { windowInstanceId: string; hostEpoch: number }
export type WorkspaceTarget = { workspaceInstanceKey: string; panelInstanceKey?: string }
export type WorkspaceTransferPhase =
  | 'awaiting-source-prepared'
  | 'awaiting-target-ready'
  | 'awaiting-source-release'
  | 'awaiting-commit'
export type WorkspacePanelSnapshot = WorkspaceTarget & {
  panelInstanceKey: string
  panelId: string
  open: boolean
  mode: PanelContainerMode
  presentation: 'normal' | 'overlay' | 'exclusive'
  bindingState: 'bound' | 'unavailable'
  windowInstanceId: string | null
  hostEpoch: number
  lastValidDock: Exclude<PanelContainerMode, 'detached'>
  dockSize?: WorkspaceSize
  detachedBounds?: WorkspaceBounds
  transfer?: { operationId: string; phase: WorkspaceTransferPhase }
}

/**
 * 受控「待接管目标」视图（P1-06f 授权的新增导出；既有导出形状一律未改）。
 * 只有被 Main 预留的**待接管目标宿主**能通过 `getHostContext` 拿到它：
 *  - `reserved`：窗口已预留、飞事务尚未建立（此时还没有 operationId，renderer 只能等，绝不猜身份）；
 *  - `in-flight`：权威快照里的飞事务（operationId 与相位逐字来自 store）。
 * 它**不是**布局权限：`mounts`/快照仍按归属过滤，未参与转移的窗口永远拿不到任何形状的该视图。
 */
export type WorkspacePendingTransferView =
  | { status: 'reserved'; workspaceInstanceKey: string; panelInstanceKey: string; panelId: string }
  | {
      status: 'in-flight'
      operationId: string
      phase: WorkspaceTransferPhase
      workspaceInstanceKey: string
      panelInstanceKey: string
      panelId: string
    }
export type WorkspacePageLayout = {
  workspaceInstanceKey: string
  panelOrder: readonly string[]
  activePanels: Partial<Record<Exclude<PanelContainerMode, 'detached'>, string>>
}
export type WorkspaceSnapshot = {
  layoutRevision: number
  activeWorkspaceInstanceKey: string | null
  panels: readonly WorkspacePanelSnapshot[]
  pageLayouts: readonly WorkspacePageLayout[]
  tabs: readonly []
  persistenceState: 'saved' | 'pending' | 'failed'
}
export type WorkspaceCommandResult = {
  status: 'applied' | 'rejected'
  snapshot: WorkspaceSnapshot
  errorCode?: 'stale-revision' | 'not-owner' | 'invalid-request' | 'registration-missing' | 'limit-reached'
    | 'transfer-in-progress' | 'main-window-closing' | 'unsupported'
}
export type WorkspaceWorkspaceResult = WorkspaceCommandResult & {
  workspaceInstanceKey: string
  hostEpoch: number
}
export type WorkspacePanelResult = WorkspaceCommandResult & { panelInstanceKey: string }
export type WorkspaceLifecycleEventType =
  | 'open' | 'close' | 'restore' | 'host-attach' | 'host-detach' | 'host-reparent'
  | 'container-change-requested' | 'container-changing' | 'container-changed' | 'fallback'

/**
 * 技术设计 §4 的回退原因词汇（P1-06 授权的新增导出；既有导出形状一律未改）。
 * Main 侧窗口宿主用它自己的 `DetachedHostOutcome`，由 IPC 层映射到本词汇。
 */
export type WorkspaceFallbackReason =
  | 'unsupported' | 'window-create-failed' | 'window-load-failed' | 'window-crashed'
  | 'window-unresponsive' | 'screen-unavailable' | 'bounds-invalid' | 'main-window-closing'
  | 'narrow-screen' | 'registration-missing' | 'binding-unavailable' | 'restore-invalid' | 'content-error'

/** 布局事件的定向范围：内容事件必须带 workspace/panel，主题与语言可全局（scope 为空）。 */
export type WorkspaceEventScope = { workspaceInstanceKey?: string; panelInstanceKey?: string }
/**
 * Main → renderer 的布局事件信封。`layoutRevision` **必须**由调用方从 runtime store 读真实值，
 * 不得自造；`fallbackReason` 只在容器回退时出现。
 */
export type WorkspaceEvent = {
  type: WorkspaceLifecycleEventType | 'snapshot' | 'persistence-state'
  layoutRevision: number
  scope: WorkspaceEventScope
  hostEpoch?: number
  fallbackReason?: WorkspaceFallbackReason
  fallbackMode?: Exclude<PanelContainerMode, 'detached'>
}

export type WorkspacePanelRegistration = {
  panelId: string
  title: LocalizedText
  icon: string
  module: string
  pageIds: readonly string[]
  supportedModes: readonly PanelContainerMode[]
  defaultMode: Exclude<PanelContainerMode, 'detached'>
  allowMultipleInstances: boolean
  minSize: WorkspaceSize
  preferredSize: WorkspaceSize
  binding: BindingPolicy
  lifecycleEvents: readonly WorkspaceLifecycleEventType[]
}

export type WorkspacePanelSummary = { id: string; kind: 'panel'; title: Readonly<LocalizedText> }

export type WorkspacePreparation =
  | { status: 'ready'; handoff?: JsonValue }
  | { status: 'handoff-required'; reason: 'unsaved-content' | 'sensitive-draft' | 'unsupported-handoff' }

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type WorkspaceRegistrationErrorCode =
  | 'invalid-registration' | 'duplicate-registration' | 'registry-sealed' | 'registry-not-sealed'

export class WorkspaceRegistrationError extends Error {
  constructor(readonly code: WorkspaceRegistrationErrorCode, readonly field?: string) {
    super(field ? `${code}: ${field}` : code)
    this.name = 'WorkspaceRegistrationError'
  }
}

/**
 * P2-01：一级菜单页面的统一描述注册（registry 权威；shell 只做本地 loader 投影，不作为 Main 的信任来源）。
 * 内置页与产品页的可见文案 owner 不同，因此**只能有一个**来源：
 *  - `titleKey`：平台 shell 文案键（如 `nav.assistants`），可见文案仍在 shell 的 platformText；
 *  - `title`：产品 manifest 的双语标题（产品页）。
 * `menuKey` 是 shell 一级菜单键（内置页 = pageId；产品页 = 产品路由路径）。
 */
export type WorkspacePageRegistration = {
  pageId: string
  menuKey: string
  title?: LocalizedText
  titleKey?: string
  icon: string
  module: string
  productId?: string
  supportsDetached: boolean
  allowMultipleInstances: boolean
  binding: BindingPolicy
}

/** 只投影安全字段：不含 binding 键、不含 loader、不含产品数据。 */
export type WorkspacePageSummary = {
  id: string
  kind: 'page'
  menuKey: string
  title?: LocalizedText
  titleKey?: string
  supportsDetached: boolean
  allowMultipleInstances: boolean
}

/** 技术设计 §5.4 的 Tab 视图；`workspaceInstanceKey` 由 Main 分配，不复用容器身份。 */
export type WorkspaceTabMode = 'main' | 'detached'
export type WorkspaceTabSnapshot = {
  workspaceInstanceKey: string
  pageId: string
  menuKey: string
  open: boolean
  order: number
  mode: WorkspaceTabMode
  bindingState: 'bound' | 'unavailable'
  windowInstanceId: string
  hostEpoch: number
}
export type WorkspaceTabState = {
  layoutRevision: number
  activeWorkspaceInstanceKey: string | null
  tabs: readonly WorkspaceTabSnapshot[]
  /**
   * P2-13（additive，可选）：该窗**有权看到**的「最近关闭」条数，由 Main 从真实 `workspaceTabStore`
   * 派生（主窗＝真实条数；其它宿主＝0），**不是**持久化字段（§7：重启后 `recentlyClosed` 为空）。
   * renderer 只拿它驱动「重开最近关闭」入口的禁用态，绝不据此推断布局；缺省/畸形一律按「无」。
   */
  recentlyClosedCount?: number
}
/** 最近关闭视图：只有逻辑身份与容器，**不含** binding 键。 */
export type WorkspaceTabRecentlyClosed = {
  workspaceInstanceKey: string
  pageId: string
  menuKey: string
  mode: WorkspaceTabMode
}
export type WorkspaceTabErrorCode = NonNullable<WorkspaceCommandResult['errorCode']>
export type WorkspaceTabCommandResult = {
  status: 'applied' | 'rejected'
  snapshot: WorkspaceTabState
  errorCode?: WorkspaceTabErrorCode
  workspaceInstanceKey?: string
}
