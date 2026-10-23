import type { PanelContainerMode, WorkspaceBounds, WorkspaceSize } from '../contracts'
import { WorkspaceRegistrationPolicy } from '../policies'

/**
 * Owner: platform/workspace/persistence。权威：技术设计 §7 Storage Plan / §8 Growth Plan。
 * 纯形状模块：文档类型、有界预算、校验/解析、卸载剪裁。不做任何 I/O、不读文件、不认识 Electron。
 * 安全不变量：文档里绝不出现 windowInstanceId/hostEpoch/owner、session、密钥、prompt/查询正文或业务数据；
 * 只有 binding.persistence=durable 的 opaque key 才允许出现（由 runtime store 决定是否填写）。
 */

export type DockMode = Exclude<PanelContainerMode, 'detached'>
export type StoredBinding = { key: string }
export type StoredWorkspace = {
  workspaceInstanceKey: string; pageId: string; binding?: StoredBinding
  panelOrder: readonly string[]; activePanels: Partial<Record<DockMode, string>>
}
export type StoredPanel = {
  panelInstanceKey: string; workspaceInstanceKey: string; panelId: string; binding?: StoredBinding
  open: boolean; mode: PanelContainerMode; dockSize?: WorkspaceSize; detachedBounds?: WorkspaceBounds
  lastValidDock: DockMode
}
export type PanelLayoutDocumentV1 = {
  schemaVersion: 1; savedAt: string; layoutRevision: number
  workspaces: readonly StoredWorkspace[]; panels: readonly StoredPanel[]
}

/** 技术设计 §8：容量按「最新布局」而不是事件流计；到上限拒绝新开，绝不逐出活动实例。 */
export const WorkspaceLayoutBudgetPolicy = Object.freeze({
  maxDocumentBytes: 1_048_576,
  maxPages: 32,
  maxPanels: 128,
  maxEntryBytes: 4096,
  maxRecentClosedInMemory: 10
})

/** 技术设计 §7：bounds 合并窗口与单 writer；不宣称 fsync/断电零丢失。 */
export const WorkspaceWritePolicy = Object.freeze({ boundsMergeMs: 250 })
/** 技术设计 §7：启动异步有界读取，迟到结果 CAS。 */
export const WorkspaceRestorePolicy = Object.freeze({ readBudgetMs: 200 })

export type PanelLayoutRejectionReason =
  | 'not-an-object' | 'unknown-schema-version' | 'document-too-large' | 'entry-too-large'
  | 'page-limit-exceeded' | 'panel-limit-exceeded' | 'invalid-field' | 'forbidden-field'

export type PanelLayoutValidation =
  | { status: 'ok'; document: PanelLayoutDocumentV1 }
  | { status: 'rejected'; reason: PanelLayoutRejectionReason }

const DOCK_MODES = Object.freeze<readonly DockMode[]>(['embedded', 'docked-right', 'docked-bottom'])
const ALL_MODES = Object.freeze<readonly PanelContainerMode[]>(['embedded', 'docked-right', 'docked-bottom', 'detached'])
const MAX_ID_LENGTH = 200
const MAX_SCAN_DEPTH = 8
/** 只有布局形状允许出现；命中任何一个都说明写入了不该落盘的东西。 */
const FORBIDDEN_FIELDS = Object.freeze([
  'windowinstanceid', 'hostepoch', 'owner', 'host', 'session', 'sessionkey', 'token', 'secret',
  'apikey', 'password', 'credential', 'prompt', 'query', 'content', 'messages', 'handoff', 'draft'
])

function rejected(reason: PanelLayoutRejectionReason): PanelLayoutValidation {
  return { status: 'rejected', reason }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  // 拒绝访问器属性：程序化调用方的抛错 getter 不得穿透校验进入写入路径
  return Object.keys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && 'value' in descriptor
  })
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
}

