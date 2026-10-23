import { randomUUID } from 'node:crypto'

import type {
  PanelContainerMode,
  WorkspaceBounds,
  WorkspaceCommandResult,
  WorkspaceHost,
  WorkspacePanelResult,
  WorkspacePanelSnapshot,
  WorkspaceSize,
  WorkspaceSnapshot,
  WorkspaceWorkspaceResult
} from '../contracts'
import type { WorkspacePanelRegistration } from '../contracts'
import { WorkspaceOwnershipPolicy, WorkspaceRegistrationPolicy, WorkspaceTransferPolicy } from '../policies'
import { WorkspaceLayoutBudgetPolicy, prunePanelLayoutDocument, validatePanelLayoutDocument, type PanelLayoutDocumentV1, type PanelLayoutRejectionReason } from '../persistence/panelLayoutDocument'
import type { createPanelRegistry } from '../registry/panelRegistry'
import { createWorkspaceCommandQueue } from './workspaceCommandQueue'

type Registry = ReturnType<typeof createPanelRegistry>
type DockMode = Exclude<PanelContainerMode, 'detached'>
type WorkspaceRecord = {
  workspaceInstanceKey: string; pageId: string; host: WorkspaceHost; open: boolean
  panelOrder: string[]; activePanels: Partial<Record<DockMode, string>>
}
type Transfer = {
  operationId: string
  phase: 'awaiting-source-prepared' | 'awaiting-target-ready' | 'awaiting-source-release' | 'awaiting-commit'
  source: WorkspaceHost; target: WorkspaceHost; targetMode: PanelContainerMode; deadlineAt: number
}
type PanelRecord = {
  panelInstanceKey: string; workspaceInstanceKey: string; panelId: string; bindingKey?: string
  bindingPersistence: 'none' | 'session' | 'durable'; open: boolean; mode: PanelContainerMode
  presentation: 'normal' | 'overlay' | 'exclusive'; lastValidDock: DockMode; host: WorkspaceHost
  dockSize?: WorkspaceSize; detachedBounds?: WorkspaceBounds
  transfer?: Transfer
}
type RecentlyClosed = { panelInstanceKey: string; panelId: string; workspaceInstanceKey: string; mode: PanelContainerMode }
const DOCK_MODES: readonly DockMode[] = ['embedded', 'docked-right', 'docked-bottom']
/** §6 安全链：用户优先 lastValidDock，错误路径 right→bottom→embedded（Main 侧同序实现在 P1-04 的 bounds 模块）。 */
const DOCK_FALLBACK_CHAIN: readonly DockMode[] = ['docked-right', 'docked-bottom', 'embedded']
/** 恢复时挑一个受支持模式：存的就是受支持的就照用，否则按 §6 链回退；一个都不支持才返回 undefined。 */
function resolveRestorableMode(stored: { mode: PanelContainerMode; lastValidDock: DockMode }, supportedModes: readonly PanelContainerMode[]): PanelContainerMode | undefined {
  if (supportedModes.includes(stored.mode)) return stored.mode
  return [stored.lastValidDock, ...DOCK_FALLBACK_CHAIN].find((mode) => supportedModes.includes(mode))
}

function validSize(size: WorkspaceSize): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
}
/** 目标身份 id 上界：与 Main 侧请求字段上界同量级（panelWorkspacePayloadGuard 的 MAX_ID_LENGTH = 200）。 */
const MAX_HOST_ID_LENGTH = 200
/**
 * 事务身份贯通（P1-06c）：调用方（Main 侧持有真实窗口登记的一方）提供的目标身份必须是
 * 「非空 id + 不小于初始 epoch 的安全整数」。非法一律拒绝，绝不静默改回自造身份——那会让两侧又分叉。
 */
function validTargetHost(host: WorkspaceHost): boolean {
  if (typeof host !== 'object' || host === null) return false
  const { windowInstanceId, hostEpoch } = host
  return typeof windowInstanceId === 'string' && windowInstanceId.trim().length > 0 && windowInstanceId.length <= MAX_HOST_ID_LENGTH
    && Number.isSafeInteger(hostEpoch) && hostEpoch >= WorkspaceOwnershipPolicy.initialHostEpoch
}
type RequestInput = { requestId: string; requestScope?: string; expectedRevision: number; hostEpoch: number; windowInstanceId?: string }
/** 幂等缓存条目（P1-06g / D2）：只回放「同一 key + 同一方法 + 同一参数」的重复请求。 */
type RequestCacheEntry = { fingerprint: string; result: Promise<unknown> }

/**
 * 请求指纹的**形状护栏**（P1-06h）：环引用会无限递归、超深结构会打爆调用栈。
 * 两者都不可确定性序列化，因此这里是显式上界而不是「碰运气不溢出」：深度 ≤ 32 且同一节点不得在自己
 * 的祖先链上再次出现（同层重复引用是合法的共享结构，序列化后照常可比）。
 */
const MAX_FINGERPRINT_DEPTH = 32
/** 内部信号：调用方（`remember`）必须把它翻成 `invalid-request`，绝不允许冒泡到 IPC。 */
class RequestFingerprintError extends Error {
  constructor(readonly shape: 'cycle' | 'depth') {
    super(`request fingerprint is not serializable: ${shape}`)
    this.name = 'RequestFingerprintError'
  }
}

