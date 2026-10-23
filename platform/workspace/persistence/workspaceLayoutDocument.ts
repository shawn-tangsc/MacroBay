import type { WorkspaceBounds, WorkspaceTabMode } from '../contracts'
import { WorkspaceTabPolicy } from '../policies'
import {
  WorkspaceLayoutBudgetPolicy,
  prunePanelLayoutDocument,
  validatePanelLayoutDocument,
  type PanelLayoutDocumentV1,
  type PanelLayoutRejectionReason,
  type StoredPanel,
  type StoredWorkspace
} from './panelLayoutDocument'

/**
 * Owner: platform/workspace/persistence。权威：技术设计 §7 Storage Plan（Phase 2 = schemaVersion 2）/ §8 Growth Plan。
 *
 * 本模块只描述 **v2 文档形状**：v1 的面板载荷（`workspaces`/`panels`）原样保留，额外增加 Tab 载荷
 * （`tabs` + `activeWorkspaceInstanceKey`）。为了不重写已 Accepted 的 v1 语义，`workspaces`/`panels`
 * 的校验**完全复用** `validatePanelLayoutDocument`（把 v2 输入投影成 v1 形状再交给它），
 * 因此 v1 的字段白名单、禁用字段扫描、单条 4 KiB 与 1 MiB 预算一条都不会被放宽。
 *
 * 与 §7 草图的唯一偏差（必要且已记录）：`StoredTab` 必须带 `pageId`。没有 `pageId` 就无法执行 §7 的
 * 「已卸载注册只剪掉对应 workspace/panel」和 `_restoreTabs` 的注册校验；`menuKey` 仍由注册表按 pageId
 * 派生，不落盘。Tab **不落盘 binding**（§7 的 v2 类型无 binding 字段，且 §7 明确「session key 不得藏在
 * 实例 ID 中」）：重启后 durable/session 页面的内容绑定由承载宿主重新补绑（`sessionReboundWithoutDuplicate`）。
 */

export const WorkspaceLayoutSchemaVersionV2 = 2 as const

export type StoredTab = {
  workspaceInstanceKey: string
  pageId: string
  open: boolean
  order: number
  mode: WorkspaceTabMode
  detachedBounds?: WorkspaceBounds
}
export type WorkspaceLayoutDocumentV2 = {
  schemaVersion: 2
  savedAt: string
  layoutRevision: number
  workspaces: readonly StoredWorkspace[]
  panels: readonly StoredPanel[]
  tabs: readonly StoredTab[]
  activeWorkspaceInstanceKey: string | null
}

export type WorkspaceLayoutValidationV2 =
  | { status: 'ok'; document: WorkspaceLayoutDocumentV2 }
  | { status: 'rejected'; reason: PanelLayoutRejectionReason }

/** Tab 只允许出现这些键：多出来的键一律拒绝，绝不让未知字段夹带内容落盘。 */
const TAB_FIELDS = Object.freeze(['workspaceInstanceKey', 'pageId', 'open', 'order', 'mode', 'detachedBounds'])
const TAB_MODES = Object.freeze<readonly WorkspaceTabMode[]>(['main', 'detached'])
const MAX_ID_LENGTH = 200

function rejected(reason: PanelLayoutRejectionReason): WorkspaceLayoutValidationV2 {
  return { status: 'rejected', reason }
}

/** 与 v1 同一姿态：拒绝数组与访问器属性（抛错 getter 不得穿透校验进入写入路径）。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.keys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && 'value' in descriptor
  })
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && !/[\u0000-\u001f\u007f]/u.test(value)
}

function isBounds(value: unknown): value is WorkspaceBounds {
  if (!isPlainRecord(value)) return false
  const { x, y, width, height } = value
  const finite = (metric: unknown): boolean => typeof metric === 'number' && Number.isFinite(metric)
  const positive = (metric: unknown): boolean => finite(metric) && (metric as number) > 0
  return finite(x) && finite(y) && positive(width) && positive(height)
}

/**
 * PLAT-04：Tab 的 `detachedBounds` 是**可丢的布局提示**，不是文档结构。
 *  - 合法 ⇒ 逐字保留（只取 4 个尺寸项；未知子键一律被剥掉，绝不夹带落盘）；
 *  - 畸形/缺失（NaN / Infinity / 负数 / 0 / 非对象 / 缺字段）⇒ 只丢**这一个字段**并保留 Tab：
 *    运行期因此回落到 `WorkspaceDetachedWindowPolicy` 默认尺寸并在工作区内夹紧，
 *    绝不因为一个尺寸让整份布局失效（那会把用户整个工作区打成 protected）。
 * 「未知 `schemaVersion` 最先判定、原文件绝不覆写」的保护语义不受本函数影响（见 validate 的判定顺序）。
 */
function readTabBounds(value: unknown): WorkspaceBounds | undefined {
  if (!isBounds(value)) return undefined
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}