function deepHasForbiddenField(value: unknown, depth = 0): boolean {
  if (depth > MAX_SCAN_DEPTH) return false
  if (Array.isArray(value)) return value.some((entry) => deepHasForbiddenField(entry, depth + 1))
  if (!isPlainObject(value)) return false
  return Object.entries(value).some(([key, entry]) => FORBIDDEN_FIELDS.includes(key.toLowerCase()) || deepHasForbiddenField(entry, depth + 1))
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && !/[\u0000-\u001f\u007f]/u.test(value)
}

function isSafeBinding(value: unknown): value is StoredBinding {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'key') return false
  const key = value.key
  if (typeof key !== 'string' || key.length === 0 || /[\u0000-\u001f\u007f]/u.test(key)) return false
  return Buffer.byteLength(key, 'utf8') <= WorkspaceRegistrationPolicy.maxBindingKeyBytes
}

function isSize(value: unknown, allowZero: boolean): value is WorkspaceSize {
  if (!isPlainObject(value)) return false
  const { width, height } = value
  const ok = (metric: unknown): boolean => typeof metric === 'number' && Number.isFinite(metric) && metric > (allowZero ? -1 : 0)
  return ok(width) && ok(height)
}

function isBounds(value: unknown): value is WorkspaceBounds {
  if (!isPlainObject(value)) return false
  const { x, y } = value
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return false
  return isSize(value, false)
}

function readWorkspace(value: unknown): StoredWorkspace | null {
  if (!isPlainObject(value)) return null
  if (!isSafeId(value.workspaceInstanceKey) || !isSafeId(value.pageId)) return null
  if (value.binding !== undefined && !isSafeBinding(value.binding)) return null
  if (!Array.isArray(value.panelOrder) || !value.panelOrder.every((entry) => isSafeId(entry))) return null
  if (!isPlainObject(value.activePanels)) return null
  const activePanels: Partial<Record<DockMode, string>> = {}
  for (const [mode, key] of Object.entries(value.activePanels)) {
    if (!DOCK_MODES.includes(mode as DockMode) || !isSafeId(key)) return null
    activePanels[mode as DockMode] = key
  }
  return {
    workspaceInstanceKey: value.workspaceInstanceKey, pageId: value.pageId, panelOrder: [...value.panelOrder],
    activePanels, ...(value.binding === undefined ? {} : { binding: { key: value.binding.key } })
  }
}

function readPanel(value: unknown): StoredPanel | null {
  if (!isPlainObject(value)) return null
  if (!isSafeId(value.panelInstanceKey) || !isSafeId(value.workspaceInstanceKey) || !isSafeId(value.panelId)) return null
  if (value.binding !== undefined && !isSafeBinding(value.binding)) return null
  if (typeof value.open !== 'boolean') return null
  if (typeof value.mode !== 'string' || !ALL_MODES.includes(value.mode as PanelContainerMode)) return null
  if (typeof value.lastValidDock !== 'string' || !DOCK_MODES.includes(value.lastValidDock as DockMode)) return null
  const { dockSize, detachedBounds } = value
  if (dockSize !== undefined && !isSize(dockSize, false)) return null
  if (detachedBounds !== undefined && !isBounds(detachedBounds)) return null
  return {
    panelInstanceKey: value.panelInstanceKey, workspaceInstanceKey: value.workspaceInstanceKey, panelId: value.panelId,
    open: value.open, mode: value.mode as PanelContainerMode, lastValidDock: value.lastValidDock as DockMode,
    ...(value.binding === undefined ? {} : { binding: { key: value.binding.key } }),
    ...(dockSize === undefined ? {} : { dockSize: { width: dockSize.width, height: dockSize.height } }),
    ...(detachedBounds === undefined ? {} : { detachedBounds: { x: detachedBounds.x, y: detachedBounds.y, width: detachedBounds.width, height: detachedBounds.height } })
  }
}

