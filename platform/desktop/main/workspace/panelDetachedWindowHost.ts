import type { PanelContainerMode, WorkspaceBounds, WorkspaceLifecycleEventType, WorkspaceSize } from '@platform/workspace/contracts'
import { WorkspaceTransferPolicy } from '@platform/workspace/policies'
import { createDetachedWindowBoundsCollector, type DetachedWindowBoundsEvent } from './detachedWindowBoundsCollector'
import {
  assertSecureWindowSecurity,
  isAllowedAppWindowEntryUrl,
  type WindowOpenHandlerTarget,
  type WorkspaceWindowSecurityInput
} from '../../window/createMainWindow'
import {
  normalizeDetachedBounds,
  resolveFailureFallbackMode,
  resolveUserDockMode,
  type DetachedWindowSizeConstraint,
  type DockMode,
  type WorkspaceDisplayInfo,
  type WorkspaceFallbackReason
} from './workspaceWindowBounds'
import type { WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。权威：技术设计 §4/§5/§6/§8 与 P1-04。
 * 只负责 Main 侧独立面板窗口的容器事务：窗口由注入工厂创建（不 new BrowserWindow、不组装应用、不碰主窗
 * 启动顺序），identity/预算来自 registry，bounds 与回退链来自 workspaceWindowBounds，安全集合与 entry
 * 白名单来自 window/createMainWindow。事务：reserve → 建窗（空壳）→ load 静态 entry → target ready →
 * 源 release ACK（或 Main 确认源失效）→ commit；超时一律 rollback（timeout ≠ 成功）。
 * **错误/超时**直接走 right→bottom→embedded 安全回退链，**用户回停靠/原生 X** 才先试 lastValidDock；
 * 失败原因如实区分：句柄能证明渲染器已崩溃（N6/P1-06g 的 `isCrashed`，含 N7/P1-06l 的崩溃订阅结论）才报
 * `window-crashed`，否则报 `window-load-failed`（加载/准备期失败），release 超时报 `content-error`；
 * **N7/P1-06l**：建窗即订阅句柄崩溃广播（准备期与已提交期同权）。未提交窗口与截止时间走同一条回滚；
 * 已提交窗口只回收窗口（登记销毁），失败词表与 store 回停靠由同步 `closed` → app 侧 `forgetHostWindow`
 * 收敛（恰一条 fallback、按安全回退链、定向存活主窗）—— 宿主在这里自己 emit 会与补发判据抢跑成两条。
 * 任何失败路径都销毁已建窗口（零孤儿），事件消费者抛错与定时器调度失败都不得阻断清理。
 * 同面板幂等（product-design.md:131、§4）：已 commit owner 再分离 ⇒ `focus()` + 具名 `already-detached`；未完成
 * operation ⇒ 合并返回同一个 `awaiting-ready`。原生 X 只是回停靠；app-exit 有界 flush（flushed/failed/timeout
 * 如实上报）、撤销 owner 并销毁派生窗，不写 open=false、不新建回停靠窗口。
 * **P1-06m**：面板命令的逻辑关闭收敛走 `closeDetachedWindow`（销毁 + 撤销 owner + 记逻辑关闭意图，绝不 redock、
 * 绝不补发 fallback），与用户回停靠、崩溃/外部销毁三条路径彻底分开。
 * 孤儿判定：只有 registry 完全不认识该身份才回收；已知窗口的陈旧 claim 只回 epoch-mismatch/not-owner。
 */

export type DetachedWindowHandle = WindowOpenHandlerTarget & {
  readonly webContentsId: number; loadURL: (url: string) => Promise<void>; isDestroyed: () => boolean; destroy: () => void; focus: () => void
  /**
   * N6/P1-06g：渲染器进程是否已崩溃（生产实现＝`webContents.isCrashed()`，见工厂）。
   * 可选：缺失即「无法判定崩溃」，失败路径仍如实报 `window-load-failed`，绝不猜测。
   */
  isCrashed?: () => boolean
  /**
   * N7/P1-06l：**崩溃订阅**（生产实现＝工厂的 `render-process-gone` 广播，见工厂），返回退订函数。
   * 与只读 `isCrashed()` 的关键差别：已提交窗没有任何决策点可被探测，僵尸态只能靠这条订阅**主动**送达；
   * 因此崩溃监测对准备期与已提交期同权。可选：缺失即「无法主动感知」，宿主保持既有 `close/closed`
   * 收敛路径（外部销毁仍由 app 侧桥收敛），绝不猜测。
   */
  onRendererGone?: (listener: () => void) => () => void
  /**
   * **PLAT-04**：窗口 bounds 变化广播（生产实现＝工厂对 `resize`/`move` 的去重广播），返回退订函数。
   *
   * 为什么由句柄广播而不是宿主轮询：宿主不 import electron（保持可单测），只有工厂持有真实 `BrowserWindow`。
   * 可选：缺失即「无法主动感知尺寸」，宿主**不采集、不猜测、不轮询**（绝不冒充实测值）。
   * 广播值允许是任意形状：宿主自己 fail closed（非有限/非正尺寸一律丢弃），绝不把 NaN 透传给受控状态。
   */
  onBoundsChanged?: (listener: (bounds: WorkspaceBounds) => void) => () => void
}

/** **PLAT-41**：工厂输入带上受控标题白名单（缺省 = `[title]`，既有调用方语义逐字不变）。 */
export type DetachedWindowFactoryInput = {
  windowInstanceId: string; hostEpoch: number; bounds: WorkspaceBounds
  security: WorkspaceWindowSecurityInput; title: string; allowedTitles?: readonly string[]
}

/**
 * **PLAT-04**：共享宿主交付给消费方（compose → `.tabs.*` runtime）的页窗 bounds 观察值。
 * 定义已抽到 `detachedWindowBoundsCollector.ts`，这里只 re-export 保持既有导入点不变。
 */
export type { DetachedWindowBoundsEvent } from './detachedWindowBoundsCollector'

/** 工厂契约：返回 handle 之后的异常由宿主 rollback 销毁；若在 `new BrowserWindow()` 之后、返回前抛错，
 *  宿主拿不到句柄无法回收 —— 工厂必须自行销毁后再抛（供 P1-06 遵守）。 */
export type DetachedWindowFactory = (input: DetachedWindowFactoryInput) => DetachedWindowHandle

export type DetachedPanelRequest = {
  operationId: string; workspaceInstanceKey: string; panelInstanceKey: string; panelId: string; title: string
  /** **PLAT-41**：`page-title-updated` 的受控白名单（缺省 `[title]`）。 */
  allowedTitles?: readonly string[]
  sourceHost: { windowInstanceId: string; hostEpoch: number }; lastValidDock: DockMode; supportedModes: readonly PanelContainerMode[]
  /** 注册 preferredSize：首次分离与无有效 bounds 时的唯一尺寸来源。 */
  preferredSize: WorkspaceSize
  savedBounds?: WorkspaceBounds; displayHintId?: string | null
  /**
   * P2-14：`preferredSize` 的尺寸约束（**仅**在没有 `savedBounds` 时生效）。
   * 面板窗不传（P1-04 行为逐字不变）；页面窗传 `WorkspaceDetachedWindowPolicy` 派生的约束。
   */
  fallbackConstraint?: DetachedWindowSizeConstraint
}

export type DetachedHostEvent = {
  type: WorkspaceLifecycleEventType
  operationId: string; panelInstanceKey: string; windowInstanceId: string | null; hostEpoch: number
  source: 'user' | 'restore' | 'window-close' | 'window-failure' | 'system'
  fallbackReason?: WorkspaceFallbackReason; fallbackMode?: DockMode
}

export type DetachedHostOutcome =
  | { status: 'awaiting-ready' | 'committed' | 'already-detached'; operationId: string; windowInstanceId: string; hostEpoch: number }
  | { status: 'rolled-back'; operationId: string; fallbackReason: WorkspaceFallbackReason; fallbackMode: DockMode | undefined }
  | { status: 'rejected'; operationId: string; errorCode: 'limit-reached' | 'invalid-request' | 'main-window-closing' }

export type DetachedAppExitSummary = {
  flushed: boolean; flushOutcome: 'flushed' | 'failed' | 'timeout'; destroyedWindowIds: readonly string[]; ownersRevoked: number
  consumerFailures: number; firstConsumerFailure: unknown // 有界诊断（§8 仅计数）；appExit 消费一次后归零
}

type HostOperation = {
  request: DetachedPanelRequest; windowInstanceId: string; hostEpoch: number; handle: DetachedWindowHandle
  phase: 'awaiting-ready' | 'awaiting-release' | 'committed'; cancelTimer: (() => void) | null
}
type TimerPort = { schedule: (delayMs: number, run: () => void) => () => void }
type OwnershipClaim = { operationId: string; windowInstanceId: string; hostEpoch: number }

export function createPanelDetachedWindowHost(options: {
  entryUrl: string
  /** 本应用静态资源根（file: URL）；file: entry 必须落在其中，否则构造期 fail closed。 */
  appRoot: string
  createWindow: DetachedWindowFactory
  security: WorkspaceWindowSecurityInput
  registry: WorkspaceWindowRegistry
  displays: () => readonly WorkspaceDisplayInfo[]
  timers: TimerPort
  devOrigins?: readonly string[]; onEvent?: (event: DetachedHostEvent) => void
  targetReadyTimeoutMs?: number; releaseTimeoutMs?: number; appExitFlushTimeoutMs?: number
  /**
   * PLAT-04 测试接缝：bounds 采集的合并窗口（毫秒）。缺省＝`WorkspaceWritePolicy.boundsMergeMs`
   * （与落盘 debounce 同一策略 ⇒ 一次拖拽最多落盘一次）。
   */
  boundsMergeMs?: number
}) {
  if (!isAllowedAppWindowEntryUrl(options.entryUrl, { appRoot: options.appRoot, devOrigins: options.devOrigins })) throw new Error(`detached-window-entry-rejected: ${options.entryUrl}`)
  assertSecureWindowSecurity(options.security)
  const targetReadyTimeoutMs = options.targetReadyTimeoutMs ?? WorkspaceTransferPolicy.prepareTargetTimeoutMs
  const releaseTimeoutMs = options.releaseTimeoutMs ?? WorkspaceTransferPolicy.releaseTimeoutMs
  const appExitFlushTimeoutMs = options.appExitFlushTimeoutMs ?? releaseTimeoutMs // 有界 flush 复用平台释放上界
  const operations = new Map<string, HostOperation>()
  const handles = new Map<string, DetachedWindowHandle>()
  const owners = new Map<string, { windowInstanceId: string; hostEpoch: number }>()
  /**
   * P1-06j：**用户回停靠意图标记**（已消费语义）。
   *
   * `handleNativeClose` 会同步 `destroyWindow()`；真实工厂的 `destroy()` 内**同步**派发 `closed`，因此
   * `forgetHostWindow` 会在「用户意图回停靠事务还没开」的时点抢跑，把这条用户关闭当成孤儿外部销毁，
   * 再开第二条失败链事务（真机症状：最终态被改写成链首 `docked-right`、用户关闭被误报 `window-crashed`）。
   * 因此用户在决定回停靠的那一刻就把意图记在这里，销毁后到达的 `windowDestroyed` 只做消费：执行**同一条**
   * 回停靠事务并抑制一切失败语义。窗口身份唯一且每人最多一条，故用有界 FIFO（与补发判据同量级）。
   */
  const redockIntents = new Map<string, DockMode>()
  const maxRedockIntents = 32
  /**
   * P1-06m：**逻辑关闭意图标记**（面板命令 `closePanel` 的收敛，已消费语义）。
   *
   * `closeDetachedWindow` 会同步 `destroyWindow()`；真实工厂的 `destroy()` 内**同步**派发 `closed`，因此
   * `forgetHostWindow` 会在销毁当刻抢跑。若没有这条标记，它会按「已提交 detached 孤儿」处理：回停靠 + 可能补发
   * 一条 `window-crashed` 回退（真机症状：关闭面板被误报成崩溃、布局被改写成回退链首）。
   * 窗口身份唯一且每人最多一条，故用有界 FIFO（与用户回停靠意图同量级）。
   */
  const panelCloseIntents = new Set<string>()
  const maxPanelCloseIntents = 32
  const rememberPanelCloseIntent = (windowInstanceId: string): void => {
    panelCloseIntents.delete(windowInstanceId)
    panelCloseIntents.add(windowInstanceId)
    while (panelCloseIntents.size > maxPanelCloseIntents) {
      const oldest = panelCloseIntents.values().next().value
      if (oldest === undefined) break
      panelCloseIntents.delete(oldest)
    }
  }
  /**
   * N7/P1-06l：**崩溃监测**。`crashSubscriptions` 持有每个在线窗口的退订函数（销毁/退出必须释放，
   * 绝不留挂起监听器）；`rendererGoneWindows` 记录已被证明崩溃的窗口身份 —— 加载期崩溃发生时事务
   * 还没有 operation，结论必须活到 `requestDetach` 的失败判定那一刻（有界 FIFO，最多窗口数远小于上限）。
   */
  const crashSubscriptions = new Map<string, () => void>()
  const rendererGoneWindows = new Set<string>()
  const maxRendererGoneRecords = 32
  // 有界诊断：只保留计数与首条失败（不积累数组），appExit 消费一次即清空
  let consumerFailureCount = 0
  let firstConsumerFailure: unknown = null
  let hasConsumerFailure = false
  let exiting = false

  /**
   * **PLAT-04 受控 bounds 采集**：实现抽在 `detachedWindowBoundsCollector.ts`（本宿主只做接线）。
   * 宿主负责三件与本模块强相关的事：建窗后**登记身份**、**订阅**原生广播、销毁前 `release`（先交付 pending）；
   * 合并窗口、去重、校验、交付与 barrier 语义全部由采集器承担（本文件不再承载这些细节）。
   */
  const boundsCollector = createDetachedWindowBoundsCollector({
    timers: { schedule: (delayMs, run) => schedule(delayMs, run) },
    ...(options.boundsMergeMs === undefined ? {} : { mergeMs: options.boundsMergeMs }),
    isSuspended: () => exiting,
    onConsumerFailure: (error) => {
      consumerFailureCount += 1
      if (!hasConsumerFailure) { hasConsumerFailure = true; firstConsumerFailure = error }
    }
  })

  /** 消费者异常绝不允许破坏事务（窗口/登记必须照常清理），只记录并在 appExit 上原样抛出。 */
  const emit = (type: WorkspaceLifecycleEventType, request: DetachedPanelRequest, windowInstanceId: string | null, hostEpoch: number, source: DetachedHostEvent['source'], extra: { fallbackReason?: WorkspaceFallbackReason; fallbackMode?: DockMode } = {}): void => {
    try { options.onEvent?.({ type, operationId: request.operationId, panelInstanceKey: request.panelInstanceKey, windowInstanceId, hostEpoch, source, ...extra }) } catch (error) { consumerFailureCount += 1; if (!hasConsumerFailure) { hasConsumerFailure = true; firstConsumerFailure = error } }
  }

  const destroyWindow = (windowInstanceId: string | null): void => {
    if (windowInstanceId === null) return
    releaseCrashSubscription(windowInstanceId)
    // PLAT-04：窗口销毁前先交付最后一个 pending bounds，再退订/清身份（零悬挂监听器、零丢失尺寸）
    boundsCollector.release(windowInstanceId)
    const handle = handles.get(windowInstanceId)
    if (handle && !handle.isDestroyed()) handle.destroy()
    handles.delete(windowInstanceId)
    options.registry.markDestroyed({ windowInstanceId })
  }

  /** 退订失败绝不能阻断窗口回收与登记清理（崩溃监测是增强，不是回收的前置条件）。 */
  const releaseCrashSubscription = (windowInstanceId: string): void => {
    const unsubscribe = crashSubscriptions.get(windowInstanceId)
    if (unsubscribe === undefined) return
    crashSubscriptions.delete(windowInstanceId)
    try { unsubscribe() } catch { /* 退订异常只影响该次释放 */ }
  }

  const rememberRendererGone = (windowInstanceId: string): void => {
    rendererGoneWindows.delete(windowInstanceId)
    rendererGoneWindows.add(windowInstanceId)
    while (rendererGoneWindows.size > maxRendererGoneRecords) {
      const oldest = rendererGoneWindows.values().next().value
      if (oldest === undefined) break
      rendererGoneWindows.delete(oldest)
    }
  }

  /** 回滚：本模块从未改写 owner，因此源 owner 天然保留；目标窗口必须销毁。 */
  const rollback = (operation: HostOperation | null, request: DetachedPanelRequest, windowInstanceId: string | null, hostEpoch: number, reason: WorkspaceFallbackReason): DetachedHostOutcome => {
    operation?.cancelTimer?.()
    if (operation) operations.delete(request.operationId)
    destroyWindow(windowInstanceId)
    owners.delete(request.panelInstanceKey)
    const fallbackMode = resolveFailureFallbackMode(request.supportedModes)
    emit('fallback', request, windowInstanceId, hostEpoch, 'window-failure', { fallbackReason: reason, fallbackMode })
    return { status: 'rolled-back', operationId: request.operationId, fallbackReason: reason, fallbackMode }
  }

  /**
   * N6/P1-06g 失败原因判定（同步）：句柄能证明渲染器进程已崩溃（`isCrashed()`，真机 `Page.crash`）或崩溃
   * 订阅已经证明过（`rendererGoneWindows`）时如实报 `window-crashed`；判定能力缺失或抛错时仍报
   * `window-load-failed`（加载失败），绝不猜测、绝不放宽词表。用于**截止时间**路径（崩溃信号早已到达）。
   */
  const loadFailureReason = (handle: DetachedWindowHandle, windowInstanceId: string): WorkspaceFallbackReason => {
    if (rendererGoneWindows.has(windowInstanceId)) return 'window-crashed'
    try { return handle.isCrashed?.() === true ? 'window-crashed' : 'window-load-failed' } catch { return 'window-load-failed' }
  }

  /**
   * 只让出一轮事件循环（真实时序，非注入的截止时间端口）：`loadURL` 拒绝与 `render-process-gone`
   * 是两条独立的原生任务，真机 P1-07R（7D/7E/7F 3/3）正是在这条缝里被误判成 `window-load-failed`。
   * 环境不支持时立刻返回：宁可退回同步判定（fail-closed），也绝不因此挂住回滚。
   */
  const yieldEventLoopTurn = (): Promise<void> => new Promise((resolve) => {
    try { setTimeout(resolve, 0) } catch { resolve() }
  })

  /**
   * N7/P1-06l（A-P05a）：加载失败词表的**先确认崩溃态**版本。先同步问一次（信号已到的最快路径），
   * 未证实崩溃时让出一轮事件循环再问一次 —— 仍在同一 tick 紧随其后到达的崩溃信号就能被如实识别。
   * 判定能力缺失/抛错时两次判定都返回 `window-load-failed`（fail-closed，绝不放宽词表）。
   */
  const confirmLoadFailureReason = async (handle: DetachedWindowHandle, windowInstanceId: string): Promise<WorkspaceFallbackReason> => {
    const immediate = loadFailureReason(handle, windowInstanceId)
    if (immediate === 'window-crashed') return immediate
    await yieldEventLoopTurn()
    return loadFailureReason(handle, windowInstanceId)
  }

  /**
   * N7/P1-06l（A-P05b）崩溃收敛：**准备期与已提交期同一入口**，由窗口身份定位（绝不采信订阅方声明）。
   * 1) 未提交（有 operation）＝ 与截止时间同一条回滚：销毁窗口 + 释放登记 + 如实报 `window-crashed`；
   * 2) 已提交（`phase:'committed'`）＝ **只回收窗口**：真实 `destroy()` 内同步派发 `closed`，app 侧
   *    `forgetHostWindow` 会按**错误回退链**回停靠 store 并投递**恰一条** `window-crashed`（定向存活主窗）。
   *    宿主在这里自己 emit 会与那条补发判据抢跑（同步 `closed` 先到），产生第二条 fallback；
   * 3) 加载中（还没有 operation）＝ 只记录崩溃结论，由 `requestDetach` 的失败判定如实报词表 —— 此时销毁
   *    窗口会让 `isCrashed()` 变成 false（已销毁一律 false），词表反而丢失；
   * 4) 已退出/身份非 current/已收敛：一律不动（零孤儿与退出语义不受影响）。
   */
  const onRendererGone = (windowInstanceId: string): void => {
    if (exiting) return
    const operation = [...operations.values()].find((entry) => entry.windowInstanceId === windowInstanceId)
    if (operation !== undefined && operation.phase !== 'committed') {
      void rollback(operation, operation.request, windowInstanceId, operation.hostEpoch, 'window-crashed')
      return
    }
    const record = options.registry.describeWindow(windowInstanceId)
    if (!record) return
    if (options.registry.identityStatus({ windowInstanceId, hostEpoch: record.hostEpoch }) !== 'current') return
    if (operation !== undefined) destroyWindow(windowInstanceId)
  }

  /** 订阅崩溃（幂等：同一窗口只收敛一次）；句柄不提供订阅时静默降级为既有 close/closed 路径。 */
  const subscribeRendererGone = (windowInstanceId: string, handle: DetachedWindowHandle): void => {
    if (typeof handle.onRendererGone !== 'function') return
    let notified = false
    let unsubscribe: (() => void) | null = null
    try {
      unsubscribe = handle.onRendererGone(() => {
        if (notified) return
        notified = true
        rememberRendererGone(windowInstanceId)
        onRendererGone(windowInstanceId)
      })
    } catch { return }
    if (typeof unsubscribe === 'function') crashSubscriptions.set(windowInstanceId, unsubscribe)
  }

  /** 迟到/未登记窗口只给判定：'unregistered' 才回收；'stale'/'not-owner' 都不触碰在线窗口。 */
  const reclaimOrReject = (claim: OwnershipClaim): { accepted: false; reason: 'orphaned' | 'not-owner' | 'epoch-mismatch' } => {
    const status = options.registry.identityStatus({ windowInstanceId: claim.windowInstanceId, hostEpoch: claim.hostEpoch })
    if (status === 'unregistered') { destroyWindow(claim.windowInstanceId); return { accepted: false, reason: 'orphaned' } }
    return { accepted: false, reason: status === 'stale' ? 'epoch-mismatch' : 'not-owner' }
  }

  /** 迟到/重复 ACK 一律 accepted=false 且不再发任何事件。 */
  const commit = (claim: OwnershipClaim, source: DetachedHostEvent['source']) => {
    const operation = operations.get(claim.operationId)
    if (!operation || operation.windowInstanceId !== claim.windowInstanceId) return reclaimOrReject(claim)
    if (operation.hostEpoch !== claim.hostEpoch) return { accepted: false as const, reason: 'epoch-mismatch' as const }
    if (operation.phase !== 'awaiting-release') return { accepted: false as const, reason: operation.phase === 'committed' ? 'already-committed' as const : 'invalid-phase' as const }
    operation.cancelTimer?.()
    operation.cancelTimer = null
    operation.phase = 'committed'
    owners.set(operation.request.panelInstanceKey, { windowInstanceId: operation.windowInstanceId, hostEpoch: operation.hostEpoch })
    emit('host-detach', operation.request, operation.windowInstanceId, operation.hostEpoch, source)
    emit('container-changed', operation.request, operation.windowInstanceId, operation.hostEpoch, source)
    return { accepted: true as const, outcome: { status: 'committed' as const, operationId: claim.operationId, windowInstanceId: claim.windowInstanceId, hostEpoch: claim.hostEpoch } }
  }

  /** 定时器端口可能不可用：返回 null 表示调度失败，调用方必须回滚/降级而不是抛给上层。 */
  const schedule = (delayMs: number, run: () => void): (() => void) | null => {
    try { return options.timers.schedule(delayMs, run) } catch { return null }
  }

  /** 与截止时间赛跑：调度不可用 ⇒ 立刻按超时处理。用于「必须从起点生效」的 prepare 与 app-exit flush。 */
  const raceDeadline = async <T,>(work: Promise<T>, delayMs: number): Promise<T | 'timeout'> => {
    let markTimeout: () => void = () => undefined
    const timeout = new Promise<'timeout'>((resolve) => { markTimeout = () => resolve('timeout') })
    const cancel = schedule(delayMs, () => markTimeout())
    if (cancel === null) markTimeout()
    const result = await Promise.race([work, timeout])
    cancel?.()
    return result
  }

  return Object.freeze({
    async requestDetach(input: DetachedPanelRequest): Promise<DetachedHostOutcome> {
      if (exiting) return { status: 'rejected', operationId: input.operationId, errorCode: 'main-window-closing' }
      if (operations.has(input.operationId)) return { status: 'rejected', operationId: input.operationId, errorCode: 'invalid-request' }
      const pending = [...operations.values()].find((entry) => entry.request.panelInstanceKey === input.panelInstanceKey && entry.phase !== 'committed')
      if (pending) return { status: 'awaiting-ready', operationId: pending.request.operationId, windowInstanceId: pending.windowInstanceId, hostEpoch: pending.hostEpoch }
      const owned = owners.get(input.panelInstanceKey)
      if (owned) {
        const existing = handles.get(owned.windowInstanceId)
        if (existing && !existing.isDestroyed()) existing.focus()
        return { status: 'already-detached', operationId: input.operationId, windowInstanceId: owned.windowInstanceId, hostEpoch: owned.hostEpoch }
      }
      if (options.registry.assertOwner(input.sourceHost).status === 'rejected') {
        return { status: 'rejected', operationId: input.operationId, errorCode: 'invalid-request' }
      }
      // 语义：container-change-requested = 「收到一次分离请求」；随后的 bounds/预算校验失败会以 fallback/rejected 收尾。
      emit('container-change-requested', input, null, input.sourceHost.hostEpoch, 'user')

      const bounds = normalizeDetachedBounds({
        bounds: input.savedBounds, displays: options.displays(), displayHintId: input.displayHintId,
        fallbackSize: input.preferredSize,
        ...(input.fallbackConstraint === undefined ? {} : { fallbackConstraint: input.fallbackConstraint })
      })
      if (bounds.status === 'failed') return rollback(null, input, null, input.sourceHost.hostEpoch, bounds.reason)

      const hostEpoch = input.sourceHost.hostEpoch + 1
      const reserved = options.registry.reserveDetachedWindow({ hostEpoch, panelInstanceKey: input.panelInstanceKey, workspaceInstanceKey: input.workspaceInstanceKey })
      if (reserved.status === 'rejected') return { status: 'rejected', operationId: input.operationId, errorCode: reserved.errorCode }
      const windowInstanceId = reserved.record.windowInstanceId
      let handle: DetachedWindowHandle
      try {
        handle = options.createWindow({
          windowInstanceId, hostEpoch, bounds: bounds.bounds, security: options.security, title: input.title,
          ...(input.allowedTitles === undefined ? {} : { allowedTitles: input.allowedTitles })
        })
        handles.set(windowInstanceId, handle) // 工厂一返回就接管：之后任何异常都必须销毁该窗口
        // PLAT-04：身份在**预分配成功之后**登记；bounds 只认这个身份（消费方据此 fail closed）
        boundsCollector.rememberIdentity({ windowInstanceId, hostEpoch })
        // P2-14/PLAT-04：建窗即订阅 bounds 广播（订阅失败只降级为「不采集」，绝不阻断建窗）
        boundsCollector.subscribe({ windowInstanceId, handle })
        // N7/P1-06l：**建窗即订阅**崩溃，准备期与已提交期都主动感知（订阅失败只降级，绝不阻断建窗）
        subscribeRendererGone(windowInstanceId, handle)
        options.security.applyWindowOpenHandler(handle)
        if (options.registry.attachWebContents({ windowInstanceId, webContentsId: handle.webContentsId }).status === 'rejected') {
          throw new Error('detached-window-attach-rejected')
        }
      } catch {
        options.registry.releaseReservation(windowInstanceId)
        return rollback(null, input, windowInstanceId, hostEpoch, 'window-create-failed')
      }
      // prepare 截止时间必须从建窗起生效：load 悬挂（永不 settle）也必须超时回滚，绝不让 requestDetach 悬挂。
      // N6/P1-06l：加载期渲染器崩溃（真机 Page.crash）报 `window-crashed`，只有确属加载失败才报 `window-load-failed`；
      // 崩溃信号常比 `loadURL` 拒绝晚一步到达，故这里**先确认崩溃态再定词表**（见 confirmLoadFailureReason）。
      const loaded = await raceDeadline(handle.loadURL(options.entryUrl).then(() => 'loaded' as const, () => 'failed' as const), targetReadyTimeoutMs)
      if (loaded !== 'loaded') return rollback(null, input, windowInstanceId, hostEpoch, await confirmLoadFailureReason(handle, windowInstanceId))
      // 加载期间崩溃信号已到达（只记录未回收）：此时窗口可能已死，绝不给它建 operation
      if (rendererGoneWindows.has(windowInstanceId)) return rollback(null, input, windowInstanceId, hostEpoch, 'window-crashed')
      // 窗口在加载期间被别的路径回收（退出/外部销毁）：按当时的判定能力如实定词表，绝不猜崩溃
      if (handle.isDestroyed() || !handles.has(windowInstanceId)) {
        return rollback(null, input, windowInstanceId, hostEpoch, loadFailureReason(handle, windowInstanceId))
      }

      emit('container-changing', input, windowInstanceId, hostEpoch, 'user')
      const operation: HostOperation = { request: input, windowInstanceId, hostEpoch, handle, phase: 'awaiting-ready', cancelTimer: null }
      operations.set(input.operationId, operation)
      // 准备期截止时间同样先问一次崩溃态：渲染器崩溃后 target-ready 永不到达，绝不能把它报成加载失败
      const cancelTimer = schedule(targetReadyTimeoutMs, () => rollback(operation, input, windowInstanceId, hostEpoch, loadFailureReason(handle, windowInstanceId)))
      // 调度不可用：回滚销毁窗口并释放 registry，而不是把异常抛给调用方
      if (cancelTimer === null) return rollback(operation, input, windowInstanceId, hostEpoch, 'window-load-failed')
      operation.cancelTimer = cancelTimer
      return { status: 'awaiting-ready', operationId: input.operationId, windowInstanceId, hostEpoch }
    },

    confirmTargetReady(claim: OwnershipClaim) {
      const operation = operations.get(claim.operationId)
      if (!operation || operation.windowInstanceId !== claim.windowInstanceId) return reclaimOrReject(claim)
      if (operation.hostEpoch !== claim.hostEpoch) return { accepted: false as const, reason: 'epoch-mismatch' as const }
      if (operation.phase !== 'awaiting-ready') return { accepted: false as const, reason: 'invalid-phase' as const }
      operation.cancelTimer?.()
      operation.phase = 'awaiting-release'
      // 技术设计没有单独的 timeout 原因：目标准备超时 = window-load-failed；源释放超时 = content-error。
      const releaseTimer = schedule(releaseTimeoutMs, () => rollback(operation, operation.request, operation.windowInstanceId, operation.hostEpoch, 'content-error'))
      if (releaseTimer === null) { rollback(operation, operation.request, operation.windowInstanceId, operation.hostEpoch, 'content-error'); return { accepted: false as const, reason: 'timer-unavailable' as const } }
      operation.cancelTimer = releaseTimer
      return { accepted: true as const }
    },

    confirmSourceReleased(claim: OwnershipClaim) {
      return commit(claim, 'user')
    },

    confirmSourceInvalid(claim: OwnershipClaim) {
      return commit(claim, 'window-failure')
    },

    /**
     * P1-06h：新增**受控 `reason`**（编排侧按语义判定「加载失败/内容错误/崩溃/失联」后原样交给宿主）。
     * 只有调用方没给原因时才退回 `kind` 推导 —— 否则准备期超时/源拒绝这类非崩溃原因会被伪造成
     * `window-crashed`，对真机诊断是错误信息。
     */
    reportWindowFailure(input: { windowInstanceId: string; hostEpoch: number; kind: 'crash' | 'unresponsive'; reason?: WorkspaceFallbackReason }): DetachedHostOutcome {
      const reason: WorkspaceFallbackReason = input.reason ?? (input.kind === 'crash' ? 'window-crashed' : 'window-unresponsive')
      const operation = [...operations.values()].find((entry) => entry.windowInstanceId === input.windowInstanceId)
      if (!operation) {
        // prepare 期（窗口已登记、operation 未建立）崩溃：current 身份可安全回收，判据与 handleNativeClose 一致
        if (options.registry.identityStatus({ windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch }) !== 'current') return { status: 'rejected', operationId: '', errorCode: 'invalid-request' }
        destroyWindow(input.windowInstanceId)
        return { status: 'rolled-back', operationId: '', fallbackReason: reason, fallbackMode: undefined }
      }
      // 陈旧 epoch：fail closed，绝不销毁可能仍在线的窗口
      if (operation.hostEpoch !== input.hostEpoch) return { status: 'rejected', operationId: operation.request.operationId, errorCode: 'invalid-request' }
      return rollback(operation, operation.request, input.windowInstanceId, operation.hostEpoch, reason)
    },

    /** 原生 X = 回停靠（先 lastValidDock，再安全回退链），绝不是逻辑关闭。 */
    handleNativeClose(input: { windowInstanceId: string; hostEpoch: number; lastValidDock: DockMode; supportedModes: readonly PanelContainerMode[] }) {
      const status = options.registry.identityStatus({ windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch })
      if (status === 'unregistered') { destroyWindow(input.windowInstanceId); return { status: 'ignored' as const, reason: 'unregistered' as const } }
      // 陈旧 epoch：fail closed，不触碰窗口、不改布局
      if (status === 'stale') return { status: 'ignored' as const, reason: 'epoch-mismatch' as const }
      const operation = [...operations.values()].find((entry) => entry.windowInstanceId === input.windowInstanceId)
      const mode = resolveUserDockMode({ lastValidDock: input.lastValidDock, supportedModes: input.supportedModes })
      // P1-06j：必须在 `destroy()` **之前**记下用户意图 —— 真实 `destroy()` 内同步派发 `closed`，
      // 随后的 `forgetHostWindow` 已可能抢跑；标记缺失就会把它当成外部销毁再开一条失败链事务。
      if (mode !== undefined) {
        redockIntents.delete(input.windowInstanceId)
        redockIntents.set(input.windowInstanceId, mode)
        while (redockIntents.size > maxRedockIntents) {
          const oldest = redockIntents.keys().next().value
          if (oldest === undefined) break
          redockIntents.delete(oldest)
        }
      }
      operation?.cancelTimer?.()
      if (operation) operations.delete(operation.request.operationId)
      destroyWindow(input.windowInstanceId)
      if (operation) owners.delete(operation.request.panelInstanceKey)
      if (!operation || !mode) return { status: 'ignored' as const, reason: 'unsupported' as const }
      emit('container-change-requested', operation.request, input.windowInstanceId, operation.hostEpoch, 'window-close', { fallbackMode: mode })
      return { status: 'redocked' as const, mode }
    },

    async appExit(input: { flush: () => void | Promise<void> }): Promise<DetachedAppExitSummary> {
      exiting = true
      // PLAT-04：合并窗口内的 pending bounds 必须在 flush **之前**交付（绝不丢在 shutdown barrier 之后）；
      // 此刻窗口仍在、值仍有效，交付失败也只计入既有诊断，绝不阻断清理。
      boundsCollector.flush()
      // 有界 flush（复用平台释放上界）；调度不可用 ⇒ 立刻按超时处理，绝不阻断清理
      const flushOutcome = await raceDeadline(Promise.resolve().then(input.flush).then(() => 'flushed' as const, () => 'failed' as const), appExitFlushTimeoutMs)
      // 清理优先：emit 自身不会抛，所以先通知消费者也不会阻断销毁与登记清理
      for (const operation of operations.values()) {
        operation.cancelTimer?.()
        emit('host-detach', operation.request, operation.windowInstanceId, operation.hostEpoch, 'system')
      }
      const destroyedWindowIds: string[] = []
      for (const windowInstanceId of [...handles.keys()]) {
        destroyWindow(windowInstanceId)
        destroyedWindowIds.push(windowInstanceId)
      }
      // N7/P1-06l：退出后崩溃监测必须彻底静默（订阅全释放 + 迟到的崩溃结论不再被消费）
      for (const windowInstanceId of [...crashSubscriptions.keys()]) releaseCrashSubscription(windowInstanceId)
      rendererGoneWindows.clear()
      const ownersRevoked = owners.size
      owners.clear()
      operations.clear()
      const summary: DetachedAppExitSummary = { flushed: flushOutcome === 'flushed', flushOutcome, destroyedWindowIds, ownersRevoked, consumerFailures: consumerFailureCount, firstConsumerFailure }
      // 语义：清理优先、随后抛出；诊断消费一次即清空（第二次 appExit 不会重复抛已过期的失败）
      const failure = hasConsumerFailure ? firstConsumerFailure : null
      consumerFailureCount = 0; firstConsumerFailure = null; hasConsumerFailure = false
      // 把清理摘要挂到被重新抛出的失败上（message 保持原样，便于诊断）
      if (failure !== null && typeof failure === 'object') Object.assign(failure, { appExitSummary: summary })
      if (failure !== null) throw failure
      return summary
    },

    /**
     * P1-06m：**面板命令的逻辑关闭收敛**（`closePanel` 后独立窗必须消失）。
     *
     * 这不是用户回停靠、也不是崩溃/外部销毁：只销毁窗口 + 撤销 owner，并记下「逻辑关闭意图」，使随后由真实
     * `destroy()` **同步**派发的 `closed` → app 侧 `forgetHostWindow` 只做回收（释放补发判据、markDestroyed），
     * **绝不 redock、绝不补发 fallback、绝不再开一条失败链事务**（关闭的面板没有归宿可言）。
     * 未提交的在飞窗口同权处理：取消截止时间、清 operation 与 owner 后销毁（零孤儿、零残留定时器）。
     * 身份非 current（未登记/陈旧 epoch）时 fail closed：不触碰不属于本次身份结论的窗口。
     */
    closeDetachedWindow(input: { windowInstanceId: string; hostEpoch: number }): { status: 'closed' | 'ignored'; reason?: 'unregistered' | 'epoch-mismatch' } {
      const status = options.registry.identityStatus({ windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch })
      if (status === 'unregistered') { destroyWindow(input.windowInstanceId); return { status: 'ignored' as const, reason: 'unregistered' as const } }
      if (status === 'stale') return { status: 'ignored' as const, reason: 'epoch-mismatch' as const }
      // 意图必须在 destroy() 之前记下：真实工厂在 destroy() 内同步派发 closed，消费侧随后就到
      rememberPanelCloseIntent(input.windowInstanceId)
      const operation = [...operations.values()].find((entry) => entry.windowInstanceId === input.windowInstanceId)
      operation?.cancelTimer?.()
      if (operation) {
        operations.delete(operation.request.operationId)
        owners.delete(operation.request.panelInstanceKey)
      } else {
        for (const [panelInstanceKey, owned] of [...owners]) {
          if (owned.windowInstanceId === input.windowInstanceId) owners.delete(panelInstanceKey)
        }
      }
      destroyWindow(input.windowInstanceId)
      return { status: 'closed' as const }
    },

    /** 诊断用只读视图：仍有未完成事务的 operationId 与已提交 owner 的面板键。 */
    pendingOperationIds(): readonly string[] { return [...operations.values()].filter((operation) => operation.phase !== 'committed').map((operation) => operation.request.operationId) },
    committedOwners(): readonly string[] { return [...owners.keys()] },

    /**
     * **PLAT-04**：安装 bounds 观察订阅（返回退订）。调用方＝compose 的单点接线，因此
     * **不需要改 app.ts、不新增 IPC 通道/preload 方法**：宿主身份早已由 registry/compose 持有。
     * 交付事件带 `windowInstanceId + hostEpoch`（注册表身份）与**已去重、已合并**的 bounds。
     */
    subscribeDetachedWindowBounds(listener: (event: DetachedWindowBoundsEvent) => void): () => void {
      return boundsCollector.subscribeConsumer(listener)
    },

    /**
     * **PLAT-04**：立即交付所有合并窗口内的 pending bounds（幂等；没有 pending 时不交付任何事件）。
     * 退出/显式 flush 之前必须调用一次，否则「最后一次 resize」会停在合并窗口里而丢失。
     */
    flushPendingDetachedWindowBounds(): void {
      boundsCollector.flush()
    },

    /**
     * P1-06j 用户意图消费：该窗口是否因**用户原生关闭**而回停靠，返回用户意图模式（`undefined` = 外部销毁）。
     * 编排的 `forgetHostWindow` 据此把「用户关闭」与「窗口崩溃」彻底分开：只执行一条回停靠事务、不发失败回退。
     */
    redockedByUser(windowInstanceId: string): DockMode | undefined { return redockIntents.get(windowInstanceId) },
    /** 消费完毕（窗口身份已收敛）：释放该窗口的用户意图标记（有界内存）。 */
    forgetRedockIntent(windowInstanceId: string): void { redockIntents.delete(windowInstanceId) },
    /** 诊断（只读）：仍持有用户回停靠意图的窗口数。 */
    redockIntentCount(): number { return redockIntents.size },
    /**
     * P1-06m 逻辑关闭意图消费：该窗口是否因**面板命令 `closePanel`** 被收敛（既非用户回停靠、也非崩溃）。
     * 编排的 `forgetHostWindow` 据此只回收（清飞事务 + 释放补发判据 + markDestroyed），绝不 redock/补发 fallback。
     */
    closedByPanelCommand(windowInstanceId: string): boolean { return panelCloseIntents.has(windowInstanceId) },
    /** 消费完毕（窗口身份已收敛）：释放逻辑关闭意图（有界内存）。 */
    forgetPanelCloseIntent(windowInstanceId: string): void { panelCloseIntents.delete(windowInstanceId) },
    /** 诊断（只读）：仍持有逻辑关闭意图的窗口数。 */
    panelCloseIntentCount(): number { return panelCloseIntents.size }
  })
}