function readTab(value: unknown): StoredTab | null {
  if (!isPlainRecord(value)) return null
  if (!Object.keys(value).every((key) => TAB_FIELDS.includes(key))) return null
  if (!isSafeId(value.workspaceInstanceKey) || !isSafeId(value.pageId)) return null
  if (typeof value.open !== 'boolean') return null
  if (typeof value.order !== 'number' || !Number.isSafeInteger(value.order) || value.order < 0) return null
  if (typeof value.mode !== 'string' || !TAB_MODES.includes(value.mode as WorkspaceTabMode)) return null
  const detachedBounds = readTabBounds(value.detachedBounds)
  return {
    workspaceInstanceKey: value.workspaceInstanceKey, pageId: value.pageId,
    open: value.open, order: value.order, mode: value.mode as WorkspaceTabMode,
    ...(detachedBounds === undefined ? {} : { detachedBounds })
  }
}

/**
 * v2 校验：先校验 v2 独有的两个字段，再把 `workspaces`/`panels` 投影成 v1 交回已 Accepted 的校验器。
 * 顺序很关键——`unknown-schema-version` 必须最先判定，未知版本绝不能被当成「缺字段」而进入写入路径。
 */
export function validateWorkspaceLayoutDocumentV2(input: unknown): WorkspaceLayoutValidationV2 {
  if (!isPlainRecord(input)) return rejected('not-an-object')
  if (input.schemaVersion !== WorkspaceLayoutSchemaVersionV2) return rejected('unknown-schema-version')
  if (!Array.isArray(input.tabs)) return rejected('invalid-field')
  if (input.tabs.length > WorkspaceTabPolicy.maxOpenTabs) return rejected('page-limit-exceeded')
  const active = input.activeWorkspaceInstanceKey
  if (active !== null && !isSafeId(active)) return rejected('invalid-field')

  const panelProjection: Record<string, unknown> = {
    schemaVersion: 1, savedAt: input.savedAt, layoutRevision: input.layoutRevision,
    workspaces: input.workspaces, panels: input.panels
  }
  const panels = validatePanelLayoutDocument(panelProjection)
  if (panels.status === 'rejected') return rejected(panels.reason)

  const tabs: StoredTab[] = []
  const seen = new Set<string>()
  for (const entry of input.tabs) {
    const tab = readTab(entry)
    if (!tab) return rejected('invalid-field')
    if (seen.has(tab.workspaceInstanceKey)) return rejected('invalid-field')
    seen.add(tab.workspaceInstanceKey)
    tabs.push(tab)
  }
  const document: WorkspaceLayoutDocumentV2 = {
    schemaVersion: WorkspaceLayoutSchemaVersionV2,
    savedAt: panels.document.savedAt, layoutRevision: panels.document.layoutRevision,
    workspaces: panels.document.workspaces, panels: panels.document.panels,
    tabs, activeWorkspaceInstanceKey: active
  }
  if (documentByteSizeV2(document) > WorkspaceLayoutBudgetPolicy.maxDocumentBytes) return rejected('document-too-large')
  return { status: 'ok', document }
}

export function serializeWorkspaceLayoutDocumentV2(document: WorkspaceLayoutDocumentV2): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

/** 与 jsonFileStorage 落盘形态一致，因此这就是磁盘字节数。 */
export function documentByteSizeV2(document: WorkspaceLayoutDocumentV2): number {
  return Buffer.byteLength(serializeWorkspaceLayoutDocumentV2(document), 'utf8')
}

export function emptyWorkspaceLayoutDocumentV2(layoutRevision = 0, savedAt = new Date(0).toISOString()): WorkspaceLayoutDocumentV2 {
  return {
    schemaVersion: WorkspaceLayoutSchemaVersionV2, savedAt, layoutRevision,
    workspaces: [], panels: [], tabs: [], activeWorkspaceInstanceKey: null
  }
}

/**
 * 面板运行时的恢复端口仍是 v1 形状（`panelWorkspaceStore._restoreLayout`，P1-05 已 Accepted，本包不改它）。
 * 这是一个**端口投影**，不是持久化兼容分支：v2 只多出 Tab 载荷，面板载荷逐字相同。
 */
export function toPanelLayoutDocumentV1(document: WorkspaceLayoutDocumentV2): PanelLayoutDocumentV1 {
  return {
    schemaVersion: 1, savedAt: document.savedAt, layoutRevision: document.layoutRevision,
    workspaces: document.workspaces, panels: document.panels
  }
}

