import type {
  WorkspaceCommandResult,
  WorkspaceHost,
  WorkspacePanelRegistration,
  WorkspaceSnapshot
} from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy, WorkspaceTransferPolicy } from '@platform/workspace/policies'
import type { createPanelRegistry } from '@platform/workspace/registry/panelRegistry'
import type { createPanelWorkspaceStore } from '@platform/workspace/runtime/panelWorkspaceStore'
import type { createPanelDetachedWindowHost, DetachedHostEvent } from './panelDetachedWindowHost'
import {
  createPanelWorkspaceTransferAckPort,
  type Awaitable,
  type TransferAckPending
} from './panelWorkspaceTransferAckPort'
import { ownsPanel } from './panelWorkspaceScopeProjection'
import type { TransferPrepareOutcome } from './workspaceTransferPreparePort'
import { resolveFailureFallbackMode, resolveUserDockMode, type DockMode, type WorkspaceFallbackReason } from './workspaceWindowBounds'
import type { WorkspaceWindowRecord, WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。权威：技术设计 §4/§5/§7 与 P1-06d/P1-06e 派发单。
 * detach 编排：requestDetach（P1-04 预留+建窗+只加载空壳 entry）→ 同一身份 `_beginTransfer` → ACK 链
 * （P1-06e 起「宿主端口 + ACK 链 + claim 身份校验」落在 `panelWorkspaceTransferAckPort.ts`）→ 目标取得挂载权。
 * 本模块只保留编排侧职责：**detach 驱动、事务状态机（飞事务表/相位与截止时间）、回停靠
 * `redockCommittedWindow`、外部销毁收敛 `forgetHostWindow`、dispose**。
 * 任一步失败/超时/窗口消失：释放 registry 预留 + 销毁目标窗 + 有界回滚 store 飞事务 + 按回退链回停靠，
 * 绝不留孤儿、绝不留「detached 且没有窗口」；timeout ≠ 成功。
 * 身份：renderer 只拿到 store `operationId`，故本模块维护 store↔宿主 operationId 映射；宿主 claim 一律由
 * registry/store 推导（绝不采信 renderer 声明，source 相位与 target 相位同等 fail closed）。
 * store 只允许「提交或到期」清除飞事务：相位 0 用 `_sourcePrepared(accepted=false)` 立刻清，其余相位到期清。
 * 补发回退事件只发生在「宿主确实没提供过回退事件」时（判据由 ACK 端口维护）：`closed` 迟到绝不重复投递。
 * P2-03（F2 行数纪律）：事务身份贯通的**准入**在 `workspaceTransferPreparePort.ts`，布局落盘生命周期
 * （flush/退出/关闭面板收敛）在 `workspaceLayoutLifecycle.ts`；本模块只保留转移编排本身。
 */

/** 宿主端口 + ACK 链 + claim 身份校验的公开类型（P1-06e 落点：`panelWorkspaceTransferAckPort.ts`）。 */
export type {
  Awaitable, HostClaim, HostClaimRejection, HostCommitOutcome, HostReadyOutcome, WorkspaceDetachedHostPort
} from './panelWorkspaceTransferAckPort'

type DetachedHost = ReturnType<typeof createPanelDetachedWindowHost>

/** handlers 侧的编排驱动入口（P1-06d）：detach 命令与 source-prepared 准入。 */
export type TransferDetachInput = {
  requestId: string; expectedRevision: number
  sourceWindowInstanceId: string; sourceHostEpoch: number; panelInstanceKey: string
}
/**
 * **PLAT-40**：分离面板窗的受控回停靠输入。身份一律来自 registry + 权威快照（renderer 只给实例键）；
 * 目标停靠模式由 Main 按 `lastValidDock` + 受支持模式收敛，绝不采信 renderer 的自选模式。
 */
export type TransferRedockInput = {
  requestId: string; expectedRevision: number
  sourceWindowInstanceId: string; sourceHostEpoch: number; panelInstanceKey: string
}
export type WorkspaceTransferDriver = {
  detach(input: TransferDetachInput): Promise<WorkspaceCommandResult & { panelInstanceKey: string }>
  noteSourcePrepared(input: { operationId: string; source: WorkspaceHost; accepted: boolean }): Promise<{ accepted: boolean }>
  /**
   * 已提交的分离面板窗 → 主窗（回停靠）。复用既有**原生关闭**语义（P2-09/P1-06j）：记用户意图 → 销毁窗口
   * → 由 `forgetHostWindow` 用同一条转移事务把面板交还主窗。返回 `applied` 表示**回停靠请求已受理**；
   * 真正的 `mode` 变更经既有 `container-changed` 事件到达（窗口随后消失，renderer 不需要第二份权威）。
   */
  redock(input: TransferRedockInput): Promise<WorkspaceCommandResult & { panelInstanceKey: string }>
}
export type PanelWorkspaceTransferOrchestratorOptions = {
  host: DetachedHost
  runtimeStore: ReturnType<typeof createPanelWorkspaceStore>
  windowRegistry: WorkspaceWindowRegistry
  panelRegistry: ReturnType<typeof createPanelRegistry>
  /** compose 的同一身份开事务入口（P1-06c）。 */
  beginTransferToReservedHost: (input: {
    requestId: string; expectedRevision: number
    sourceWindowInstanceId: string; targetWindowInstanceId: string; panelInstanceKey: string
  }) => Promise<TransferPrepareOutcome>
  /** 窗口标题解析（按宿主语言）；缺省用注册信息里的 en-US 标题。 */
  resolveTitle?: (registration: WorkspacePanelRegistration) => Awaitable<string>
  /** 宿主事件投递（容器变化/回退）；缺省只记录不投递。 */
  publishHostEvent?: (event: DetachedHostEvent) => boolean
  /** 有界截止时间端口；缺省用 setTimeout。测试可注入手动定时器。 */
  timers?: { schedule: (delayMs: number, run: () => void) => () => void }
}

export type PendingTransferView = { panelInstanceKey: string; storeOperationId: string; hostOperationId: string; phase: string }
/** 飞事务：状态形状由 ACK 端口契约给出，`cancelDeadline` 与表清理归本模块的状态机。 */
type PendingTransfer = TransferAckPending

const defaultSchedule = (delayMs: number, run: () => void): (() => void) => {
  const timer = setTimeout(run, delayMs); return () => clearTimeout(timer)
}

export function createPanelWorkspaceTransferOrchestrator(options: PanelWorkspaceTransferOrchestratorOptions) {
  const { host, runtimeStore, windowRegistry, panelRegistry } = options
  const schedule = options.timers?.schedule ?? defaultSchedule
  const byOperation = new Map<string, PendingTransfer>()
  const byPanel = new Map<string, PendingTransfer>()
  /** 相位 ≥1 的中止只能等 store 到期：这些有界重试定时器必须能被 dispose 取消（不留挂起定时器）。 */
  const expiryRetryTimers = new Set<() => void>()
  let exiting = false
  let disposed = false

  const snapshot = (): WorkspaceSnapshot => runtimeStore.getSnapshot()
  const transferPhaseOf = (operationId: string) =>
    snapshot().panels.find((panel) => panel.transfer?.operationId === operationId)?.transfer?.phase
  const findByOperation = (operationId: string): PendingTransfer | undefined => byOperation.get(operationId)
  const findByTargetWindow = (windowInstanceId: string): PendingTransfer | undefined =>
    [...byOperation.values()].find((pending) => pending.targetWindowInstanceId === windowInstanceId)

  const clearPending = (pending: PendingTransfer): void => {
    pending.cancelDeadline?.()
    pending.cancelDeadline = null
    byOperation.delete(pending.storeOperationId)
    if (byPanel.get(pending.panelInstanceKey) === pending) byPanel.delete(pending.panelInstanceKey)
  }

  const createOperationId = (): string => `detach_${globalThis.crypto.randomUUID()}`

  /** 有界截止时间：端口不可用时立刻按超时处理（绝不让事务悬挂）。 */
  const armDeadline = (pending: PendingTransfer, delayMs: number, reason: WorkspaceFallbackReason): void => {
    pending.cancelDeadline?.()
    pending.cancelDeadline = null
    let cancel: (() => void) | null = null
    try { cancel = schedule(delayMs, () => { void rollbackPending(pending, reason) }) } catch { cancel = null }
    if (typeof cancel !== 'function') { void rollbackPending(pending, reason); return }
    pending.cancelDeadline = cancel
  }

  /** store 侧回滚：相位 0 用 `_sourcePrepared(accepted=false)`；其余（含已到期的相位 0）用 `_expireTransfer`；
   *  未到期则登记一次有界重试（N1：进 expiryRetryTimers，dispose 取消）。 */
  const abortStoreTransfer = async (pending: PendingTransfer): Promise<void> => {
    const current = () => snapshot().panels.find((entry) => entry.transfer?.operationId === pending.storeOperationId)?.transfer
    const transfer = current()
    if (!transfer) return
    if (transfer.phase === 'awaiting-source-prepared') {
      await runtimeStore._sourcePrepared(pending.storeOperationId, pending.source, false)
      if (!current()) return
    }
    const expired = await runtimeStore._expireTransfer(pending.storeOperationId)
    if (expired.accepted || !current()) return
    const delayMs = transfer.phase === 'awaiting-target-ready'
      ? WorkspaceTransferPolicy.prepareTargetTimeoutMs
      : WorkspaceTransferPolicy.releaseTimeoutMs
    let cancel: (() => void) | null = null
    try {
      cancel = schedule(delayMs, () => {
        if (cancel !== null) expiryRetryTimers.delete(cancel)
        void runtimeStore._expireTransfer(pending.storeOperationId)
      })
    } catch { cancel = null }
    // 端口不可用：留给退出/下一次命令清理（不登记反正也取消不了）
    if (typeof cancel === 'function') expiryRetryTimers.add(cancel)
  }

  /**
   * 回滚：store 飞事务收尾 + 宿主销毁目标窗（含取消定时器与释放登记）+ best-effort 释放 registry 预留。
   *
   * P1-06h（reason→kind 收敛）：把**回滚原因**原样交给宿主，而不是把非崩溃原因统一伪造成 `kind:'crash'`
   * （宿主于是 emit `window-crashed`，准备期超时/源拒绝在真机上都被写成「渲染器崩溃」）。
   * 宿主以受控 `reason` 如实发出 `window-load-failed` / `content-error` / `window-crashed` / `window-unresponsive`；
   * `kind` 只是 reason 缺失时的旧词表兜底，不改变既有崩溃/失联语义，也不放松窗口回收（零孤儿不变量不变）。
   */
  const rollbackPending = async (pending: PendingTransfer, reason: WorkspaceFallbackReason): Promise<void> => {
    if (byOperation.get(pending.storeOperationId) !== pending) return
    clearPending(pending)
    await abortStoreTransfer(pending)
    host.reportWindowFailure({
      windowInstanceId: pending.targetWindowInstanceId, hostEpoch: pending.targetHostEpoch,
      kind: reason === 'window-unresponsive' ? 'unresponsive' : 'crash', reason
    })
    // 宿主已销毁窗口并 markDestroyed 时这里返回 false（额度已释放）；attach 之前的预留则直接释放
    windowRegistry.releaseReservation(pending.targetWindowInstanceId)
  }

  /**
   * native-X（已提交）＝ 回停靠事务：把面板从已销毁的独立宿主交还主窗哨兵。store 的 `switchContainer`
   * 明确拒绝 detached → 非 detached，故这里走同一条转移事务。
   *
   * P1-06j：源身份与 `expectedRevision` 一律取自**调用时**快照，绝不沿用调用方更早读到的值 ——
   * `forgetHostWindow` 消费用户回停靠意图前会先中止 store 飞事务（`_sourcePrepared(accepted=false)` 会
   * 冻结 `source` 并把 revision +1），此时「源」已经是中止后回落的实际承载者，用旧值会让 `_beginTransfer`
   * 以 `not-owner` / `stale-revision` 静默失败，最终停在「detached 且无窗口」。
   * 已提交窗口仍要求 `mode:'detached'`；中止回落的窗口由 orphan 分支判定（源 = 当前承载者，通常是主窗）。
   */
  const redockCommittedWindow = async (input: {
    /** 该面板当前必须归属的宿主窗（已提交 detached 时＝独立窗；已回落时＝主窗哨兵）。 */
    windowInstanceId: string; hostEpoch: number; mode: DockMode
    /** 已回落（中止在飞事务）时用于消歧的显式面板键；缺省按窗口身份定位。 */
    panelInstanceKey?: string
  }): Promise<void> => {
    const current = snapshot()
    const panel = current.panels.find((entry) => input.panelInstanceKey === undefined
      // 已提交 detached：面板的 host 就是那个独立窗（hostEpoch 即目标 epoch），mode 必须仍是 detached
      ? entry.windowInstanceId === input.windowInstanceId && entry.hostEpoch === input.hostEpoch && entry.mode === 'detached'
      : entry.panelInstanceKey === input.panelInstanceKey)
    if (!panel) return
    // 快照里 `windowInstanceId` 可为 null（无承载者）；回停靠必须有确定的源身份，故 fail closed
    const sourceWindowInstanceId = panel.windowInstanceId
    if (sourceWindowInstanceId === null) return
    // 目标身份与源身份必须不同：已回落（源＝主窗哨兵）时不能再「回停靠到主窗」
    if (sourceWindowInstanceId === WorkspaceOwnershipPolicy.initialWindowInstanceId
      && panel.hostEpoch === WorkspaceOwnershipPolicy.initialHostEpoch) return
    // 调用时快照：`source` 必须是「这一刻真正承载该面板的宿主」，否则 store 一律拒绝
    const source: WorkspaceHost = { windowInstanceId: sourceWindowInstanceId, hostEpoch: panel.hostEpoch }
    const target: WorkspaceHost = {
      windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId,
      hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch
    }
    const begun = await runtimeStore._beginTransfer({
      requestId: `redock:${panel.panelInstanceKey}:${current.layoutRevision}`, requestScope: input.windowInstanceId,
      expectedRevision: current.layoutRevision, hostEpoch: panel.hostEpoch,
      windowInstanceId: sourceWindowInstanceId,
      panelInstanceKey: panel.panelInstanceKey, targetMode: input.mode, targetHost: target
    })
    if (begun.status !== 'preparing') return
    const operationId = begun.operation.operationId
    await runtimeStore._sourcePrepared(operationId, source, true)
    await runtimeStore._targetReady(operationId, target)
    await runtimeStore._sourceReleased(operationId, source)
    await runtimeStore._commitTransfer(operationId)
  }

  /**
   * P1-06m：交还之后用主窗身份再关一次这个已关闭面板。
   *
   * `_commitTransfer` 在 mode 变为非 detached 时无条件 `setActive`，于是 `activePanels[mode]` 会指向这个**已关闭**
   * 面板；store 的既有语义是「关闭即把区域活动指针交给仍打开的同区域面板（没有就删键）」
   * （`closePanel` → `selectAfterClose`），deferred 到下一次命令会让活动指针长期失真。
   * 这里复用同一份 store 命令语义补齐这一步；面板已不是「关闭 + 非 detached」时不做任何事。
   */
  const recloseConvergedPanel = async (panelInstanceKey: string): Promise<void> => {
    const current = snapshot()
    const panel = current.panels.find((entry) => entry.panelInstanceKey === panelInstanceKey)
    if (panel === undefined || panel.open || panel.mode === 'detached') return
    await runtimeStore.closePanel({
      requestId: `converge-close:${panelInstanceKey}:${current.layoutRevision}`,
      requestScope: WorkspaceOwnershipPolicy.initialWindowInstanceId,
      expectedRevision: current.layoutRevision,
      windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId,
      hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch,
      panelInstanceKey
    })
  }

  /** 宿主端口 + ACK 链（P1-06e 落点）：身份校验与相位推进在端口层，事务表/截止时间仍归本模块状态机。 */
  const ackPort = createPanelWorkspaceTransferAckPort({
    host,
    runtimeStore,
    windowRegistry,
    findByOperation,
    findByTargetWindow,
    transferPhaseOf,
    clearPending,
    armDeadline,
    rollbackPending,
    abortStoreTransfer,
    /** P1-06j：ACK 端口的「已提交窗口回停靠」适配到新的按快照取源/取 revision 的实现。 */
    redockCommittedWindow: (windowInstanceId: string, hostEpoch: number, mode: DockMode) =>
      redockCommittedWindow({ windowInstanceId, hostEpoch, mode }),
    ...(options.publishHostEvent === undefined ? {} : { publishHostEvent: options.publishHostEvent })
  })

  const detach = async (input: TransferDetachInput): Promise<WorkspaceCommandResult & { panelInstanceKey: string }> => {
    const rejected = (errorCode: NonNullable<WorkspaceCommandResult['errorCode']>) =>
      ({ status: 'rejected' as const, snapshot: snapshot(), errorCode, panelInstanceKey: input.panelInstanceKey })
    if (exiting || disposed) return rejected('main-window-closing')
    const panel = snapshot().panels.find((entry) => entry.panelInstanceKey === input.panelInstanceKey)
    if (!panel) return rejected('registration-missing')
    const registration = panelRegistry.get(panel.panelId)
    if (!registration) return rejected('registration-missing')
    if (!registration.supportedModes.includes('detached')) return rejected('unsupported')
    // 重复 detach 合并：同一面板已有飞事务时绝不建第二个窗（P1-04 同面板幂等是第二层保险）
    if (byPanel.has(input.panelInstanceKey) || panel.transfer !== undefined) return rejected('transfer-in-progress')
    /**
     * **PLAT-41**：建窗标题在 Main 侧解析成当前语言，并给出受控白名单（两种语言的注册标题 + 主标题）。
     * 工厂在**建窗当刻**注入它，并用 `page-title-updated` 收口：白名单外（含入口 HTML 的应用名/篡改）一律
     * 强制回主标题；白名单内允许渲染侧语言跟随（不破坏 PLAT-10/28）。
     */
    const resolvedTitle = options.resolveTitle === undefined
      ? registration.title['en-US']
      : await options.resolveTitle(registration)
    const allowedTitles = [...new Set([resolvedTitle, registration.title['zh-CN'], registration.title['en-US']])]
      .filter((entry) => entry.length > 0)
    if (panel.mode === 'detached') {
      // 已分离：走 P1-04 的同面板幂等路径（focus + already-detached），绝不开第二个窗。
      // 宿主侧已无 owner（例如重启恢复）时不在此物化窗口：恢复降级归 P1-05 的 restore 计划。
      const owner = windowRegistry.listDetachedHosts().find((entry) => entry.panelInstanceKey === input.panelInstanceKey)
      if (!owner) return rejected('unsupported')
      const existing = await host.requestDetach({
        operationId: createOperationId(),
        workspaceInstanceKey: panel.workspaceInstanceKey,
        panelInstanceKey: panel.panelInstanceKey,
        panelId: panel.panelId,
        title: resolvedTitle,
        allowedTitles,
        sourceHost: { windowInstanceId: owner.windowInstanceId, hostEpoch: owner.hostEpoch },
        lastValidDock: panel.lastValidDock,
        supportedModes: registration.supportedModes,
        preferredSize: registration.preferredSize,
        displayHintId: null
      })
      return existing.status === 'rejected'
        ? rejected(existing.errorCode)
        : { status: 'applied', snapshot: snapshot(), panelInstanceKey: input.panelInstanceKey }
    }
    const sourceRecord = windowRegistry.describeWindow(input.sourceWindowInstanceId)
    if (!sourceRecord || sourceRecord.hostEpoch !== input.sourceHostEpoch) return rejected('not-owner')
    if (!ownsPanel(sourceRecord, panel)) return rejected('not-owner')
    if (input.expectedRevision !== snapshot().layoutRevision) return rejected('stale-revision')

    // 1) P1-04 准备：预留 + 建窗（只加载受控空壳 entry）；宿主对 load/建窗失败已自行回滚
    const hostOperationId = createOperationId()
    const prepared = await host.requestDetach({
      operationId: hostOperationId,
      workspaceInstanceKey: panel.workspaceInstanceKey,
      panelInstanceKey: panel.panelInstanceKey,
      panelId: panel.panelId,
      title: resolvedTitle,
      allowedTitles,
      sourceHost: { windowInstanceId: sourceRecord.windowInstanceId, hostEpoch: sourceRecord.hostEpoch },
      lastValidDock: panel.lastValidDock,
      supportedModes: registration.supportedModes,
      preferredSize: registration.preferredSize,
      ...(panel.detachedBounds === undefined ? {} : { savedBounds: panel.detachedBounds }),
      displayHintId: null
    })
    if (prepared.status === 'rejected') return rejected(prepared.errorCode)
    if (prepared.status === 'already-detached') return { status: 'applied', snapshot: snapshot(), panelInstanceKey: input.panelInstanceKey }
    // P1-04 的 `requestDetach` 只会返回 awaiting-ready 或上面两种；其余形状按防御性拒绝处理（绝不猜目标身份）
    if (prepared.status !== 'awaiting-ready') return rejected('unsupported')
    const targetWindowInstanceId = prepared.windowInstanceId
    const targetHostEpoch = prepared.hostEpoch

    // 2) 同一身份开事务（store 目标身份 = registry 预留身份）
    const begun = await options.beginTransferToReservedHost({
      requestId: `${input.requestId}:${panel.panelInstanceKey}`,
      expectedRevision: input.expectedRevision,
      sourceWindowInstanceId: sourceRecord.windowInstanceId,
      targetWindowInstanceId,
      panelInstanceKey: panel.panelInstanceKey
    })
    if (begun.status === 'rejected') {
      // store 拒绝：显式释放 registry 预留（attach 前有效），并让宿主按失败回滚销毁窗口 —— 预算绝不被占满
      windowRegistry.releaseReservation(targetWindowInstanceId)
      host.reportWindowFailure({ windowInstanceId: targetWindowInstanceId, hostEpoch: targetHostEpoch, kind: 'crash' })
      return {
        status: 'rejected', snapshot: begun.snapshot, errorCode: begun.errorCode,
        panelInstanceKey: input.panelInstanceKey
      }
    }
    const pending: PendingTransfer = {
      panelInstanceKey: panel.panelInstanceKey,
      storeOperationId: begun.operationId,
      hostOperationId,
      source: begun.source,
      target: begun.target,
      targetWindowInstanceId,
      targetHostEpoch,
      phase: 'prepared',
      cancelDeadline: null
    }
    byOperation.set(pending.storeOperationId, pending)
    byPanel.set(pending.panelInstanceKey, pending)
    armDeadline(pending, WorkspaceTransferPolicy.prepareTargetTimeoutMs, 'window-load-failed')
    return { status: 'applied', snapshot: begun.snapshot, panelInstanceKey: input.panelInstanceKey }
  }

  const driver: WorkspaceTransferDriver = {
    detach,
    /**
     * **PLAT-40**：分离面板窗的回停靠。判据全部来自 registry + 权威快照：
     *  - sender 必须是**它自己**那个已提交的 `detached-panel` 宿主（身份/epoch/面板键逐字一致），否则 `not-owner`；
     *  - 面板必须仍是 `open + detached` 且没有飞事务（`byPanel` 命中即 `transfer-in-progress`）；
     *  - 停靠模式由 `resolveUserDockMode(lastValidDock, supportedModes)` 收敛（与原生 X 逐字同一条语义）。
     * 动作**复用** `host.handleNativeClose`：记用户回停靠意图 → 销毁窗口 → `forgetHostWindow` 用既有转移事务
     * 交还主窗。这里绝不新增第二条回停靠实现，也不在命令返回前伪造 `mode` 已变更（renderer 窗口会消失）。
     */
    async redock(input: TransferRedockInput): Promise<WorkspaceCommandResult & { panelInstanceKey: string }> {
      const rejected = (errorCode: NonNullable<WorkspaceCommandResult['errorCode']>) =>
        ({ status: 'rejected' as const, snapshot: snapshot(), errorCode, panelInstanceKey: input.panelInstanceKey })
      if (exiting || disposed) return rejected('main-window-closing')
      if (input.expectedRevision !== snapshot().layoutRevision) return rejected('stale-revision')
      if (byPanel.has(input.panelInstanceKey)) return rejected('transfer-in-progress')
      const current = snapshot()
      const panel = current.panels.find((entry) => entry.panelInstanceKey === input.panelInstanceKey)
      if (!panel) return rejected('registration-missing')
      // 幂等：已经不在 detached（例如另一条回停靠先到）⇒ 不重复销毁/不重复开事务
      if (panel.mode !== 'detached') return rejected('unsupported')
      const registration = panelRegistry.get(panel.panelId)
      if (!registration) return rejected('registration-missing')
      const record = windowRegistry.describeWindow(input.sourceWindowInstanceId)
      if (!record || record.kind !== 'detached-panel' || record.panelInstanceKey !== input.panelInstanceKey
        || record.hostEpoch !== input.sourceHostEpoch
        || panel.windowInstanceId !== record.windowInstanceId || panel.hostEpoch !== record.hostEpoch) {
        return rejected('not-owner')
      }
      const outcome = host.handleNativeClose({
        windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch,
        lastValidDock: panel.lastValidDock, supportedModes: registration.supportedModes
      })
      // 已提交窗口不在宿主的 `operations` 表里 ⇒ handleNativeClose 返回 ignored，但**已**记下用户意图并销毁；
      // 因此判据以「用户回停靠意图是否真的落下」为准（与 P1-06j 抢跑修正同一口径）。
      const mode = host.redockedByUser(record.windowInstanceId)
        ?? (outcome.status === 'redocked' ? outcome.mode : undefined)
      if (mode === undefined) return rejected('unsupported')
      return { status: 'applied' as const, snapshot: snapshot(), panelInstanceKey: input.panelInstanceKey }
    },
    /** 源 renderer 的 prepared ACK：真实准入（P1-06e 起由 ACK 端口实现）。 */
    noteSourcePrepared: ackPort.noteSourcePrepared
  }

  return Object.freeze({
    hostPort: ackPort.hostPort,
    driver,
    lifecycle: {
      /** app 退出前先冻结分离意图：之后的 detachPanel 一律 main-window-closing。 */
      markExiting: (): void => { exiting = true },
      /**
       * P1-06m：**面板命令 `closePanel` 的逻辑关闭收敛**。事实：`closePanel` 只把 `open` 置 false，`mode` 仍是
       * `detached` —— 独立窗不会因此消失（真机 92-a-p08：窗口继续渲染已关闭面板），且 detached 预算
       * （`maxDetachedHosts`）会被一个已关闭面板持续占用。本方法做三件事，全部 best-effort 且**绝不产生失败语义**
       * （这既不是崩溃、也不是用户回停靠）：
       * 1) 布局交还：按 `lastValidDock`（经受支持模式收敛）走同一条 store 转移链回到主窗 —— 与「其它容器关闭后
       *    保持自己的 mode」一致，同时释放 detached 预算，绝不留「detached 且无窗口」；
       * 2) 收尾 `closePanel`：交还后 `activePanels[mode]` 会短暂指向这个已关闭面板，用主窗身份再关一次（同一份
       *    store 命令语义），让 `selectAfterClose` 把区域活动指针交给仍打开的面板（没有就删键）；
       * 3) 逻辑关闭窗口：宿主记下逻辑关闭意图后销毁窗口并撤销 owner —— 随后同步到达的 `closed` 只做回收，
       *    绝不 redock、绝不补发 fallback。窗口销毁**无条件**执行（即使 1/2 失败），零孤儿不受影响。
       * 收敛结果对仍存活的主窗投递一条 `container-changed`：revision 绝不静默漂移（renderer 据此重取快照）。
       */
      closeClosedPanelWindow: async (input: { windowInstanceId: string; hostEpoch: number }): Promise<void> => {
        // 准备期（未提交）窗口同样要收敛：先摘掉编排飞事务与有界截止时间（面板已被 closePanel 清掉 transfer，
        // 中止只是收尾），再销毁壳窗 —— 绝不留下「无面板的壳窗 + 悬空截止时间」。
        const pending = findByTargetWindow(input.windowInstanceId)
        if (pending !== undefined) {
          clearPending(pending)
          await abortStoreTransfer(pending)
        }
        const converged = snapshot().panels.find((panel) =>
          panel.windowInstanceId === input.windowInstanceId && panel.mode === 'detached')
        try {
          if (converged !== undefined) {
            const registration = panelRegistry.get(converged.panelId)
            const mode = registration === undefined
              ? undefined
              : resolveUserDockMode({ lastValidDock: converged.lastValidDock, supportedModes: registration.supportedModes })
            if (mode !== undefined) {
              await redockCommittedWindow({ windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch, mode })
              await recloseConvergedPanel(converged.panelInstanceKey)
            }
          }
        } catch { /* 收敛失败只影响该次布局交还：窗口回收与零孤儿由下面的逻辑关闭无条件保证 */ }
        host.closeDetachedWindow({ windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch })
        if (converged !== undefined) {
          options.publishHostEvent?.({
            type: 'container-changed', operationId: '', panelInstanceKey: converged.panelInstanceKey,
            windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch, source: 'system'
          })
        }
      },
      /** 窗口被外部销毁（app.ts 接到工厂 `closed` 回调）：1) 回收登记与飞事务（零孤儿、预算不泄漏）；
       *  2) N6：只有确实持有身份（pending 或 registry 记录）才向宿主报告失败，绝不「猜 epoch」；
       *  3) F1：store 里仍是 `mode:'detached'`（已提交但窗口消失）时复用 native-X 的 `redockCommittedWindow`
       *  同一条 store 转移链按安全回退链回停靠，绝不留「detached 且无窗口」；
       *  4) 补发收窄（P1-06e）：只有当**宿主确实没有提供过回退事件**时才补发一次（定向给仍存活的主窗）；
       *  宿主已先行回滚并自己投递过 fallback 时，`closed` 迟到绝不再补发第二条；宿主静默回滚（无事件）仍必须补发。
       *  5) P1-06j 互斥：窗口带**用户回停靠意图**时，本方法只执行那一条用户意图回停靠（模式＝lastValidDock 解），
       *  绝不报告失败、绝不补发 fallback —— 见下方分支注释。
       *  6) P1-06m 互斥：窗口带**逻辑关闭意图**（面板命令 `closePanel` 的收敛）时只回收，绝不 redock、绝不补发。 */
      forgetHostWindow: async (input: { windowInstanceId: string }): Promise<void> => {
        /**
         * P1-06j：宿主 `handleNativeClose` 同步 `destroy()`，真实工厂在 `destroy()` 内同步派发 `closed`，因此
         * 本方法会在「用户意图回停靠事务还没开」的时点抢跑。若照旧按「已提交 detached 孤儿」处理，就会再开
         * 第二条失败链事务（真机症状：最终态被改写成链首 `docked-right`、用户主动关闭被误报 `window-crashed`）。
         * 因此先消费宿主记下的用户意图：只做**同一条**回停靠，模式取用户意图；失败语义一律不出现。
         * `app-exit` 期间布局已冻结（store 会以 `main-window-closing` 拒绝该事务），保持现态。
         */
        const userDockMode = host.redockedByUser(input.windowInstanceId)
        const record = windowRegistry.describeWindow(input.windowInstanceId)
        const pending = findByTargetWindow(input.windowInstanceId)
        if (pending) {
          clearPending(pending)
          await abortStoreTransfer(pending)
        }
        /**
         * P1-06m：**只回收、绝不产生失败语义**的两条路径。
         *
         * 1) 面板命令的逻辑关闭（`closePanel` 收敛销毁窗口）：既不是用户回停靠，也不是崩溃/外部销毁。
         * 2) 退出期窗口消失：退出关窗相位（`before-quit` 置位后 `close` 不再 preventDefault）里 OS/渲染器自关，
         *    或 appExit 之后迟到的 `closed`。此时报告失败会把优雅退出写成 `window-crashed` 并再开回停靠事务
         *    （布局已冻结，必被 `main-window-closing` 拒绝），既无意义又污染退出证据。
         * 两条都只做回收：清飞事务（上面已做）、释放补发判据、markDestroyed。
         */
        const closedByPanelCommand = host.closedByPanelCommand(input.windowInstanceId)
        if (closedByPanelCommand) host.forgetPanelCloseIntent(input.windowInstanceId)
        if (closedByPanelCommand || exiting) {
          ackPort.forgetHostFallback(input.windowInstanceId)
          windowRegistry.markDestroyed({ windowInstanceId: input.windowInstanceId })
          return
        }
        if (userDockMode !== undefined) {
          try {
            // 已提交窗口：此刻就是「detached 且无窗口」的孤儿，直接按用户意图模式回停靠（同一条事务）。
            // 在飞窗口（pending 存在）：此刻 store 事务还在飞，任何回停靠都会被 `transfer-in-progress` 拒绝，
            // 故这里只中止事务；随后的收尾由端口中止后的「回落到原承载者」完成（其模式本来就是 lastValidDock），
            // 相位 ≥1 的中止由 `abortStoreTransfer` 的有界到期重试清掉 store 飞事务。失败语义一律不出现。
            const orphan = snapshot().panels.find((panel) =>
              panel.windowInstanceId === input.windowInstanceId && panel.mode === 'detached')
            if (orphan && pending === undefined && !exiting) {
              await redockCommittedWindow({ windowInstanceId: input.windowInstanceId, hostEpoch: orphan.hostEpoch, mode: userDockMode })
            }
          } finally {
            host.forgetRedockIntent(input.windowInstanceId)
            windowRegistry.markDestroyed({ windowInstanceId: input.windowInstanceId })
          }
          return
        }
        const hostEpoch = pending?.targetHostEpoch ?? record?.hostEpoch
        const hostProvidedFallback = hostEpoch === undefined
          ? ackPort.hostProvidedFallback(input.windowInstanceId)
          : ackPort.reportHostWindowFailure({
            windowInstanceId: input.windowInstanceId, hostEpoch, kind: 'crash'
          }).hostProvidedFallback
        const orphan = snapshot().panels.find((panel) =>
          panel.windowInstanceId === input.windowInstanceId && panel.mode === 'detached')
        if (orphan) {
          const registration = panelRegistry.get(orphan.panelId)
          const mode = registration === undefined ? undefined : resolveFailureFallbackMode(registration.supportedModes)
          if (mode !== undefined && !exiting) {
            await redockCommittedWindow({ windowInstanceId: input.windowInstanceId, hostEpoch: orphan.hostEpoch, mode })
            if (!hostProvidedFallback) {
              options.publishHostEvent?.({
                type: 'fallback', operationId: '', panelInstanceKey: orphan.panelInstanceKey,
                windowInstanceId: input.windowInstanceId, hostEpoch: orphan.hostEpoch,
                source: 'window-failure', fallbackReason: 'window-crashed', fallbackMode: mode
              })
            }
          }
        }
        ackPort.forgetHostFallback(input.windowInstanceId)
        windowRegistry.markDestroyed({ windowInstanceId: input.windowInstanceId })
      }
    },
    pendingCount: (): number => byOperation.size,
    /** 退出/卸载：清编排状态、相位截止时间与有界重试定时器；store 飞事务由 `prepareForAppExit` 负责。 */
    dispose: (): void => {
      disposed = true
      for (const pending of [...byOperation.values()]) clearPending(pending)
      for (const cancel of [...expiryRetryTimers]) cancel()
      expiryRetryTimers.clear()
    },
    /** 诊断（只读）：飞事务的面板键与 store/宿主 operationId 对应关系。 */
    pendingTransfers: (): readonly PendingTransferView[] =>
      [...byOperation.values()].map((pending) => ({
        panelInstanceKey: pending.panelInstanceKey, storeOperationId: pending.storeOperationId,
        hostOperationId: pending.hostOperationId, phase: pending.phase
      }))
  })
}
