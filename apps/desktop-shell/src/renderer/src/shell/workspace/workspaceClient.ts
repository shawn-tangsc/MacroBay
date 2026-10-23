import { isAppLanguage, timeZoneIdPattern, type AppLanguage } from '@platform/settings/schema/appSettings'
import { resolveSystemTimeZone } from '@platform/ui/time/shellTimeFormat'
import type {
  PanelContainerMode,
  WorkspaceCommandResult,
  WorkspaceTabCommandResult,
  WorkspaceTabSnapshot,
  WorkspaceTabState,
  WorkspacePageLayout,
  WorkspacePanelResult,
  WorkspacePanelSnapshot,
  WorkspacePendingTransferView,
  WorkspacePreparation,
  WorkspaceSnapshot,
  WorkspaceTransferPhase
} from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy } from '@platform/workspace/policies'
import type { WorkspaceContentAdapter, WorkspacePanelHostPort } from './workspaceHostAdapter'

/**
 * Owner: apps/desktop-shell renderer / workspace 宿主桥（P1-06b）。
 * 权威：P1-06a 的受控 preload `window.platform.workspace`、技术设计 §4「renderer 不持有第二份布局权威」。
 *
 * 职责：校验不可信 IPC 响应（畸形 fail closed）；实现 P1-03 的 `WorkspacePanelHostPort`（单调有界的
 * requestId + 最近一次权威快照的 expectedRevision + 上下文里的宿主身份）；订阅 `onEvent` 并重取权威
 * 快照（事件只带 revision，快照正文只在 getSnapshot 里）。P1-06d：`detach` 复用 command 通道的
 * `detachPanel`（只传 panelInstanceKey，目标窗口/bounds/operationId 全由 Main 推导）；Main 未接线编排时
 * 返回 `unsupported`，P1-03 宿主据此 fail closed。不 import 产品代码，不读 URL/localStorage，不启动 Electron。
 */

/** 与 Main 侧校验一致的长度上限（`panelWorkspacePayloadGuard.ts` 的 MAX_ID_LENGTH）。 */
const MAX_ID_LENGTH = 200
/** requestId（P1-06g / D2）：`ws-renderer-<实例标识>-<序号>`。实例标识必须跨 client 实例唯一，否则同窗
 *  重载/HMR 后新实例会命中 Main 幂等缓存（key = `requestScope:requestId`）里的旧响应而被静默丢弃。 */