/** 非 durable 绑定（none/session）不得留在文档里：恢复/剪裁时逐条摘掉，其余布局不动。 */
export function dropNonDurableBindingsV2(
  document: WorkspaceLayoutDocumentV2,
  persistenceOf: (panelId: string) => 'none' | 'session' | 'durable' | undefined
): { document: WorkspaceLayoutDocumentV2; droppedBindings: number } {
  let droppedBindings = 0
  const panels = document.panels.map((panel) => {
    if (panel.binding === undefined) return panel
    if (persistenceOf(panel.panelId) === 'durable') return panel
    droppedBindings += 1
    const { binding: _dropped, ...rest } = panel
    return rest as StoredPanel
  })
  return { document: droppedBindings === 0 ? document : { ...document, panels }, droppedBindings }
}

export type WorkspaceLayoutPruneResultV2 = {
  document: WorkspaceLayoutDocumentV2
  prunedWorkspaces: number
  prunedPanels: number
  prunedTabs: number
}

/**
 * 卸载剪裁（§7）：注册里已消失的 page/panel 只剪掉**对应条目**，无关布局一份都不丢；
 * Tab 与其 active 键同步收敛，绝不留下指向已消失页面的活动项。
 */
export function pruneWorkspaceLayoutDocumentV2(
  document: WorkspaceLayoutDocumentV2,
  allowlist: { pageIds: ReadonlySet<string>; panelIds: ReadonlySet<string> }
): WorkspaceLayoutPruneResultV2 {
  const pruned = prunePanelLayoutDocument(toPanelLayoutDocumentV1(document), allowlist)
  const keptTabs = document.tabs.filter((tab) => allowlist.pageIds.has(tab.pageId))
  const keptKeys = new Set(keptTabs.map((tab) => tab.workspaceInstanceKey))
  const tabs = keptTabs.map((tab, index) => (tab.order === index ? tab : { ...tab, order: index }))
  const active = document.activeWorkspaceInstanceKey
  return {
    document: {
      ...document,
      workspaces: pruned.document.workspaces, panels: pruned.document.panels, tabs,
      activeWorkspaceInstanceKey: active !== null && keptKeys.has(active) ? active : (tabs.find((tab) => tab.open)?.workspaceInstanceKey ?? null)
    },
    prunedWorkspaces: pruned.prunedWorkspaces,
    prunedPanels: pruned.prunedPanels,
    prunedTabs: document.tabs.length - keptTabs.length
  }
}

export type WorkspaceLayoutBuildResultV2 =
  | { status: 'ok'; document: WorkspaceLayoutDocumentV2; droppedTabs: number }
  | { status: 'rejected'; reason: PanelLayoutRejectionReason }

/**
 * 单写出口（供 compose 把「面板载荷 + Tab 载荷」合成**唯一**一份 v2 文档）。
 * 平台布局 owner 只有本模块；合成期只做形状收敛，不做任何持久化决定。
 * 收敛规则（有界且不逐出活动实例，§8）：
 *  - 键非法/重复的 tab 丢弃并计数；
 *  - 超过 `maxOpenTabs` 时保留全部打开的 tab，再按输入顺序保留关闭记录，绝不逐出活动实例；
 *  - active 落在已消失/已关闭的 tab 上时回退到第一个打开的 tab，没有则 null。
 */
export function buildWorkspaceLayoutDocumentV2(input: {
  savedAt: string
  layoutRevision: number
  panelDocument: PanelLayoutDocumentV1
  tabs: readonly StoredTab[]
  activeWorkspaceInstanceKey: string | null
}): WorkspaceLayoutBuildResultV2 {
  const seen = new Set<string>()
  const accepted: StoredTab[] = []
  let droppedTabs = 0
  for (const tab of [...input.tabs].sort((left, right) => left.order - right.order)) {
    if (seen.has(tab.workspaceInstanceKey)) { droppedTabs += 1; continue }
    seen.add(tab.workspaceInstanceKey)
    accepted.push(tab)
  }
  const open = accepted.filter((tab) => tab.open)
  const closed = accepted.filter((tab) => !tab.open)
  const capped = [...open, ...closed].slice(0, WorkspaceTabPolicy.maxOpenTabs)
  droppedTabs += accepted.length - capped.length
  const tabs = capped.map((tab, index) => (tab.order === index ? tab : { ...tab, order: index }))
  const requested = input.activeWorkspaceInstanceKey
  const active = tabs.find((tab) => tab.workspaceInstanceKey === requested && tab.open)?.workspaceInstanceKey
    ?? tabs.find((tab) => tab.open)?.workspaceInstanceKey ?? null

  const validation = validateWorkspaceLayoutDocumentV2({
    schemaVersion: WorkspaceLayoutSchemaVersionV2, savedAt: input.savedAt, layoutRevision: input.layoutRevision,
    workspaces: input.panelDocument.workspaces, panels: input.panelDocument.panels, tabs,
    activeWorkspaceInstanceKey: active
  })
  if (validation.status === 'rejected') return { status: 'rejected', reason: validation.reason }
  return { status: 'ok', document: validation.document, droppedTabs }
}