/**
 * 请求指纹的确定性序列化：对象键排序、数组保序，因此「参数逐字相同」与「参数不同」可被稳定区分。
 * 只用于比较，绝不进入快照/落盘，也不回传 renderer。
 */
function stableSerialize(value: unknown, ancestors: Set<object>, depth: number): string {
  if (depth > MAX_FINGERPRINT_DEPTH) throw new RequestFingerprintError('depth')
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  const node = value as object
  if (ancestors.has(node)) throw new RequestFingerprintError('cycle')
  ancestors.add(node)
  try {
    if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry, ancestors, depth + 1)).join(',')}]`
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key], ancestors, depth + 1)}`).join(',')}}`
  } finally {
    ancestors.delete(node)
  }
}
type StoreOptions = { panelRegistry: Registry; pageIds: readonly string[]; createOpaqueId?: (prefix?: string) => string; now?: () => number }

function opaqueId(prefix: string): string { return `${prefix}_${randomUUID()}` }
function copyHost(host: WorkspaceHost): WorkspaceHost { return { windowInstanceId: host.windowInstanceId, hostEpoch: host.hostEpoch } }
function validBindingKey(value: string | undefined, registration: WorkspacePanelRegistration): boolean {
  if (value === undefined) return true
  const bytes = new TextEncoder().encode(value)
  return bytes.length > 0 && bytes.length <= registration.binding.maxKeyBytes && !/[\u0000-\u001f\u007f]/u.test(value)
}

function makeSnapshot(workspaces: Map<string, WorkspaceRecord>, panels: Map<string, PanelRecord>, revision: number, activeWorkspaceInstanceKey: string | null): WorkspaceSnapshot {
  const panelSnapshots: WorkspacePanelSnapshot[] = [...panels.values()].map((panel) => Object.freeze({
    panelInstanceKey: panel.panelInstanceKey, workspaceInstanceKey: panel.workspaceInstanceKey, panelId: panel.panelId,
    open: panel.open, mode: panel.mode, presentation: panel.presentation,
    bindingState: panel.bindingPersistence === 'none' || panel.bindingKey !== undefined ? 'bound' as const : 'unavailable' as const,
    windowInstanceId: panel.host.windowInstanceId, hostEpoch: panel.host.hostEpoch, lastValidDock: panel.lastValidDock,
    ...(panel.dockSize ? { dockSize: Object.freeze({ ...panel.dockSize }) } : {}),
    ...(panel.detachedBounds ? { detachedBounds: Object.freeze({ ...panel.detachedBounds }) } : {}),
    ...(panel.transfer ? { transfer: Object.freeze({ operationId: panel.transfer.operationId, phase: panel.transfer.phase }) } : {})
  }))
  const pageLayouts = [...workspaces.values()].map((workspace) => Object.freeze({
    workspaceInstanceKey: workspace.workspaceInstanceKey,
    panelOrder: Object.freeze([...workspace.panelOrder]),
    activePanels: Object.freeze({ ...workspace.activePanels })
  }))
  return Object.freeze({
    layoutRevision: revision,
    activeWorkspaceInstanceKey,
    panels: Object.freeze(panelSnapshots), pageLayouts: Object.freeze(pageLayouts), tabs: Object.freeze([]) as readonly [],
    persistenceState: 'saved' as const
  })
}

export function createPanelWorkspaceStore(options: StoreOptions) {
  const queue = createWorkspaceCommandQueue()
  const createId = options.createOpaqueId ?? ((prefix = 'id') => opaqueId(prefix))
  const now = options.now ?? (() => Date.now())
  const pageIds = new Set(options.pageIds)
  if (pageIds.size === 0) throw new Error('workspace page allowlist is required')
  const workspaces = new Map<string, WorkspaceRecord>()
  const panels = new Map<string, PanelRecord>()
  const requests = new Map<string, RequestCacheEntry>()
  let revision = 0
  let activeWorkspaceInstanceKey: string | null = null
  let appExiting = false
  /** 最近关闭只保留会话内存（有界 10 条），绝不落盘、重启后为空。 */
  const recentlyClosed: RecentlyClosed[] = []
  const rememberRecentlyClosed = (panel: PanelRecord): void => {
    const next = recentlyClosed.filter((entry) => entry.panelInstanceKey !== panel.panelInstanceKey)
    next.unshift({ panelInstanceKey: panel.panelInstanceKey, panelId: panel.panelId, workspaceInstanceKey: panel.workspaceInstanceKey, mode: panel.mode })
    recentlyClosed.length = 0
    recentlyClosed.push(...next.slice(0, WorkspaceLayoutBudgetPolicy.maxRecentClosedInMemory))
  }
  const snapshot = () => makeSnapshot(workspaces, panels, revision, activeWorkspaceInstanceKey && workspaces.get(activeWorkspaceInstanceKey)?.open ? activeWorkspaceInstanceKey : null)
  const keyFor = (input: { requestId: string; requestScope?: string }) => `${input.requestScope ?? 'main'}:${input.requestId}`
  /**
   * 幂等回放（P1-06g / D2）：同一 `requestScope:requestId` 只在「方法 + 参数」逐字一致时回放原结果；
   * 一旦带来不同方法或不同参数，一律 `invalid-request` fail closed，绝不把旧响应当成本次命令的答案
   * （真机症状：同窗重载后新 client 的 `ws-renderer-1` 命中旧响应，命令被静默丢弃）。
   */
  const remember = <T>(
    input: { requestId: string; requestScope?: string },
    method: string,
    onMismatch: () => T,
    operation: () => T | Promise<T>
  ): Promise<T> => {
    const key = keyFor(input)
    let fingerprint: string
    try {
      fingerprint = `${method}|${stableSerialize(input, new Set<object>(), 0)}`
    } catch (error) {
      // P1-06h：环引用/超深结构 ⇒ 与「同 key 不同参数」同级 fail closed（`invalid-request`）：
      // 既不执行、也不写缓存，更不把 RangeError 冒泡成 IPC 未捕获异常。
      if (!(error instanceof RequestFingerprintError)) throw error
      return Promise.resolve(onMismatch())
    }
    const previous = requests.get(key)
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) return Promise.resolve(onMismatch())
      return previous.result as Promise<T>
    }
    const current = queue.enqueue(operation); requests.set(key, { fingerprint, result: current })
    current.finally(() => {
      if (requests.size > WorkspaceOwnershipPolicy.requestHistoryLimit) requests.delete(requests.keys().next().value as string)
    }).catch(() => undefined)
    return current
  }
  const reject = (errorCode: WorkspaceCommandResult['errorCode']): WorkspaceCommandResult => ({ status: 'rejected', snapshot: snapshot(), errorCode })
  const validRevision = (expected: number) => Number.isSafeInteger(expected) && expected === revision
  const owns = (input: Pick<RequestInput, 'hostEpoch' | 'windowInstanceId'>, host: WorkspaceHost) =>
    input.hostEpoch === host.hostEpoch && (input.windowInstanceId ?? WorkspaceOwnershipPolicy.initialWindowInstanceId) === host.windowInstanceId
  const setActive = (workspace: WorkspaceRecord, panel: PanelRecord) => {
    if (panel.mode !== 'detached') workspace.activePanels[panel.mode] = panel.panelInstanceKey
  }
  const selectReplacement = (workspace: WorkspaceRecord, mode: DockMode, panelInstanceKey: string) => {
    if (workspace.activePanels[mode] !== panelInstanceKey) return
    const next = workspace.panelOrder.find((id) => {
      if (id === panelInstanceKey) return false
      const candidate = panels.get(id)
      return candidate?.open === true && candidate.mode === mode
    })
    if (next) workspace.activePanels[mode] = next
    else delete workspace.activePanels[mode]
  }
  const selectAfterClose = (workspace: WorkspaceRecord, panel: PanelRecord) => {
    if (panel.mode === 'detached' || workspace.activePanels[panel.mode] !== panel.panelInstanceKey) return
    selectReplacement(workspace, panel.mode, panel.panelInstanceKey)
  }
  const findTransfer = (operationId: string) => {
    for (const panel of panels.values()) if (panel.transfer?.operationId === operationId) return { panel, transfer: panel.transfer }
    return undefined
  }
  const expired = (transfer: Transfer) => now() >= transfer.deadlineAt
  const detachedCount = () => [...panels.values()].filter((panel) => panel.mode === 'detached' || panel.transfer?.targetMode === 'detached').length

  return Object.freeze({
    openWorkspace(input: { requestId: string; requestScope?: string; expectedRevision: number; pageId: string }): Promise<WorkspaceWorkspaceResult> {
      return remember(input, 'openWorkspace', () => ({ ...reject('invalid-request'), workspaceInstanceKey: '', hostEpoch: 0 }), () => {
        if (appExiting) return { ...reject('main-window-closing'), workspaceInstanceKey: '', hostEpoch: 0 }
        if (!validRevision(input.expectedRevision) || !input.pageId.trim()) return { ...reject('stale-revision'), workspaceInstanceKey: '', hostEpoch: 0 }
        if (pageIds.size > 0 && !pageIds.has(input.pageId)) return { ...reject('registration-missing'), workspaceInstanceKey: '', hostEpoch: 0 }
        const workspaceInstanceKey = createId('workspace'); const host = { windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch }
        workspaces.set(workspaceInstanceKey, { workspaceInstanceKey, pageId: input.pageId, host, open: true, panelOrder: [], activePanels: {} }); activeWorkspaceInstanceKey = workspaceInstanceKey; revision += 1
        return { status: 'applied', snapshot: snapshot(), workspaceInstanceKey, hostEpoch: host.hostEpoch }
      })
    },
    /**
     * **PLAT-35**：采纳一个**既有** workspace 键（Main 从 Tab 链取来的 `workspaceInstanceKey`）。
     *
     * 两条链（面板 / 页面 Tab）此前各自铸造键、互不相认 ⇒ 停靠面板所在的 workspace 不是主窗正在显示的
     * Tab 页，主窗 DOM 里永远没有面板帧。统一口径是：**页面实例的键由 Tab 链产生，面板链采纳它**。
     *
     * 语义（保守、可审计）：
     *  - 该键不存在 ⇒ 按 `openWorkspace` 同形创建（宿主＝主窗哨兵，revision +1）；
     *  - 该键已存在且 pageId 相同 ⇒ **幂等**返回（**不抬 revision**：重连/重复打开不得把所有宿主判成 stale）；
     *  - 该键已存在但 pageId 不同 ⇒ `invalid-request` 且零触碰（绝不把两个页面实例混成一个 workspace）；
     *  - 未注册页面/空键 ⇒ `registration-missing` / `invalid-request`（与 `openWorkspace` 同一准入）。
     * 它只接受 Main 内部调用（IPC 层不暴露该方法；renderer 依旧没有任何自选键的入口）。
     */
    adoptWorkspace(input: { workspaceInstanceKey: string; pageId: string }): Promise<WorkspaceWorkspaceResult> {
      const key = input.workspaceInstanceKey
      return queue.enqueue(async () => {
        const invalid = (errorCode: WorkspaceCommandResult['errorCode']): WorkspaceWorkspaceResult =>
          ({ ...reject(errorCode), workspaceInstanceKey: '', hostEpoch: 0 })
        if (appExiting) return invalid('main-window-closing')
        if (typeof key !== 'string' || key.trim().length === 0 || !input.pageId?.trim()) return invalid('invalid-request')
        if (pageIds.size > 0 && !pageIds.has(input.pageId)) return invalid('registration-missing')
        const existing = workspaces.get(key)
        if (existing !== undefined) {
          if (existing.pageId !== input.pageId) return invalid('invalid-request')
          return { status: 'applied', snapshot: snapshot(), workspaceInstanceKey: key, hostEpoch: existing.host.hostEpoch }
        }
        const host = {
          windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId,
          hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch
        }
        workspaces.set(key, { workspaceInstanceKey: key, pageId: input.pageId, host, open: true, panelOrder: [], activePanels: {} })
        activeWorkspaceInstanceKey = key
        revision += 1
        return { status: 'applied', snapshot: snapshot(), workspaceInstanceKey: key, hostEpoch: host.hostEpoch }
      })
    },
    openPanel(input: RequestInput & { workspaceInstanceKey: string; panelId: string; bindingKey?: string; newInstance?: boolean }): Promise<WorkspacePanelResult> {
      return remember(input, 'openPanel', () => ({ ...reject('invalid-request'), panelInstanceKey: '' }), () => {
        if (appExiting) return { ...reject('main-window-closing'), panelInstanceKey: '' }
        if (!validRevision(input.expectedRevision)) return { ...reject('stale-revision'), panelInstanceKey: '' }
        const workspace = workspaces.get(input.workspaceInstanceKey); const registration = options.panelRegistry.get(input.panelId)
        if (!workspace || !registration || (pageIds.size > 0 && !pageIds.has(workspace.pageId)) || !registration.pageIds.includes(workspace.pageId)) return { ...reject('registration-missing'), panelInstanceKey: '' }
        if (!validBindingKey(input.bindingKey, registration) || (registration.binding.persistence === 'none' && input.bindingKey !== undefined)) return { ...reject('invalid-request'), panelInstanceKey: '' }
        if (!owns(input, workspace.host)) return { ...reject('not-owner'), panelInstanceKey: '' }
        const existing = [...panels.values()].find((panel) => panel.workspaceInstanceKey === workspace.workspaceInstanceKey && panel.panelId === input.panelId && panel.bindingKey === input.bindingKey && !input.newInstance)
        if (existing) { if (!existing.open) { existing.open = true; revision += 1 } activeWorkspaceInstanceKey = workspace.workspaceInstanceKey; setActive(workspace, existing); return { status: 'applied', snapshot: snapshot(), panelInstanceKey: existing.panelInstanceKey } }
        if (input.newInstance && !registration.allowMultipleInstances) return { ...reject('invalid-request'), panelInstanceKey: '' }
        const panelInstanceKey = createId('panel'); const panel: PanelRecord = {
          panelInstanceKey, workspaceInstanceKey: workspace.workspaceInstanceKey, panelId: input.panelId, bindingKey: input.bindingKey,
          bindingPersistence: registration.binding.persistence, open: true, mode: registration.defaultMode, presentation: 'normal', lastValidDock: registration.defaultMode, host: copyHost(workspace.host)
        }
        panels.set(panelInstanceKey, panel); workspace.panelOrder.push(panelInstanceKey); activeWorkspaceInstanceKey = workspace.workspaceInstanceKey; setActive(workspace, panel); revision += 1
        return { status: 'applied', snapshot: snapshot(), panelInstanceKey }
      })
    },
    bindPanel(input: RequestInput & { panelInstanceKey: string; bindingKey: string }): Promise<WorkspacePanelResult> {
      return remember(input, 'bindPanel', () => ({ ...reject('invalid-request'), panelInstanceKey: input.panelInstanceKey }), () => {
        const panel = panels.get(input.panelInstanceKey); if (!panel) return { ...reject('registration-missing'), panelInstanceKey: input.panelInstanceKey }
        if (!validRevision(input.expectedRevision)) return { ...reject('stale-revision'), panelInstanceKey: panel.panelInstanceKey }
        const registration = options.panelRegistry.get(panel.panelId)
        if (appExiting || !registration || registration.binding.persistence === 'none' || !validBindingKey(input.bindingKey, registration) || !owns(input, panel.host)) return { ...reject(appExiting ? 'main-window-closing' : 'invalid-request'), panelInstanceKey: panel.panelInstanceKey }
        panel.bindingKey = input.bindingKey; revision += 1; return { status: 'applied', snapshot: snapshot(), panelInstanceKey: panel.panelInstanceKey }
      })
    },
    activatePanel(input: RequestInput & { panelInstanceKey: string }): Promise<WorkspacePanelResult> {
      return remember(input, 'activatePanel', () => ({ ...reject('invalid-request'), panelInstanceKey: input.panelInstanceKey }), () => {
        const panel = panels.get(input.panelInstanceKey); const workspace = panel && workspaces.get(panel.workspaceInstanceKey)
        if (!panel || !workspace) return { ...reject('registration-missing'), panelInstanceKey: input.panelInstanceKey }
        if (!validRevision(input.expectedRevision)) return { ...reject('stale-revision'), panelInstanceKey: panel.panelInstanceKey }
        if (appExiting || !owns(input, panel.host)) return { ...reject(appExiting ? 'main-window-closing' : 'not-owner'), panelInstanceKey: panel.panelInstanceKey }
        const workspaceChanged = activeWorkspaceInstanceKey !== workspace.workspaceInstanceKey
        activeWorkspaceInstanceKey = workspace.workspaceInstanceKey
        if (panel.mode !== 'detached' && workspace.activePanels[panel.mode] !== panel.panelInstanceKey) {
          setActive(workspace, panel); revision += 1
        } else if (workspaceChanged) {
          revision += 1
        }
        return { status: 'applied', snapshot: snapshot(), panelInstanceKey: panel.panelInstanceKey }
      })
    },
    closePanel(input: RequestInput & { panelInstanceKey: string }): Promise<WorkspacePanelResult> {
      return remember(input, 'closePanel', () => ({ ...reject('invalid-request'), panelInstanceKey: input.panelInstanceKey }), () => {
        const panel = panels.get(input.panelInstanceKey); const workspace = panel && workspaces.get(panel.workspaceInstanceKey)
        if (!panel || !workspace) return { ...reject('registration-missing'), panelInstanceKey: input.panelInstanceKey }
        if (!validRevision(input.expectedRevision)) return { ...reject('stale-revision'), panelInstanceKey: panel.panelInstanceKey }
        if (appExiting || !owns(input, panel.host)) return { ...reject(appExiting ? 'main-window-closing' : 'not-owner'), panelInstanceKey: panel.panelInstanceKey }
        panel.open = false; panel.transfer = undefined; selectAfterClose(workspace, panel); rememberRecentlyClosed(panel); revision += 1
        return { status: 'applied', snapshot: snapshot(), panelInstanceKey: panel.panelInstanceKey }
      })
    },
    switchContainer(input: RequestInput & { panelInstanceKey: string; mode: PanelContainerMode }): Promise<WorkspacePanelResult> {
      return remember(input, 'switchContainer', () => ({ ...reject('invalid-request'), panelInstanceKey: input.panelInstanceKey }), () => {
        const panel = panels.get(input.panelInstanceKey); const workspace = panel && workspaces.get(panel.workspaceInstanceKey); const registration = panel && options.panelRegistry.get(panel.panelId)
        if (!panel || !workspace || !registration || !registration.supportedModes.includes(input.mode)) return { ...reject('unsupported'), panelInstanceKey: input.panelInstanceKey }
        if (!validRevision(input.expectedRevision)) return { ...reject('stale-revision'), panelInstanceKey: panel.panelInstanceKey }
        if (appExiting || !owns(input, panel.host)) return { ...reject(appExiting ? 'main-window-closing' : 'not-owner'), panelInstanceKey: panel.panelInstanceKey }
        if (panel.transfer) return { ...reject('transfer-in-progress'), panelInstanceKey: panel.panelInstanceKey }
        if (input.mode === 'detached' || panel.mode === 'detached') return { ...reject('unsupported'), panelInstanceKey: panel.panelInstanceKey }
        selectReplacement(workspace, panel.mode, panel.panelInstanceKey)
        panel.mode = input.mode; panel.lastValidDock = input.mode; setActive(workspace, panel); revision += 1
        return { status: 'applied', snapshot: snapshot(), panelInstanceKey: panel.panelInstanceKey }
      })
    },
    resizePanel(input: RequestInput & { panelInstanceKey: string; dockSize: WorkspaceSize }): Promise<WorkspacePanelResult> {
      return remember(input, 'resizePanel', () => ({ ...reject('invalid-request'), panelInstanceKey: input.panelInstanceKey }), () => {
        const panel = panels.get(input.panelInstanceKey); const workspace = panel && workspaces.get(panel.workspaceInstanceKey)
        if (!panel || !workspace) return { ...reject('registration-missing'), panelInstanceKey: input.panelInstanceKey }
        if (!validRevision(input.expectedRevision)) return { ...reject('stale-revision'), panelInstanceKey: panel.panelInstanceKey }
        if (appExiting || !owns(input, panel.host)) return { ...reject(appExiting ? 'main-window-closing' : 'not-owner'), panelInstanceKey: panel.panelInstanceKey }
        if (!validSize(input.dockSize) || panel.mode === 'detached') return { ...reject('invalid-request'), panelInstanceKey: panel.panelInstanceKey }
        const nextSize = { width: Math.round(input.dockSize.width), height: Math.round(input.dockSize.height) }
        // 尺寸无变化不抬 revision（否则其它窗口会被误判 stale）
        if (panel.dockSize?.width !== nextSize.width || panel.dockSize?.height !== nextSize.height) { panel.dockSize = nextSize; revision += 1 }
        return { status: 'applied', snapshot: snapshot(), panelInstanceKey: panel.panelInstanceKey }
      })
    },
    resetPanelSize(input: RequestInput & { panelInstanceKey: string }): Promise<WorkspacePanelResult> {
      return remember(input, 'resetPanelSize', () => ({ ...reject('invalid-request'), panelInstanceKey: input.panelInstanceKey }), () => {
        const panel = panels.get(input.panelInstanceKey)
        if (!panel) return { ...reject('registration-missing'), panelInstanceKey: input.panelInstanceKey }
        if (!validRevision(input.expectedRevision)) return { ...reject('stale-revision'), panelInstanceKey: panel.panelInstanceKey }
        if (appExiting || !owns(input, panel.host)) return { ...reject(appExiting ? 'main-window-closing' : 'not-owner'), panelInstanceKey: panel.panelInstanceKey }
        if (panel.dockSize) { delete panel.dockSize; revision += 1 }
        return { status: 'applied', snapshot: snapshot(), panelInstanceKey: panel.panelInstanceKey }
      })
    },
    reopenPanel(input: RequestInput & { panelInstanceKey: string }): Promise<WorkspacePanelResult> {
      return remember(input, 'reopenPanel', () => ({ ...reject('invalid-request'), panelInstanceKey: input.panelInstanceKey }), () => {
        const panel = panels.get(input.panelInstanceKey); const workspace = panel && workspaces.get(panel.workspaceInstanceKey)
        if (!panel || !workspace) return { ...reject('registration-missing'), panelInstanceKey: input.panelInstanceKey }
        if (!validRevision(input.expectedRevision)) return { ...reject('stale-revision'), panelInstanceKey: panel.panelInstanceKey }
        if (appExiting || !owns(input, panel.host)) return { ...reject(appExiting ? 'main-window-closing' : 'not-owner'), panelInstanceKey: panel.panelInstanceKey }
        const workspaceChanged = activeWorkspaceInstanceKey !== workspace.workspaceInstanceKey
        activeWorkspaceInstanceKey = workspace.workspaceInstanceKey
        if (!panel.open) { panel.open = true; revision += 1 }
        if (panel.mode !== 'detached' && workspace.activePanels[panel.mode] !== panel.panelInstanceKey) { setActive(workspace, panel); revision += 1 }
        else if (workspaceChanged) revision += 1
        const index = recentlyClosed.findIndex((entry) => entry.panelInstanceKey === panel.panelInstanceKey)
        if (index >= 0) recentlyClosed.splice(index, 1)
        return { status: 'applied', snapshot: snapshot(), panelInstanceKey: panel.panelInstanceKey }
      })
    },
    /** 会话内存的最近关闭（有界 10，最新在前）；不进文档、重启后自然为空。 */
    recentlyClosed(): readonly RecentlyClosed[] { return Object.freeze(recentlyClosed.map((entry) => Object.freeze({ ...entry }))) },
    /** 导出可持久化文档：只有 durable 绑定键落盘，session/none 与业务数据一律不出现。 */
    exportLayoutDocument(input: { savedAt: string }): { status: 'ok'; document: PanelLayoutDocumentV1 } | { status: 'rejected'; reason: PanelLayoutRejectionReason } {
      const document: PanelLayoutDocumentV1 = {
        schemaVersion: 1, savedAt: input.savedAt, layoutRevision: revision,
        workspaces: [...workspaces.values()].map((workspace) => Object.freeze({
          workspaceInstanceKey: workspace.workspaceInstanceKey, pageId: workspace.pageId,
          panelOrder: Object.freeze([...workspace.panelOrder]), activePanels: Object.freeze({ ...workspace.activePanels })
        })),
        panels: [...panels.values()].map((panel) => Object.freeze({
          panelInstanceKey: panel.panelInstanceKey, workspaceInstanceKey: panel.workspaceInstanceKey, panelId: panel.panelId,
          open: panel.open, mode: panel.mode, lastValidDock: panel.lastValidDock,
          ...(panel.bindingPersistence === 'durable' && panel.bindingKey !== undefined ? { binding: { key: panel.bindingKey } } : {}),
          ...(panel.dockSize ? { dockSize: { ...panel.dockSize } } : {}),
          ...(panel.detachedBounds ? { detachedBounds: { ...panel.detachedBounds } } : {})
        }))
      }
      const validation = validatePanelLayoutDocument(document)
      return validation.status === 'ok' ? { status: 'ok', document: validation.document } : { status: 'rejected', reason: validation.reason }
    },
    /** 恢复：CAS（expectedRevision 必须是当前 revision）+ 卸载剪裁（只剪已消失的 page/panel）。 */
    _restoreLayout(input: { requestId: string; requestScope?: string; expectedRevision: number; document: PanelLayoutDocumentV1 }): Promise<WorkspaceCommandResult & { prunedWorkspaces: number; prunedPanels: number }> {
      return remember(input, '_restoreLayout', () => ({ ...reject('invalid-request'), prunedWorkspaces: 0, prunedPanels: 0 }), () => {
        if (appExiting) return { ...reject('main-window-closing'), prunedWorkspaces: 0, prunedPanels: 0 }
        if (!validRevision(input.expectedRevision)) return { ...reject('stale-revision'), prunedWorkspaces: 0, prunedPanels: 0 }
        const panelIds = new Set(options.panelRegistry.list().map((summary) => summary.id))
        // 先丢掉「注册整体消失 / 没有任何受支持模式」的条目，再交给剪裁清理顺序与 active
        const restorable: PanelLayoutDocumentV1 = {
          ...input.document,
          panels: input.document.panels.filter((panel) => {
            const registration = options.panelRegistry.get(panel.panelId)
            return registration !== undefined && resolveRestorableMode({ mode: panel.mode, lastValidDock: panel.lastValidDock }, registration.supportedModes) !== undefined
          })
        }
        const pruned = prunePanelLayoutDocument(restorable, { pageIds, panelIds })
        const prunedWorkspaces = input.document.workspaces.length - pruned.document.workspaces.length
        const prunedPanels = input.document.panels.length - pruned.document.panels.length
        workspaces.clear(); panels.clear(); activeWorkspaceInstanceKey = null
        for (const stored of pruned.document.workspaces) {
          workspaces.set(stored.workspaceInstanceKey, {
            workspaceInstanceKey: stored.workspaceInstanceKey, pageId: stored.pageId,
            host: { windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch },
            open: true, panelOrder: [], activePanels: {}
          })
        }
        for (const stored of pruned.document.panels) {
          const workspace = workspaces.get(stored.workspaceInstanceKey); const registration = options.panelRegistry.get(stored.panelId)
          if (!workspace || !registration) continue
          const mode = resolveRestorableMode({ mode: stored.mode, lastValidDock: stored.lastValidDock }, registration.supportedModes)
          if (mode === undefined) continue
          const lastValidDock = registration.supportedModes.includes(stored.lastValidDock) ? stored.lastValidDock : (mode === 'detached' ? WorkspaceRegistrationPolicy.fallbackMode : mode)
          panels.set(stored.panelInstanceKey, {
            panelInstanceKey: stored.panelInstanceKey, workspaceInstanceKey: stored.workspaceInstanceKey, panelId: stored.panelId,
            bindingKey: registration.binding.persistence === 'durable' ? stored.binding?.key : undefined,
            bindingPersistence: registration.binding.persistence, open: stored.open, mode, presentation: 'normal',
            lastValidDock, host: copyHost(workspace.host),
            ...(stored.dockSize ? { dockSize: { ...stored.dockSize } } : {}),
            ...(stored.detachedBounds ? { detachedBounds: { ...stored.detachedBounds } } : {})
          })
        }
        for (const stored of pruned.document.workspaces) {
          const workspace = workspaces.get(stored.workspaceInstanceKey)
          if (!workspace) continue
          workspace.panelOrder = stored.panelOrder.filter((key) => panels.has(key))
          for (const mode of DOCK_MODES) {
            const key = stored.activePanels[mode]
            if (key !== undefined && panels.get(key)?.open === true && panels.get(key)?.mode === mode) workspace.activePanels[mode] = key
          }
          if (activeWorkspaceInstanceKey === null) activeWorkspaceInstanceKey = workspace.workspaceInstanceKey
        }
        revision += 1
        return { status: 'applied', snapshot: snapshot(), prunedWorkspaces, prunedPanels }
      })
    },
    getSnapshot(): WorkspaceSnapshot { return snapshot() },
    prepareForAppExit(): Promise<WorkspaceSnapshot> { return queue.enqueue(async () => { appExiting = true; for (const panel of panels.values()) panel.transfer = undefined; return snapshot() }) },
    /**
     * 开启分离/回停靠事务。`targetHost` 是 P1-06c 新增的身份贯通通道：Main 已经把目标窗口身份（例如
     * P1-04 registry 预留并登记的那一个）握在手里时，必须把**同一个** `{windowInstanceId, hostEpoch}`
     * 传进来，store 不再自造；缺省时保留 P1-05 原有语义（detached 自造 window id，其它模式回主窗哨兵）。
     */
    _beginTransfer(input: { requestId: string; requestScope?: string; expectedRevision: number; hostEpoch: number; windowInstanceId: string; panelInstanceKey: string; targetMode: PanelContainerMode; targetHost?: WorkspaceHost }): Promise<{ status: 'preparing'; operation: { operationId: string; source: WorkspaceHost; target: WorkspaceHost; targetMode: PanelContainerMode }; snapshot: WorkspaceSnapshot } | WorkspaceCommandResult> {
      return remember(input, '_beginTransfer', () => reject('invalid-request'), () => {
        const panel = panels.get(input.panelInstanceKey); const registration = panel && options.panelRegistry.get(panel.panelId)
        if (!panel || !registration) return reject('registration-missing'); if (!validRevision(input.expectedRevision)) return reject('stale-revision'); if (appExiting) return reject('main-window-closing')
        if (panel.transfer) return reject('transfer-in-progress'); if (input.targetMode === 'detached' && panel.mode !== 'detached' && detachedCount() >= WorkspaceTransferPolicy.maxDetachedHosts) return reject('limit-reached')
        if (!owns(input, panel.host) || !registration.supportedModes.includes(input.targetMode)) return reject('not-owner')
        if (input.targetHost !== undefined && !validTargetHost(input.targetHost)) return reject('invalid-request')
        const operationId = createId('operation'); const target = input.targetHost !== undefined
          ? copyHost(input.targetHost)
          : input.targetMode === 'detached'
            ? { windowInstanceId: createId('window'), hostEpoch: panel.host.hostEpoch + 1 }
            : { windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch }
        panel.transfer = { operationId, phase: 'awaiting-source-prepared', source: copyHost(panel.host), target, targetMode: input.targetMode, deadlineAt: now() + WorkspaceTransferPolicy.prepareTargetTimeoutMs }; revision += 1
        return { status: 'preparing', operation: { operationId, source: copyHost(panel.host), target: copyHost(target), targetMode: input.targetMode }, snapshot: snapshot() }
      })
    },
    _sourcePrepared(operationId: string, host: WorkspaceHost, accepted = true): Promise<{ accepted: boolean }> { return queue.enqueue(async () => { const found = findTransfer(operationId); if (!found || found.transfer.phase !== 'awaiting-source-prepared' || found.transfer.source.windowInstanceId !== host.windowInstanceId || found.transfer.source.hostEpoch !== host.hostEpoch || expired(found.transfer) || appExiting) return { accepted: false }; if (!accepted) { found.panel.transfer = undefined; revision += 1; return { accepted: false } } found.transfer.phase = 'awaiting-target-ready'; found.transfer.deadlineAt = now() + WorkspaceTransferPolicy.prepareTargetTimeoutMs; return { accepted: true } }) },
    _targetReady(operationId: string, host: WorkspaceHost): Promise<{ accepted: boolean }> { return queue.enqueue(async () => { const found = findTransfer(operationId); if (!found || found.transfer.phase !== 'awaiting-target-ready' || found.transfer.target.windowInstanceId !== host.windowInstanceId || found.transfer.target.hostEpoch !== host.hostEpoch || expired(found.transfer) || appExiting) return { accepted: false }; found.transfer.phase = 'awaiting-source-release'; found.transfer.deadlineAt = now() + WorkspaceTransferPolicy.releaseTimeoutMs; return { accepted: true } }) },
    _sourceReleased(operationId: string, host: WorkspaceHost): Promise<{ accepted: boolean }> { return queue.enqueue(async () => { const found = findTransfer(operationId); if (!found || found.transfer.phase !== 'awaiting-source-release' || found.transfer.source.windowInstanceId !== host.windowInstanceId || found.transfer.source.hostEpoch !== host.hostEpoch || expired(found.transfer) || appExiting) return { accepted: false }; found.transfer.phase = 'awaiting-commit'; found.transfer.deadlineAt = now() + WorkspaceTransferPolicy.releaseTimeoutMs; return { accepted: true } }) },
    _commitTransfer(operationId: string): Promise<{ accepted: boolean }> { return queue.enqueue(async () => { const found = findTransfer(operationId); if (!found || found.transfer.phase !== 'awaiting-commit' || expired(found.transfer) || appExiting) return { accepted: false }; const workspace = workspaces.get(found.panel.workspaceInstanceKey); if (workspace && found.panel.mode !== 'detached') selectReplacement(workspace, found.panel.mode, found.panel.panelInstanceKey); found.panel.host = copyHost(found.transfer.target); found.panel.mode = found.transfer.targetMode; if (found.panel.mode !== 'detached' && workspace) { activeWorkspaceInstanceKey = workspace.workspaceInstanceKey; setActive(workspace, found.panel) } if (found.panel.mode !== 'detached') found.panel.lastValidDock = found.panel.mode; found.panel.transfer = undefined; revision += 1; return { accepted: true } }) },
    _expireTransfer(operationId: string): Promise<{ accepted: boolean }> { return queue.enqueue(async () => { const found = findTransfer(operationId); if (!found || !expired(found.transfer)) return { accepted: false }; found.panel.transfer = undefined; revision += 1; return { accepted: true } }) }
  })
}