const COMMAND_REQUEST_ID_PREFIX = 'ws-renderer-'
const COMMAND_REQUEST_ID_CYCLE = 1_000_000_000
function createRequestIdNonce(): string { // 实例标识（12 位）：优先 randomUUID，缺失时退化为时间 + 随机后缀
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  const uuid = typeof cryptoApi?.randomUUID === 'function' ? cryptoApi.randomUUID() : ''
  return uuid === '' ? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` : uuid.replace(/-/gu, '').slice(0, 12)
}
const DEFAULT_APP_LANGUAGE: AppLanguage = 'en-US'
const PANEL_MODES: readonly string[] = ['embedded', 'docked-right', 'docked-bottom', 'detached']
/** activePanels 的键与 lastValidDock 只允许非 detached 的停靠模式。 */
const DOCK_MODES: readonly string[] = ['embedded', 'docked-right', 'docked-bottom']
const BINDING_STATES: readonly string[] = ['bound', 'unavailable']
const PERSISTENCE_STATES: readonly string[] = ['saved', 'pending', 'failed']
const PRESENTATIONS: readonly string[] = ['normal', 'overlay', 'exclusive']
const EVENT_TYPES: readonly string[] = ['open', 'close', 'restore', 'host-attach', 'host-detach', 'host-reparent',
  'container-change-requested', 'container-changing', 'container-changed', 'fallback', 'snapshot', 'persistence-state']
/** P1-06f：受控待接管视图的状态与相位白名单（白名单外的形状一律 fail closed）。 */
const PENDING_TRANSFER_STATUSES: readonly string[] = ['reserved', 'in-flight']
const TRANSFER_PHASES: readonly string[] = [
  'awaiting-source-prepared', 'awaiting-target-ready', 'awaiting-source-release', 'awaiting-commit'
]

/** 宿主桥的形状（受控 preload 命名空间的结构子集）；形状不符即视为「没有 workspace 能力」。
 *  `hostLifecycle` 是 P1-06f 新增的可选能力：缺失即「没有 ACK 能力」，绝不假装 ready。 */
export type WorkspaceBridge = {
  getHostContext: () => Promise<unknown>
  getSnapshot: () => Promise<unknown>
  command: (request: unknown) => Promise<unknown>
  hostLifecycle?: (request: unknown) => Promise<unknown>
  onEvent: (listener: (event: unknown) => void) => () => void
}

export type WorkspaceHostMount = {
  workspaceInstanceKey: string; panelInstanceKey: string; panelId: string
  open: boolean; mode: PanelContainerMode; bindingState: WorkspacePanelSnapshot['bindingState']
}

/** renderer 侧的宿主上下文视图（字段镜像 Main 的 WorkspaceHostContext，但不 import Main 模块）。 */
export type WorkspaceHostContext = {
  windowInstanceId: string; hostEpoch: number; role: 'main' | 'panel'; layoutRevision: number
  mounts: readonly WorkspaceHostMount[]
  /** P1-06f：受控待接管视图（未参与转移的窗口恒为 null）；它只回答「我是不是待接管目标」，不给布局权限。 */
  pendingTransfer: WorkspacePendingTransferView | null
  pageIds: readonly string[]
  preferences: { language: AppLanguage; theme: string; timeZone: string }
}

export type WorkspaceHostContextOutcome = { status: 'ok'; context: WorkspaceHostContext } | { status: 'rejected'; reason: string }

/** 宿主生命周期 ACK 的受控形状（与 Main 的 payload 白名单逐字对应，renderer 不能带任何自造身份）。 */
export type WorkspaceHostLifecycleAck =
  | { operationId: string; phase: 'source-prepared'; accepted: boolean }
  | { operationId: string; phase: 'target-ready' | 'source-released' | 'source-invalid' | 'native-close' }
  | { operationId: string; phase: 'window-failure'; kind: 'crash' | 'unresponsive' }
export type WorkspaceHostLifecycleResult = { accepted: boolean; reason?: string }

export type WorkspaceClientErrorCode = 'no-host-identity' | 'no-authoritative-revision' | 'invalid-command-response'

/** 命令无法安全发出时抛出的具名错误；宿主会把它显示成通用失败提示，不回传错误正文。 */
export class WorkspaceClientError extends Error {
  readonly name = 'WorkspaceClientError'
  constructor(readonly code: WorkspaceClientErrorCode) { super(code) }
}

export type WorkspaceClient = {
  readHostContext: () => Promise<WorkspaceHostContextOutcome>
  /** 取权威快照；响应畸形或传输失败返回 null（调用方据此走安全 error-shell）。 */
  loadSnapshot: () => Promise<WorkspaceSnapshot | null>
  /** 立即重取权威快照并通知订阅者（提交后同步/准备期兜底用）；畸形响应返回 null。 */
  reload: () => Promise<WorkspaceSnapshot | null>
  /** 订阅权威快照更新；返回的退订函数幂等，卸载时必须调用。 */
  observe: (listener: (snapshot: WorkspaceSnapshot) => void) => () => void
  getRevision: () => number | null
  /** 桥是否提供 ACK 能力（缺失时一切 ACK 请求 fail closed）。 */
  canSendHostLifecycle: () => boolean
  /** 发送宿主生命周期 ACK；能力缺失/无身份/响应畸形一律返回 accepted:false（绝不假装成功）。 */
  sendHostLifecycle: (request: WorkspaceHostLifecycleAck) => Promise<WorkspaceHostLifecycleResult>
  port: WorkspacePanelHostPort
  dispose: () => void
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function isId(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH
}
function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value)
}
function isSafeIntAtLeast(minimum: number) {
  return (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}
const isEpoch = isSafeIntAtLeast(1) // hostEpoch 从 1 起（Main 的窗口 registry）
const isRevision = isSafeIntAtLeast(0)

function isMount(value: unknown): boolean {
  const record = asRecord(value)
  return record !== null && isId(record.workspaceInstanceKey) && isId(record.panelInstanceKey) && isId(record.panelId)
    && typeof record.open === 'boolean' && isOneOf(record.mode, PANEL_MODES) && isOneOf(record.bindingState, BINDING_STATES)
}
/** 面板条目：windowInstanceId 允许 null（未挂载）；dockSize 存在时必须合法；hostEpoch 必须是合法 epoch。 */
function isPanel(value: unknown): boolean {
  const record = asRecord(value)
  if (record === null) return false
  if (record.windowInstanceId !== null && !isId(record.windowInstanceId)) return false
  const size = record.dockSize === undefined ? null : asRecord(record.dockSize)
  if (record.dockSize !== undefined && (size === null || !Number.isFinite(size.width) || !Number.isFinite(size.height))) return false
  return isId(record.workspaceInstanceKey) && isId(record.panelInstanceKey) && isId(record.panelId)
    && typeof record.open === 'boolean' && isOneOf(record.mode, PANEL_MODES) && isOneOf(record.presentation, PRESENTATIONS)
    && isOneOf(record.bindingState, BINDING_STATES) && isOneOf(record.lastValidDock, DOCK_MODES) && isEpoch(record.hostEpoch)
}
function isPageLayout(value: unknown): boolean {
  const record = asRecord(value)
  const active = record === null ? null : asRecord(record.activePanels)
  if (record === null || active === null || !isId(record.workspaceInstanceKey) || !Array.isArray(record.panelOrder)) return false
  return record.panelOrder.every(isId) && Object.entries(active).every(([mode, key]) => isOneOf(mode, DOCK_MODES) && isId(key))
}

/** 权威快照白名单校验：必需字段全部合法才接受（不猜测、不局部降级）。顶层按契约重建（IPC 的额外字段不
 * 进入 renderer 状态，防止未知字段渗入窗口状态）；panels/pageLayouts 条目已逐字段校验，按契约引用。 */
export function readWorkspaceSnapshot(value: unknown): WorkspaceSnapshot | null {
  const record = asRecord(value)
  if (record === null || !isRevision(record.layoutRevision) || !isOneOf(record.persistenceState, PERSISTENCE_STATES)) return null
  if (record.activeWorkspaceInstanceKey !== null && !isId(record.activeWorkspaceInstanceKey)) return null
  if (!Array.isArray(record.panels) || !record.panels.every(isPanel)) return null
  if (!Array.isArray(record.pageLayouts) || !record.pageLayouts.every(isPageLayout)) return null
  return {
    layoutRevision: record.layoutRevision as number, activeWorkspaceInstanceKey: record.activeWorkspaceInstanceKey as string | null,
    panels: record.panels as readonly WorkspacePanelSnapshot[], pageLayouts: record.pageLayouts as readonly WorkspacePageLayout[],
    tabs: [], persistenceState: record.persistenceState as WorkspaceSnapshot['persistenceState']
  }
}

/**
 * 受控待接管视图校验：`null`/缺失 = 没有该视图；畸形 = `undefined`（整个上下文 fail closed）。
 * 视图里的 operationId/相位只能来自 Main，renderer 绝不自行拼装或由 URL/localStorage 推断。
 */
function readPendingTransfer(value: unknown): WorkspacePendingTransferView | null | undefined {
  if (value === null || value === undefined) return null
  const record = asRecord(value)
  if (record === null || !isOneOf(record.status, PENDING_TRANSFER_STATUSES)) return undefined
  if (!isId(record.workspaceInstanceKey) || !isId(record.panelInstanceKey) || !isId(record.panelId)) return undefined
  const identity = {
    workspaceInstanceKey: record.workspaceInstanceKey as string,
    panelInstanceKey: record.panelInstanceKey as string,
    panelId: record.panelId as string
  }
  if (record.status === 'reserved') {
    // 预留期不允许夹带 operationId/相位：那会诱导 renderer 自行认领飞事务
    if (record.operationId !== undefined || record.phase !== undefined) return undefined
    return { status: 'reserved', ...identity }
  }
  if (!isId(record.operationId) || !isOneOf(record.phase, TRANSFER_PHASES)) return undefined
  return {
    status: 'in-flight', operationId: record.operationId as string,
    phase: record.phase as WorkspaceTransferPhase, ...identity
  }
}

function readHostContext(value: unknown): WorkspaceHostContext | null {
  const record = asRecord(value)
  const context = record === null ? null : asRecord(record.context)
  if (record === null || record.status !== 'ok' || context === null) return null
  const role = context.role === 'main' || context.role === 'panel' ? context.role : null
  if (role === null || !isId(context.windowInstanceId) || !isEpoch(context.hostEpoch) || !isRevision(context.layoutRevision)) return null
  if (!Array.isArray(context.mounts) || !context.mounts.every(isMount)) return null
  if (!Array.isArray(context.pageIds) || !context.pageIds.every(isId)) return null
  const pendingTransfer = readPendingTransfer(context.pendingTransfer)
  if (pendingTransfer === undefined) return null
  const preferences = asRecord(context.preferences) ?? {}
  return {
    windowInstanceId: context.windowInstanceId as string, hostEpoch: context.hostEpoch as number, role,
    mounts: context.mounts as readonly WorkspaceHostMount[], pendingTransfer,
    layoutRevision: context.layoutRevision as number,
    pageIds: context.pageIds as readonly string[],
    // 只接受白名单语言与合法时区 id：白名单外一律回默认，绝不照抄未知字符串。
    preferences: {
      language: isAppLanguage(preferences.language) ? preferences.language : DEFAULT_APP_LANGUAGE,
      theme: typeof preferences.theme === 'string' && preferences.theme.length <= 32 ? preferences.theme : 'system',
      // 时区回落「跟随系统」的解析结果：既不猜地理时区，也不把非法字符串送进格式化器。
      timeZone: typeof preferences.timeZone === 'string' && timeZoneIdPattern.test(preferences.timeZone)
        ? preferences.timeZone
        : resolveSystemTimeZone()
    }
  }
}

function readCommandResult(value: unknown, panelInstanceKey: string): WorkspacePanelResult | null {
  const record = asRecord(value)
  if (record === null || (record.status !== 'applied' && record.status !== 'rejected')) return null
  const snapshot = readWorkspaceSnapshot(record.snapshot)
  if (snapshot === null) return null
  const errorCode = typeof record.errorCode === 'string' ? record.errorCode as NonNullable<WorkspaceCommandResult['errorCode']> : undefined
  return {
    status: record.status, snapshot,
    panelInstanceKey: isId(record.panelInstanceKey) ? record.panelInstanceKey as string : panelInstanceKey,
    ...(errorCode === undefined ? {} : { errorCode })
  }
}

/** 从宿主对象（默认 globalThis）读取受控 workspace 桥；形状不符返回 null（= 没有该能力）。 */
export function readWorkspaceBridge(host: unknown = globalThis): WorkspaceBridge | null {
  const workspace = asRecord(asRecord(asRecord(host)?.platform)?.workspace)
  if (workspace === null) return null
  if (!['getHostContext', 'getSnapshot', 'command', 'onEvent'].every((method) => typeof workspace[method] === 'function')) return null
  const call = <T,>(name: string, ...args: unknown[]): T => (workspace[name] as (...inner: unknown[]) => T).call(workspace, ...args)
  // hostLifecycle 是可选能力：缺失即「没有 ACK 能力」，调用方必须据此 fail closed（也绝不能伪造一个发送器）
  const hostLifecycle = typeof workspace.hostLifecycle === 'function'
    ? (request: unknown) => Promise.resolve(call<Promise<unknown>>('hostLifecycle', request))
    : undefined
  return {
    getHostContext: () => Promise.resolve(call<Promise<unknown>>('getHostContext')),
    getSnapshot: () => Promise.resolve(call<Promise<unknown>>('getSnapshot')),
    command: (request) => Promise.resolve(call<Promise<unknown>>('command', request)),
    ...(hostLifecycle === undefined ? {} : { hostLifecycle }),
    onEvent: (listener) => {
      const unsubscribe = call<unknown>('onEvent', listener)
      return typeof unsubscribe === 'function' ? unsubscribe as () => void : () => undefined
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * PLAT-05：能力就绪登记（**每渲染进程 = 每窗口一份**，renderer 本地；不新增通道、不新增 preload 方法）。
 *
 * 缺陷证据：应用启动早期若在 Main 侧 `.tabs.*` handler 注册**之前**发出受控读取，Main 会打
 * `Error occurred in handler for 'platform:workspace-tabs-get-snapshot': Error: No handler registered …`
 * （P2-15 `focused-stderr.txt` 第 1 行；P2-06T 基线同类噪声）。renderer 只是 fail closed（不崩、不假装
 * 有 Tab 能力），但启动日志被污染、真机归因容易被误判成产品失败。
 *
 * 就绪的**正面证据只有两个，且都不发 invoke**：
 *  ① 同窗既有的受控角色握手（`workspace.getHostContext()`，窗口根判定角色时已经发起）成功 ——
 *     `.tabs.*` 三个通道与面板四个通道在 `composePanelWorkspace.start()` 里**同一批注册**，
 *     所以「握手成功」是「`.tabs.*` handler 已注册」的**可靠证明**；
 *  ② Main 投递的受控 `workspaceEvent` 到达（事件只可能来自已注册的 Main 侧）。
 * 反面证据（握手被拒 / 传输失败）一旦出现，首次权威读取**永久放弃**：零补打、零重试、零忙轮询。
 * 判定是**单调**的（第一个证据定音），因此不存在「反复变卦」的读取抖动。
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

export type WorkspaceCapabilityReadiness = 'unknown' | 'ready' | 'unavailable'

let capabilityReadiness: WorkspaceCapabilityReadiness = 'unknown'
const capabilityReadyWaiters = new Set<() => void>()

/** 正面证据（受控握手成功 / 受控事件到达）：一次性放行所有已武装的补读（每次读取各自单飞）。 */
export function markWorkspaceCapabilityReady(): void {
  if (capabilityReadiness !== 'unknown') return
  capabilityReadiness = 'ready'
  for (const run of [...capabilityReadyWaiters]) { capabilityReadyWaiters.delete(run); run() }
}

/** 反面证据（握手被拒 / 传输失败 / 首次读取证实能力缺席）：首次权威读取放弃，绝不「先打一枪再重试」。 */
export function markWorkspaceCapabilityUnavailable(): void {
  if (capabilityReadiness === 'unknown') capabilityReadiness = 'unavailable'
}

/** 诊断出口：当前窗口的能力就绪判定（`unknown` = 尚无正证也尚无反证）。 */
export function workspaceCapabilityReadiness(): WorkspaceCapabilityReadiness {
  return capabilityReadiness
}

/**
 * 源侧待推进的 ACK 任务（P1-06f）：只由「权威快照里本窗承载的飞事务」派生；
 * 别的宿主的转移（redock 的源等）绝不代发 ACK。
 */
export type WorkspaceSourceAckTask = {
  key: string
  operationId: string
  phase: 'awaiting-source-prepared' | 'awaiting-source-release'
  panelInstanceKey: string
  panelId: string
}

/** 源身份桥：主窗在 store 里是哨兵身份，独立宿主用自己的实例身份（与 Main 的 `toStoreHostIdentity` 对齐）。 */
function sourceIdentityOf(context: WorkspaceHostContext): { windowInstanceId: string; hostEpoch: number } {
  return context.role === 'main'
    ? { windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: context.hostEpoch }
    : { windowInstanceId: context.windowInstanceId, hostEpoch: context.hostEpoch }
}

/** 本窗正在失去承载权的面板（快照里有 transfer 且当前宿主就是本窗，且相位需要源动作）。 */
export function planSourceAckTasks(
  context: WorkspaceHostContext,
  snapshot: WorkspaceSnapshot | null
): readonly WorkspaceSourceAckTask[] {
  if (snapshot === null) return []
  const identity = sourceIdentityOf(context)
  const tasks: WorkspaceSourceAckTask[] = []
  for (const panel of snapshot.panels) {
    const transfer = panel.transfer
    if (transfer === undefined) continue
    if (transfer.phase !== 'awaiting-source-prepared' && transfer.phase !== 'awaiting-source-release') continue
    if (panel.windowInstanceId !== identity.windowInstanceId || panel.hostEpoch !== identity.hostEpoch) continue
    tasks.push({
      key: `${transfer.operationId}:${transfer.phase}`, operationId: transfer.operationId, phase: transfer.phase,
      panelInstanceKey: panel.panelInstanceKey, panelId: panel.panelId
    })
  }
  return tasks
}

export type WorkspaceSourceAckRunner = {
  /** 已受理（含在飞）的 task key，供诊断；同 key 绝不重复发送。 */
  acceptedKeys: () => readonly string[]
  /** 事务收敛清理（P1-06g 非阻塞②）：声明仍在飞的 key，其余立即淘汰；返回淘汰条数（在飞的绝不被淘汰）。 */
  retain: (liveKeys: readonly string[]) => number
  run: (task: WorkspaceSourceAckTask, adapter: WorkspaceContentAdapter) => Promise<void>
}

/** 已受理 key 的历史上界（只影响诊断历史，不影响 ACK 发出）。 */
const SOURCE_ACK_HISTORY_LIMIT = 128

/**
 * 源侧 ACK 链执行器：先按 P1-03 语义 prepare，再发 `source-prepared`（失败/超时 ⇒ `accepted:false`，绝不静默）；
 * 进入 `awaiting-source-release` 后 release，只有真的释放成功才发 `source-released`（失败一律 fail closed，
 * 绝不冒名 commit）。每个 task.key 只执行一次，ACK 被接受后立即重取权威快照；已受理集合有界（收敛清理 + 上界）。
 */
export function createWorkspaceSourceAckRunner(client: WorkspaceClient): WorkspaceSourceAckRunner {
  const handled = new Set<string>()
  let liveKeys: ReadonlySet<string> = new Set<string>() // 最近声明的在飞 key；缺省为空集 ⇒ 未声明即视为可清理
  const evict = (onlyOverLimit: boolean): number => { // 淘汰非在飞记录；onlyOverLimit 时只淘汰上界之外的
    const doomed = [...handled].filter((key) => !liveKeys.has(key))
    const remove = onlyOverLimit ? doomed.slice(0, Math.max(0, handled.size - SOURCE_ACK_HISTORY_LIMIT)) : doomed
    for (const key of remove) handled.delete(key)
    return remove.length
  }
  return Object.freeze({
    acceptedKeys: (): readonly string[] => [...handled],
    retain: (live: readonly string[]): number => {
      liveKeys = new Set(live)
      return evict(false) // 收敛清理：除声明在飞的 key 外一律淘汰，因此绝不单调增长
    },
    async run(task: WorkspaceSourceAckTask, adapter: WorkspaceContentAdapter): Promise<void> {
      if (handled.has(task.key)) return
      handled.add(task.key)
      evict(true)
      if (task.phase === 'awaiting-source-prepared') {
        let preparation: WorkspacePreparation
        try {
          preparation = await adapter.prepare()
        } catch {
          preparation = { status: 'handoff-required', reason: 'unsupported-handoff' }
        }
        const accepted = preparation.status === 'ready'
        const result = await client.sendHostLifecycle({ operationId: task.operationId, phase: 'source-prepared', accepted })
        if (accepted && result.accepted) await client.reload()
        return
      }
      let released = false
      try {
        const outcome = await adapter.release()
        released = outcome.status === 'released' || outcome.reason === 'already-released'
      } catch {
        released = false
      }
      if (!released) return
      const result = await client.sendHostLifecycle({ operationId: task.operationId, phase: 'source-released' })
      if (result.accepted) await client.reload()
    }
  })
}

export function createWorkspaceClient(bridge: WorkspaceBridge): WorkspaceClient {
  let identity: { windowInstanceId: string; hostEpoch: number } | null = null
  let revision: number | null = null
  const requestIdNonce = createRequestIdNonce() // 每个 client（含重载后的新实例）都不同，requestId 绝不重号
  let sequence = 0
  let disposed = false
  let refreshing = false
  let refreshQueued = false
  let unsubscribeEvents: (() => void) | null = null
  const listeners = new Set<(snapshot: WorkspaceSnapshot) => void>()

  /** 只接受「不更旧」的权威值，避免乱序响应把 revision 拉回去。 */
  const adoptRevision = (value: number): void => {
    if (revision === null || value >= revision) revision = value
  }

  const loadSnapshot = async (): Promise<WorkspaceSnapshot | null> => {
    let raw: unknown
    try { raw = await bridge.getSnapshot() } catch { return null }
    const record = asRecord(raw)
    if (record === null || record.status !== 'ok') return null
    const snapshot = readWorkspaceSnapshot(record.snapshot)
    if (snapshot === null) return null
    adoptRevision(snapshot.layoutRevision)
    return snapshot
  }

  /** 事件合并重取：同一时刻至多一条在飞请求，期间到达的事件只置一次排队标记。 */
  const refresh = async (): Promise<void> => {
    if (disposed) return
    if (refreshing) {
      refreshQueued = true
      return
    }
    refreshing = true
    try {
      do {
        refreshQueued = false
        const snapshot = await loadSnapshot()
        if (disposed) return
        if (snapshot !== null) for (const listener of [...listeners]) listener(snapshot)
      } while (refreshQueued && !disposed)
    } finally { refreshing = false }
  }

  const handleEvent = (raw: unknown): void => {
    if (disposed) return
    const record = asRecord(raw)
    if (record === null || !isOneOf(record.type, EVENT_TYPES) || !isRevision(record.layoutRevision)) return
    // PLAT-05：受控事件只可能来自已注册的 Main 侧 ⇒ 它本身就是能力就绪的正证（不发任何 invoke）。
    markWorkspaceCapabilityReady()
    // 事件只带 revision/scope，快照正文必须回 Main 取；scope 已由 Main 按宿主投影，renderer 不再二次过滤。
    void refresh()
  }

  /** 立即重取 + 通知订阅者：准备期/提交后同步用（不做「单飞合并」，调用方自己保证节奏有界）。 */
  const reload = async (): Promise<WorkspaceSnapshot | null> => {
    const snapshot = await loadSnapshot()
    if (!disposed && snapshot !== null) for (const listener of [...listeners]) listener(snapshot)
    return snapshot
  }

  /** 宿主生命周期 ACK：身份取自受控上下文（renderer 不可自选），响应畸形一律 accepted:false。 */
  const sendHostLifecycle = async (request: WorkspaceHostLifecycleAck): Promise<WorkspaceHostLifecycleResult> => {
    if (disposed) return { accepted: false, reason: 'disposed' }
    const send = bridge.hostLifecycle
    if (send === undefined) return { accepted: false, reason: 'capability-missing' }
    if (identity === null) return { accepted: false, reason: 'no-host-identity' }
    let raw: unknown
    try {
      raw = await send(Object.freeze({
        ...request, windowInstanceId: identity.windowInstanceId, hostEpoch: identity.hostEpoch
      }))
    } catch { return { accepted: false, reason: 'transport-failed' } }
    const record = asRecord(raw)
    if (record === null || typeof record.accepted !== 'boolean') return { accepted: false, reason: 'invalid-response' }
    const reason = typeof record.reason === 'string' && record.reason.length <= MAX_ID_LENGTH ? record.reason : undefined
    return reason === undefined ? { accepted: record.accepted } : { accepted: record.accepted, reason }
  }

  const observe = (listener: (snapshot: WorkspaceSnapshot) => void): (() => void) => {
    if (disposed) return () => undefined
    listeners.add(listener)
    if (unsubscribeEvents === null) {
      let active = true
      const unsubscribe = bridge.onEvent(handleEvent)
      unsubscribeEvents = () => { if (active) { active = false; unsubscribe() } }
    }
    return () => {
      const unsubscribe = listeners.delete(listener) && listeners.size === 0 ? unsubscribeEvents : null
      if (unsubscribe === null) return
      unsubscribeEvents = null
      unsubscribe()
    }
  }

  const sendCommand = async (method: string, fields: Record<string, unknown>, panelInstanceKey: string): Promise<WorkspacePanelResult> => {
    if (identity === null) throw new WorkspaceClientError('no-host-identity')
    if (revision === null) throw new WorkspaceClientError('no-authoritative-revision')
    sequence = sequence >= COMMAND_REQUEST_ID_CYCLE ? 1 : sequence + 1
    const request = Object.freeze({
      method, requestId: `${COMMAND_REQUEST_ID_PREFIX}${requestIdNonce}-${sequence}`, expectedRevision: revision,
      windowInstanceId: identity.windowInstanceId, hostEpoch: identity.hostEpoch, ...fields
    })
    const raw = await bridge.command(request)
    const result = readCommandResult(raw, panelInstanceKey)
    if (result === null) throw new WorkspaceClientError('invalid-command-response')
    // 只消费权威 result.snapshot：renderer 不维护第二份 layout/active/open 权威。
    adoptRevision(result.snapshot.layoutRevision)
    return result
  }

  const port: WorkspacePanelHostPort = Object.freeze({
    activate: ({ panelInstanceKey }) => sendCommand('activatePanel', { panelInstanceKey }, panelInstanceKey),
    switchContainer: ({ panelInstanceKey, mode }) => sendCommand('switchContainer', { panelInstanceKey, mode }, panelInstanceKey),
    resize: ({ panelInstanceKey, size }) => sendCommand('resizePanel', { panelInstanceKey, dockSize: { width: size.width, height: size.height } }, panelInstanceKey),
    reset: ({ panelInstanceKey }) => sendCommand('resetPanelSize', { panelInstanceKey }, panelInstanceKey),
    close: ({ panelInstanceKey }) => sendCommand('closePanel', { panelInstanceKey }, panelInstanceKey),
    reopen: ({ panelInstanceKey }) => sendCommand('reopenPanel', { panelInstanceKey }, panelInstanceKey),
    // P1-06d：分离意图复用 command 通道；这是唯一新增方法，renderer 不携带任何目标窗口身份
    detach: ({ panelInstanceKey }) => sendCommand('detachPanel', { panelInstanceKey }, panelInstanceKey),
    // PLAT-40：回停靠同样复用既有 command 通道的一个受控方法（**不新增通道/preload 方法**）；
    // 目标停靠模式由 Main 按 lastValidDock + 受支持模式收敛，renderer 不传 mode。
    redock: ({ panelInstanceKey }) => sendCommand('redockPanel', { panelInstanceKey }, panelInstanceKey)
  })

  return Object.freeze({
    async readHostContext(): Promise<WorkspaceHostContextOutcome> {
      let raw: unknown
      try { raw = await bridge.getHostContext() } catch { markWorkspaceCapabilityUnavailable(); return { status: 'rejected', reason: 'transport-failed' } }
      const record = asRecord(raw)
      if (record !== null && record.status === 'rejected' && typeof record.errorCode === 'string') {
        markWorkspaceCapabilityUnavailable()
        return { status: 'rejected', reason: record.errorCode }
      }
      const context = readHostContext(raw)
      if (context === null) { markWorkspaceCapabilityUnavailable(); return { status: 'rejected', reason: 'invalid-context' } }
      // PLAT-05：这是本窗「受控面确实活着」的第一个正证（`.tabs.*` 与面板通道同批注册）⇒ 放行被门控的首次读取。
      markWorkspaceCapabilityReady()
      identity = { windowInstanceId: context.windowInstanceId, hostEpoch: context.hostEpoch }
      adoptRevision(context.layoutRevision)
      return { status: 'ok', context }
    },
    loadSnapshot,
    reload,
    observe,
    getRevision: () => revision,
    canSendHostLifecycle: () => bridge.hostLifecycle !== undefined,
    sendHostLifecycle,
    port,
    dispose(): void {
      disposed = true
      listeners.clear()
      unsubscribeEvents?.()
      unsubscribeEvents = null
    }
  })
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * P2-03：`.tabs.*` 的 renderer 桥。
 *
 * 与面板桥同一姿态：只消费受控通道、校验不可信响应（畸形 fail closed）、**不在 renderer 维护第二份
 * Tab 布局权威**（顺序/活动项/打开态只来自 Main 的快照），事件只带 revision ⇒ 一律重取权威快照。
 * 事件与面板共用同一个 `workspaceEvent` 订阅（不新增事件通道、不扩事件词汇白名单）。
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** `.tabs.*` 桥的结构子集；形状不符即视为「没有 Tab 能力」（fail closed，绝不假装 ready）。
 *  `tabsHostLifecycle` 是 P2-07 新增的**可选**能力：缺失即「页窗没有 ACK 能力」，绝不假装 ready。 */
export type WorkspaceTabsBridge = {
  tabsGetSnapshot: () => Promise<unknown>
  tabsCommand: (request: unknown) => Promise<unknown>
  tabsHostLifecycle?: (request: unknown) => Promise<unknown>
  onEvent: (listener: (event: unknown) => void) => () => void
  /**
   * PLAT-05：**完整受控面**（面板握手可用）上由 `readWorkspaceTabsBridge` 打标 —— 该窗口存在可等待的
   * 就绪正证（同窗角色握手/受控事件），因此首次权威读取必须等到正证再发（未就绪一律不发 invoke）。
   * 手写/注入的纯 Tab 面不打标：没有可等待的信号，保持既有「立即读取 + fail closed」，不引入人为延迟。
   */
  capabilityGated?: true
}

/**
 * 形状校验：`.tabs.*` 两个受控方法 + 事件订阅缺一不可；宿主不是 `platform`/`platform` 没有 workspace
 * 命名空间时返回 null（fail closed，绝不假装有 Tab 能力）。
 * 与 `readWorkspaceBridge` 一样**直接读受控命名空间**：不经过面板桥的映射对象（那会丢掉 tabs 方法）。
 */
export function readWorkspaceTabsBridge(host: unknown = globalThis): WorkspaceTabsBridge | null {
  const workspace = asRecord(asRecord(asRecord(host)?.platform)?.workspace)
  if (workspace === null) return null
  if (typeof workspace.tabsGetSnapshot !== 'function' || typeof workspace.tabsCommand !== 'function') return null
  if (typeof workspace.onEvent !== 'function') return null
  const call = <T,>(name: string, ...args: unknown[]): T => (workspace[name] as (...inner: unknown[]) => T).call(workspace, ...args)
  const tabsHostLifecycle = typeof workspace.tabsHostLifecycle === 'function'
    ? (request: unknown) => Promise.resolve(call<Promise<unknown>>('tabsHostLifecycle', request))
    : undefined
  return {
    tabsGetSnapshot: () => Promise.resolve(call<Promise<unknown>>('tabsGetSnapshot')),
    tabsCommand: (request) => Promise.resolve(call<Promise<unknown>>('tabsCommand', request)),
    ...(tabsHostLifecycle === undefined ? {} : { tabsHostLifecycle }),
    // PLAT-05：只有存在**可等待的就绪正证**（完整受控面 = 面板握手可用）时，首次权威读取才门控。
    ...(readWorkspaceBridge(host) === null ? {} : { capabilityGated: true as const }),
    onEvent: (listener) => {
      const unsubscribe = call<unknown>('onEvent', listener)
      return typeof unsubscribe === 'function' ? unsubscribe as () => void : () => undefined
    }
  }
}

export type WorkspaceTabClientPort = {
  openTab: (input: { pageId?: string; menuKey?: string; bindingKey?: string; newInstance?: boolean }) => Promise<WorkspaceTabCommandResult>
  activateTab: (input: { workspaceInstanceKey: string }) => Promise<WorkspaceTabCommandResult>
  closeTab: (input: { workspaceInstanceKey: string }) => Promise<WorkspaceTabCommandResult>
  closeOthers: (input: { workspaceInstanceKey: string }) => Promise<WorkspaceTabCommandResult>
  closeRight: (input: { workspaceInstanceKey: string }) => Promise<WorkspaceTabCommandResult>
  reopenLastClosed: (input?: { recentlyClosedCount?: number }) => Promise<WorkspaceTabCommandResult>
  reorderTabs: (input: { workspaceInstanceKeys: readonly string[] }) => Promise<WorkspaceTabCommandResult>
  /** P2-15：分离到独立页面窗（主窗唯一入口；准入链仍在 Main 的 `.tabs.detachTab`）。 */
  detachTab: (input: { workspaceInstanceKey: string }) => Promise<WorkspaceTabCommandResult>
  /** P2-15：从独立页面窗回停靠到主窗（页窗消费；原生关闭路径不变，仍是 P2-09 的默认回停靠）。 */
  redockTab: (input: { workspaceInstanceKey: string }) => Promise<WorkspaceTabCommandResult>
}

export type WorkspaceTabClient = {
  load: () => Promise<WorkspaceTabState | null>
  observe: (listener: (state: WorkspaceTabState) => void) => () => void
  getState: () => WorkspaceTabState | null
  /**
   * P2-07：最近一次权威读取里的受控待 ACK 投影（本窗未提交的分离事务）。
   * `null` = 没有 / 畸形 / 不属于本窗（renderer 绝不据此猜 operationId，更不自造身份）。
   */
  pendingDetach: () => WorkspaceTabPendingDetach | null
  /** `.tabs.*` 桥是否提供 ACK 能力（缺失时一切 ACK 请求 fail closed）。 */
  canSendHostLifecycle: () => boolean
  /** 发送页窗 ACK；能力缺失/无受控投影/operationId 不匹配/响应畸形一律 `accepted:false`（绝不假装成功）。 */
  sendHostLifecycle: (request: WorkspaceTabHostLifecycleAck) => Promise<WorkspaceHostLifecycleResult>
  port: WorkspaceTabClientPort
  dispose: () => void
}

/**
 * P2-07：`.tabs.*` 的受控待 ACK 投影（Main 的 `TabPendingDetachView` 逐字镜像）。
 * 身份也来自 Main（本窗的 registry 记录），因此 renderer 既不自选身份、也不自造 operationId。
 */
export type WorkspaceTabPendingDetach = { operationId: string; windowInstanceId: string; hostEpoch: number }

/** 页窗只允许报这一个相位：绝不代发 `source-released`/`source-invalid`（那是 Main/主窗的语义）。 */
export type WorkspaceTabHostLifecycleAck = { operationId: string; phase: 'target-ready' }

const TAB_MODES: readonly string[] = ['main', 'detached']
const TAB_COMMAND_METHODS = [
  'openTab', 'activateTab', 'closeTab', 'closeOthers', 'closeRight', 'reopenLastClosed', 'reorderTabs',
  'detachTab', 'redockTab', 'bindTab'
] as const

function readTabSnapshot(value: unknown): WorkspaceTabState | null {
  const record = asRecord(value)
  if (record === null || record.status !== 'ok') return null
  const snapshot = asRecord(record.snapshot)
  if (snapshot === null || !isRevision(snapshot.layoutRevision)) return null
  const active = snapshot.activeWorkspaceInstanceKey
  if (active !== null && !isId(active)) return null
  if (!Array.isArray(snapshot.tabs)) return null
  const tabs: WorkspaceTabSnapshot[] = []
  for (const entry of snapshot.tabs) {
    const tab = asRecord(entry)
    if (tab === null) return null
    if (!isId(tab.workspaceInstanceKey) || !isId(tab.pageId) || !isId(tab.menuKey) || typeof tab.open !== 'boolean') return null
    if (typeof tab.order !== 'number' || !isOneOf(tab.mode, TAB_MODES) || !isOneOf(tab.bindingState, BINDING_STATES)) return null
    if (!isId(tab.windowInstanceId) || !isEpoch(tab.hostEpoch)) return null
    tabs.push(Object.freeze({
      workspaceInstanceKey: tab.workspaceInstanceKey as string, pageId: tab.pageId as string,
      menuKey: tab.menuKey as string, open: tab.open, order: tab.order,
      mode: tab.mode as WorkspaceTabSnapshot['mode'],
      bindingState: tab.bindingState as WorkspaceTabSnapshot['bindingState'],
      windowInstanceId: tab.windowInstanceId as string, hostEpoch: tab.hostEpoch as number
    }))
  }
  return Object.freeze({
    layoutRevision: snapshot.layoutRevision as number,
    activeWorkspaceInstanceKey: active === null ? null : active as string,
    tabs: Object.freeze(tabs),
    recentlyClosedCount: readTabRecentlyClosedCount(snapshot.recentlyClosedCount)
  })
}

/**
 * P2-13：受控投影里的「最近关闭」条数（P2-01 `recentlyClosed()` 的条数，由 Main 从真实 store 派生）。
 * 缺省/`null` = 没有该投影；负数/小数/非有限数/非数字一律按 0（= 无）—— **fail closed**：
 * 「重开最近关闭」入口保持禁用并给出可见原因，绝不因畸形响应被点亮，也绝不由 renderer 自行推断。
 */
function readTabRecentlyClosedCount(value: unknown): number {
  if (value === undefined || value === null) return 0
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/**
 * P2-07：受控待 ACK 投影的严格解析。缺省/`null` = 没有该投影；**畸形一律视为没有**（绝不猜 operationId、
 * 也绝不放宽身份）—— 结果是页窗不发 ACK、Main 的截止时间如实回滚并投递 fallback（失败可见，不静默成功）。
 */
function readTabPendingDetach(value: unknown): WorkspaceTabPendingDetach | null {
  if (value === null || value === undefined) return null
  const record = asRecord(value)
  if (record === null || !isId(record.operationId) || !isId(record.windowInstanceId) || !isEpoch(record.hostEpoch)) return null
  return Object.freeze({
    operationId: record.operationId as string,
    windowInstanceId: record.windowInstanceId as string,
    hostEpoch: record.hostEpoch as number
  })
}

function readTabCommandResult(value: unknown): WorkspaceTabCommandResult | null {
  const record = asRecord(value)
  if (record === null || (record.status !== 'applied' && record.status !== 'rejected')) return null
  const snapshot = readTabSnapshot({ status: 'ok', snapshot: record.snapshot })
  if (snapshot === null) return null
  const errorCode = typeof record.errorCode === 'string' && record.errorCode.length <= MAX_ID_LENGTH ? record.errorCode : undefined
  const workspaceInstanceKey = typeof record.workspaceInstanceKey === 'string' ? record.workspaceInstanceKey : undefined
  return {
    status: record.status,
    snapshot,
    ...(errorCode === undefined ? {} : { errorCode: errorCode as WorkspaceTabCommandResult['errorCode'] }),
    ...(workspaceInstanceKey === undefined ? {} : { workspaceInstanceKey })
  }
}

/**
 * `.tabs.*` 客户端：受控 requestId（跨实例唯一）+ 最近一次权威 revision 作为 CAS + 事件合并重取。
 * 与面板客户端的差别只有一处：revision 来自 Tab 快照（两个 store 的 revision 空间不混用）。
 */
export function createWorkspaceTabClient(bridge: WorkspaceTabsBridge): WorkspaceTabClient {
  const requestIdNonce = createRequestIdNonce()
  let sequence = 0
  let revision: number | null = null
  let state: WorkspaceTabState | null = null
  /** P2-07：最近一次权威读取里的受控待 ACK 投影（畸形/缺失/非本窗 ⇒ null）。 */
  let pendingDetach: WorkspaceTabPendingDetach | null = null
  let disposed = false
  let refreshing = false
  let refreshQueued = false
  let unsubscribeEvents: (() => void) | null = null
  /** PLAT-05：首次权威读取是否已成功过一次（用于把「能力缺席」的补打限制成**有界的一次**）。 */
  let readSucceededOnce = false
  /** PLAT-05：已武装的「就绪后自动补一次」补读（单飞；dispose 时必须撤下）。 */
  let armedCapabilityRead: (() => void) | null = null
  const capabilityGated = bridge.capabilityGated === true
  const listeners = new Set<(state: WorkspaceTabState) => void>()

  const adopt = (value: number): void => { if (revision === null || value >= revision) revision = value }

  const load = async (): Promise<WorkspaceTabState | null> => {
    if (disposed) return null
    /**
     * PLAT-05 ①③：能力**未就绪**时一次 invoke 都不发 —— 在 Main 尚未注册 `.tabs.*` handler 时打枪只会
     * 让 Main 打一行 `No handler registered` 噪声（行为上仍然只是 fail closed）。
     * 正证到达后由 `armCapabilityRead` 自动补一次（④）；反证（握手被拒）后永久放弃（零重试、零轮询）。
     */
    if (capabilityGated && capabilityReadiness !== 'ready') {
      armCapabilityRead()
      return null
    }
    let raw: unknown
    try { raw = await bridge.tabsGetSnapshot() } catch {
      // PLAT-05 ③：首次读取就证实能力缺席（组合里根本没有 `.tabs.*` handler）⇒ 永久放弃，绝不重试风暴。
      if (capabilityGated && !readSucceededOnce) markWorkspaceCapabilityUnavailable()
      pendingDetach = null
      return null
    }
    const next = readTabSnapshot(raw)
    // 畸形响应一律 fail closed：连待 ACK 投影一起清空（页窗因此不会对幽灵事务报 ready）
    if (next === null) { pendingDetach = null; return null }
    readSucceededOnce = true
    adopt(next.layoutRevision)
    state = next
    pendingDetach = readTabPendingDetach(asRecord(raw)?.pendingDetach)
    return next
  }

  const notify = (): void => { if (state !== null) for (const listener of [...listeners]) listener(state) }

  const refresh = async (): Promise<void> => {
    if (disposed) return
    if (refreshing) { refreshQueued = true; return }
    refreshing = true
    try {
      do {
        refreshQueued = false
        const next = await load()
        if (disposed) return
        if (next !== null) notify()
      } while (refreshQueued && !disposed)
    } finally { refreshing = false }
  }

  /**
   * PLAT-05 ④：就绪正证到达后**自动补一次**权威读取（用户不需要手动刷新）。
   * 只武装一次、只跑一次、只在正证（`ready`）下跑；反证（`unavailable`）绝不补打 —— 有界、无忙轮询。
   */
  const armCapabilityRead = (): void => {
    if (disposed || armedCapabilityRead !== null) return
    if (capabilityReadiness === 'unavailable') return
    const run = (): void => {
      armedCapabilityRead = null
      if (disposed || capabilityReadiness !== 'ready') return
      void refresh()
    }
    if (capabilityReadiness === 'ready') { run(); return }
    armedCapabilityRead = run
    capabilityReadyWaiters.add(run)
  }

  const send = async (method: string, fields: Record<string, unknown>): Promise<WorkspaceTabCommandResult> => {
    if (revision === null) throw new WorkspaceClientError('no-authoritative-revision')
    sequence = sequence >= COMMAND_REQUEST_ID_CYCLE ? 1 : sequence + 1
    const request = Object.freeze({
      method, requestId: `${COMMAND_REQUEST_ID_PREFIX}tabs-${requestIdNonce}-${sequence}`,
      expectedRevision: revision, ...fields
    })
    const raw = await bridge.tabsCommand(request)
    const result = readTabCommandResult(raw)
    if (result === null) throw new WorkspaceClientError('invalid-command-response')
    // 只消费权威 result.snapshot：renderer 不维护第二份 Tab 权威
    adopt(result.snapshot.layoutRevision)
    state = result.snapshot
    return result
  }

  const port: WorkspaceTabClientPort = Object.freeze({
    openTab: (input) => send('openTab', {
      ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
      ...(input.menuKey === undefined ? {} : { menuKey: input.menuKey }),
      ...(input.bindingKey === undefined ? {} : { bindingKey: input.bindingKey }),
      ...(input.newInstance === undefined ? {} : { newInstance: input.newInstance })
    }),
    activateTab: (input) => send('activateTab', { workspaceInstanceKey: input.workspaceInstanceKey }),
    closeTab: (input) => send('closeTab', { workspaceInstanceKey: input.workspaceInstanceKey }),
    closeOthers: (input) => send('closeOthers', { workspaceInstanceKey: input.workspaceInstanceKey }),
    closeRight: (input) => send('closeRight', { workspaceInstanceKey: input.workspaceInstanceKey }),
    reopenLastClosed: () => send('reopenLastClosed', {}),
    reorderTabs: (input) => send('reorderTabs', { workspaceInstanceKeys: input.workspaceInstanceKeys }),
    detachTab: (input) => send('detachTab', { workspaceInstanceKey: input.workspaceInstanceKey }),
    redockTab: (input) => send('redockTab', { workspaceInstanceKey: input.workspaceInstanceKey })
  })

  const handleEvent = (raw: unknown): void => {
    if (disposed) return
    const record = asRecord(raw)
    if (record === null || !isOneOf(record.type, EVENT_TYPES) || !isRevision(record.layoutRevision)) return
    // PLAT-05：受控事件只可能来自已注册的 Main 侧 ⇒ 它本身就是能力就绪的正面证据（不发任何 invoke）。
    // 若已武装补读，则放行它（同一个单飞 `refresh()`）；否则按既有语义立即重取 —— 绝不「一门两读」。
    const armedWillRead = armedCapabilityRead !== null
    markWorkspaceCapabilityReady()
    if (!armedWillRead) void refresh()
  }

  /**
   * P2-07：页窗 ACK。身份与 operationId **只**来自最近一次受控投影（renderer 不能自选/沿用陈旧值）；
   * 能力缺失、没有投影、operationId 不匹配、响应畸形一律 `accepted:false`（绝不假装 ready）。
   */
  const sendHostLifecycle = async (request: WorkspaceTabHostLifecycleAck): Promise<WorkspaceHostLifecycleResult> => {
    if (disposed) return { accepted: false, reason: 'disposed' }
    const send = bridge.tabsHostLifecycle
    if (send === undefined) return { accepted: false, reason: 'capability-missing' }
    const current = pendingDetach
    if (current === null || current.operationId !== request.operationId) return { accepted: false, reason: 'no-pending-operation' }
    let raw: unknown
    try {
      raw = await send(Object.freeze({
        ...request, windowInstanceId: current.windowInstanceId, hostEpoch: current.hostEpoch
      }))
    } catch { return { accepted: false, reason: 'transport-failed' } }
    const record = asRecord(raw)
    if (record === null || typeof record.accepted !== 'boolean') return { accepted: false, reason: 'invalid-response' }
    const reason = typeof record.reason === 'string' && record.reason.length <= MAX_ID_LENGTH ? record.reason : undefined
    return reason === undefined ? { accepted: record.accepted } : { accepted: record.accepted, reason }
  }

  return Object.freeze({
    load,
    observe(listener: (next: WorkspaceTabState) => void): () => void {
      if (disposed) return () => undefined
      listeners.add(listener)
      if (unsubscribeEvents === null) {
        let active = true
        const unsubscribe = bridge.onEvent(handleEvent)
        unsubscribeEvents = () => { if (active) { active = false; unsubscribe() } }
      }
      return () => {
        const unsubscribe = listeners.delete(listener) && listeners.size === 0 ? unsubscribeEvents : null
        if (unsubscribe === null) return
        unsubscribeEvents = null
        unsubscribe()
      }
    },
    getState: () => state,
    pendingDetach: () => pendingDetach,
    canSendHostLifecycle: () => bridge.tabsHostLifecycle !== undefined,
    sendHostLifecycle,
    port,
    dispose(): void {
      disposed = true
      // PLAT-05：撤下已武装的补读（绝不留下一个会在 dispose 之后打枪的悬挂闭包）
      if (armedCapabilityRead !== null) { capabilityReadyWaiters.delete(armedCapabilityRead); armedCapabilityRead = null }
      listeners.clear()
      unsubscribeEvents?.()
      unsubscribeEvents = null
    }
  })
}

/** 受控方法名（诊断/测试用）：与 Main 的白名单逐字一致。 */
export type WorkspaceTabCommandMethod = (typeof TAB_COMMAND_METHODS)[number]
/** 只读出口：白名单本身（测试用它断言「renderer 不会发白名单外的方法」）。 */
export const WORKSPACE_TAB_COMMAND_METHODS: readonly WorkspaceTabCommandMethod[] = Object.freeze([...TAB_COMMAND_METHODS])