export function validatePanelLayoutDocument(input: unknown): PanelLayoutValidation {
  if (!isPlainObject(input)) return rejected('not-an-object')
  if (input.schemaVersion !== 1) return rejected('unknown-schema-version')
  if (deepHasForbiddenField(input)) return rejected('forbidden-field')
  if (typeof input.savedAt !== 'string' || input.savedAt.length === 0 || input.savedAt.length > 40) return rejected('invalid-field')
  const layoutRevision = input.layoutRevision
  if (typeof layoutRevision !== 'number' || !Number.isSafeInteger(layoutRevision) || layoutRevision < 0) return rejected('invalid-field')
  if (!Array.isArray(input.workspaces) || !Array.isArray(input.panels)) return rejected('invalid-field')
  if (input.workspaces.length > WorkspaceLayoutBudgetPolicy.maxPages) return rejected('page-limit-exceeded')
  if (input.panels.length > WorkspaceLayoutBudgetPolicy.maxPanels) return rejected('panel-limit-exceeded')

  const workspaces: StoredWorkspace[] = []
  for (const entry of input.workspaces) {
    const workspace = readWorkspace(entry)
    if (!workspace) return rejected('invalid-field')
    if (byteLength(workspace) > WorkspaceLayoutBudgetPolicy.maxEntryBytes) return rejected('entry-too-large')
    workspaces.push(workspace)
  }
  const panels: StoredPanel[] = []
  for (const entry of input.panels) {
    const panel = readPanel(entry)
    if (!panel) return rejected('invalid-field')
    if (byteLength(panel) > WorkspaceLayoutBudgetPolicy.maxEntryBytes) return rejected('entry-too-large')
    panels.push(panel)
  }
  const document: PanelLayoutDocumentV1 = {
    schemaVersion: 1, savedAt: input.savedAt, layoutRevision, workspaces, panels
  }
  if (documentByteSize(document) > WorkspaceLayoutBudgetPolicy.maxDocumentBytes) return rejected('document-too-large')
  return { status: 'ok', document }
}

/** 与 jsonFileStorage 落盘形态一致，因此 documentByteSize 就是磁盘字节数。 */
export function serializePanelLayoutDocument(document: PanelLayoutDocumentV1): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

export function documentByteSize(document: PanelLayoutDocumentV1): number {
  return Buffer.byteLength(serializePanelLayoutDocument(document), 'utf8')
}

/** 先做大小判定再解析：超大文件不得进入 JSON.parse。 */
export function parsePanelLayoutDocument(text: string): PanelLayoutValidation {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > WorkspaceLayoutBudgetPolicy.maxDocumentBytes) return rejected('document-too-large')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return rejected('not-an-object')
  }
  return validatePanelLayoutDocument(parsed)
}

export function emptyPanelLayoutDocument(layoutRevision = 0, savedAt = new Date(0).toISOString()): PanelLayoutDocumentV1 {
  return { schemaVersion: 1, savedAt, layoutRevision, workspaces: [], panels: [] }
}

/** 卸载剪裁：注册表里已消失的 page/panel 只剪掉对应条目，其余布局完整保留。 */
export function prunePanelLayoutDocument(document: PanelLayoutDocumentV1, allowlist: { pageIds: ReadonlySet<string>; panelIds: ReadonlySet<string> }): { document: PanelLayoutDocumentV1; prunedWorkspaces: number; prunedPanels: number } {
  const keptWorkspaces = document.workspaces.filter((workspace) => allowlist.pageIds.has(workspace.pageId))
  const keptWorkspaceKeys = new Set(keptWorkspaces.map((workspace) => workspace.workspaceInstanceKey))
  const keptPanels = document.panels.filter((panel) => keptWorkspaceKeys.has(panel.workspaceInstanceKey) && allowlist.panelIds.has(panel.panelId))
  const keptPanelKeys = new Set(keptPanels.map((panel) => panel.panelInstanceKey))
  const workspaces = keptWorkspaces.map((workspace) => {
    const activePanels: Partial<Record<DockMode, string>> = {}
    for (const mode of DOCK_MODES) {
      const key = workspace.activePanels[mode]
      if (key !== undefined && keptPanelKeys.has(key)) activePanels[mode] = key
    }
    return { ...workspace, panelOrder: workspace.panelOrder.filter((key) => keptPanelKeys.has(key)), activePanels }
  })
  return {
    document: { ...document, workspaces, panels: keptPanels },
    prunedWorkspaces: document.workspaces.length - keptWorkspaces.length,
    prunedPanels: document.panels.length - keptPanels.length
  }
}
