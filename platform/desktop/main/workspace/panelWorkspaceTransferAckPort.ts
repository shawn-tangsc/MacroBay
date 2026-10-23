import type { PanelContainerMode, WorkspaceHost } from '@platform/workspace/contracts'
import { WorkspaceTransferPolicy } from '@platform/workspace/policies'
import type { createPanelWorkspaceStore } from '@platform/workspace/runtime/panelWorkspaceStore'
import type { createPanelDetachedWindowHost, DetachedHostEvent } from './panelDetachedWindowHost'
import { toStoreHostIdentity } from './panelWorkspaceScopeProjection'
import type { DockMode, WorkspaceFallbackReason } from './workspaceWindowBounds'
import type { WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。权威：技术设计 §4/§5/§7 与 P1-06e 拆分派发单。
 *
 * 「宿主端口 + ACK 链 + claim 身份校验」的唯一落点（P1-06d 从 `panelWorkspaceTransferOrchestrator.ts` 纯搬移）：
 * 1) `WorkspaceDetachedHostPort`：把 P1-04 宿主的 ACK 端口包一层，ACK 之后继续驱动 P1-05 store 相位；
 * 2) ACK 链准入与驱动：source-prepared（真实准入）/ target-ready / source-released / source-invalid /
 *    window-failure / native-close；任一步失败即回调编排回滚（timeout ≠ 成功，绝不复用陈旧目标）；
 * 3) claim 身份校验：宿主 claim 一律由 registry 记录推导（绝不采信 renderer/目标声明），source 与 target
 *    同级 fail closed；store 哨兵与本模块自持的 host operationId 是两份 id，映射只在本模块与编排之间；
 * 4) 补发判据：宿主**确实投递过回退事件**（`rolled-back` 且带 `fallbackMode`）才记录在案，供编排在 `closed`
 *    迟到时判定「不得再补发一条 fallback」；宿主静默回滚（无 operation、无事件）与 rejected 都不算已提供。
 *
 * 相位推进与截止时间由编排器的状态机持有：本模块只通过注入的回调推进/回滚/清理，不自己持有事务表，
 * 也不 import electron、不组装应用、不读写 profile/userData。
 */

/** 宿主端口：ACK 之后还要驱动 store 相位，因此方法可能异步；同步实现（P1-04 原端口）仍可注入。 */
export type Awaitable<T> = T | Promise<T>
type DetachedHost = ReturnType<typeof createPanelDetachedWindowHost>
export type HostClaim = { operationId: string; windowInstanceId: string; hostEpoch: number }
export type HostClaimRejection = { accepted: false; reason: string }
export type HostReadyOutcome = { accepted: true } | HostClaimRejection
export type HostCommitOutcome = { accepted: true; outcome: unknown } | HostClaimRejection
/**
 * 宿主失败上报：`kind` 是宿主原有词表（渲染器上报的崩溃/失联）；
 * P1-06h 增补**受控 `reason`**（平台回退词表），编排侧按语义判定后原样传给宿主，宿主优先采用它。
 * 未给 `reason` 时维持既有行为（kind ⇒ window-crashed / window-unresponsive），绝不猜测。
 */
export type WindowFailureInput = {
  windowInstanceId: string; hostEpoch: number; kind: 'crash' | 'unresponsive'; reason?: WorkspaceFallbackReason
}
export type NativeCloseInput = {
  windowInstanceId: string; hostEpoch: number
  lastValidDock: DockMode; supportedModes: readonly PanelContainerMode[]
}
export type HostWindowFailureOutcome = ReturnType<DetachedHost['reportWindowFailure']>
export type HostNativeCloseOutcome = ReturnType<DetachedHost['handleNativeClose']>

export type WorkspaceDetachedHostPort = {
  confirmTargetReady: (claim: HostClaim) => Awaitable<HostReadyOutcome>
  confirmSourceReleased: (claim: HostClaim) => Awaitable<HostCommitOutcome>
  confirmSourceInvalid: (claim: HostClaim) => Awaitable<HostCommitOutcome>
  reportWindowFailure: (input: WindowFailureInput) => Awaitable<HostWindowFailureOutcome>
  handleNativeClose: (input: NativeCloseInput) => Awaitable<HostNativeCloseOutcome>
}

/**
 * 飞事务的编排侧状态：ACK 端口读身份、推进 `phase`；`cancelDeadline` 与事务表清理归编排器的状态机。
 * `source`/`target` 是 **store 身份**（经身份桥投影）；`targetWindowInstanceId`/`targetHostEpoch` 是
 * **registry 身份**，宿主 claim 只认这一份。
 */
export type TransferAckPending = {
  panelInstanceKey: string; storeOperationId: string; hostOperationId: string
  source: WorkspaceHost; target: WorkspaceHost
  targetWindowInstanceId: string; targetHostEpoch: number
  phase: 'prepared' | 'releasing'
  cancelDeadline: (() => void) | null
}

export type TransferAckPortDeps = {
  host: DetachedHost
  runtimeStore: ReturnType<typeof createPanelWorkspaceStore>
  windowRegistry: WorkspaceWindowRegistry
  findByOperation: (operationId: string) => TransferAckPending | undefined
  findByTargetWindow: (windowInstanceId: string) => TransferAckPending | undefined
  transferPhaseOf: (operationId: string) => string | undefined
  clearPending: (pending: TransferAckPending) => void
  armDeadline: (pending: TransferAckPending, delayMs: number, reason: WorkspaceFallbackReason) => void
  rollbackPending: (pending: TransferAckPending, reason: WorkspaceFallbackReason) => Promise<void>
  abortStoreTransfer: (pending: TransferAckPending) => Promise<void>
  redockCommittedWindow: (windowInstanceId: string, hostEpoch: number, mode: DockMode) => Promise<void>
  /** 宿主事件投递（容器变化/回退）；缺省只记录不投递。 */
  publishHostEvent?: (event: DetachedHostEvent) => boolean
  /** 「宿主已投递回退事件」记录的有界上限（窗口身份唯一，正常远小于上限）。 */
  maxHostFallbackRecords?: number
}

/** 宿主窗口失败驱动的结论：宿主本次的判定 + 宿主是否确实提供过回退事件（补发判据）。 */
export type HostFailureReport = {
  outcome: HostWindowFailureOutcome
  /** 宿主确实提供过回退事件（本次或此前任一次）：为真时编排绝不再补发第二条 fallback。 */
  hostProvidedFallback: boolean
}

const DEFAULT_MAX_HOST_FALLBACK_RECORDS = 32

export function createPanelWorkspaceTransferAckPort(deps: TransferAckPortDeps) {
  const { host, runtimeStore, windowRegistry } = deps
  const maxFallbackRecords = deps.maxHostFallbackRecords ?? DEFAULT_MAX_HOST_FALLBACK_RECORDS
  /** 宿主确实投递过回退事件的窗口（Set 迭代序＝到达序，超界淘汰最早）。 */
  const hostFallbackWindows = new Set<string>()

  const rememberHostFallback = (windowInstanceId: string): void => {
    hostFallbackWindows.delete(windowInstanceId)
    hostFallbackWindows.add(windowInstanceId)
    while (hostFallbackWindows.size > maxFallbackRecords) {
      const oldest = hostFallbackWindows.values().next().value
      if (oldest === undefined) break
      hostFallbackWindows.delete(oldest)
    }
  }

  const targetClaim = (pending: TransferAckPending): HostClaim => ({
    operationId: pending.hostOperationId,
    windowInstanceId: pending.targetWindowInstanceId,
    hostEpoch: pending.targetHostEpoch
  })

  /** 端口层 source 身份校验（与 target 相位同级 fail closed）：claim 必须是 registry 里那个**源宿主**记录
   *  （epoch 一致）且经身份桥投影后与飞事务 source 逐字相同；store 哨兵（'main'）与目标身份冒名都不算数。 */
  const sourceClaimMatches = (pending: TransferAckPending, claim: HostClaim): boolean => {
    const record = windowRegistry.describeWindow(claim.windowInstanceId)
    if (record === undefined || record.hostEpoch !== claim.hostEpoch) return false
    const projected = toStoreHostIdentity(record)
    return projected.windowInstanceId === pending.source.windowInstanceId
      && projected.hostEpoch === pending.source.hostEpoch
  }

  /** 源释放/失效的收尾：宿主 commit + store released + store commit，两侧都成立才算挂载权转移完成。 */
  const finishRelease = async (pending: TransferAckPending, invalid: boolean): Promise<HostCommitOutcome> => {
    const claim = targetClaim(pending)
    const outcome = (invalid
      ? await host.confirmSourceInvalid(claim)
      : await host.confirmSourceReleased(claim)) as HostCommitOutcome
    if (!outcome.accepted && outcome.reason !== 'already-committed') {
      await deps.rollbackPending(pending, 'content-error')
      return outcome
    }
    const released = await runtimeStore._sourceReleased(pending.storeOperationId, pending.source)
    if (!released.accepted) {
      await deps.rollbackPending(pending, 'content-error')
      return { accepted: false, reason: 'store-rejected' }
    }
    const committed = await runtimeStore._commitTransfer(pending.storeOperationId)
    if (!committed.accepted) {
      await deps.rollbackPending(pending, 'content-error')
      return { accepted: false, reason: 'commit-rejected' }
    }
    deps.clearPending(pending)
    return outcome
  }

  /**
   * 宿主窗口失败驱动（`forgetHostWindow` 与端口共用）：同步调用宿主（宿主在事务内同步投递事件，保持时序），
   * 并把「宿主确实投递了回退事件」记在案——只有 `rolled-back` 且带 `fallbackMode` 才算真正提供过事件。
   */
  const reportHostWindowFailure = (input: WindowFailureInput): HostFailureReport => {
    const outcome = host.reportWindowFailure(input)
    const providedNow = outcome.status === 'rolled-back' && outcome.fallbackMode !== undefined
    if (providedNow) rememberHostFallback(input.windowInstanceId)
    return { outcome, hostProvidedFallback: providedNow || hostFallbackWindows.has(input.windowInstanceId) }
  }

  const hostPort: WorkspaceDetachedHostPort = {
    /** 目标 ready：宿主 confirm + store 相位推进 + 通知源；任一步失败即回滚（timeout ≠ 成功）。 */
    async confirmTargetReady(claim: HostClaim): Promise<HostReadyOutcome> {
      const pending = deps.findByOperation(claim.operationId)
      if (!pending || pending.targetWindowInstanceId !== claim.windowInstanceId || pending.targetHostEpoch !== claim.hostEpoch) {
        return { accepted: false, reason: 'not-owner' }
      }
      if (pending.phase !== 'prepared') return { accepted: false, reason: 'invalid-phase' }
      const phase = deps.transferPhaseOf(pending.storeOperationId)
      if (phase === 'awaiting-source-prepared') {
        // P1-04 端口没有 prepared 信号：Main 代源确认（源 renderer 先发 source-prepared 时相位已推进）
        const sourcePrepared = await runtimeStore._sourcePrepared(pending.storeOperationId, pending.source, true)
        if (!sourcePrepared.accepted) {
          await deps.rollbackPending(pending, 'window-load-failed')
          return { accepted: false, reason: 'invalid-phase' }
        }
      } else if (phase !== 'awaiting-target-ready') {
        // store 侧已经没有这条飞事务（已提交/已过期）或相位不对：一律按回退处理，绝不复用陈旧目标
        await deps.rollbackPending(pending, 'content-error')
        return { accepted: false, reason: 'invalid-phase' }
      }
      const outcome = await host.confirmTargetReady(targetClaim(pending)) as HostReadyOutcome
      if (!outcome.accepted) {
        await deps.rollbackPending(pending, 'window-load-failed')
        return outcome
      }
      const ready = await runtimeStore._targetReady(pending.storeOperationId, pending.target)
      if (!ready.accepted) {
        await deps.rollbackPending(pending, 'window-load-failed')
        return { accepted: false, reason: 'store-rejected' }
      }
      pending.phase = 'releasing'
      deps.armDeadline(pending, WorkspaceTransferPolicy.releaseTimeoutMs, 'content-error')
      // 通知源：目标已就绪，请准备并释放内容（源的 prepared/released ACK 是后续准入输入）
      deps.publishHostEvent?.({
        type: 'container-changing',
        operationId: pending.hostOperationId,
        panelInstanceKey: pending.panelInstanceKey,
        windowInstanceId: pending.targetWindowInstanceId,
        hostEpoch: pending.targetHostEpoch,
        source: 'user'
      })
      return outcome
    },

    /** 源释放：宿主 commit + store commit，两侧都成立才算挂载权转移完成。 */
    async confirmSourceReleased(claim: HostClaim): Promise<HostCommitOutcome> {
      const pending = deps.findByOperation(claim.operationId)
      if (!pending) return { accepted: false, reason: 'not-owner' }
      if (!sourceClaimMatches(pending, claim)) return { accepted: false, reason: 'not-owner' }
      if (pending.phase !== 'releasing') return { accepted: false, reason: 'invalid-phase' }
      return await finishRelease(pending, false)
    },

    /** 源确认失效：与源释放同一条 commit 链（宿主事件来源标记 window-failure）。 */
    async confirmSourceInvalid(claim: HostClaim): Promise<HostCommitOutcome> {
      const pending = deps.findByOperation(claim.operationId)
      if (!pending) return { accepted: false, reason: 'not-owner' }
      if (!sourceClaimMatches(pending, claim)) return { accepted: false, reason: 'not-owner' }
      if (pending.phase !== 'releasing') return { accepted: false, reason: 'invalid-phase' }
      return await finishRelease(pending, true)
    },

    /** 目标窗口崩溃/失联：宿主回滚（销毁窗 + fallback），编排收尾 store 飞事务。 */
    async reportWindowFailure(input: WindowFailureInput): Promise<HostWindowFailureOutcome> {
      const pending = deps.findByTargetWindow(input.windowInstanceId)
      // 只有 claim 与飞事务的目标身份（含 epoch）逐字一致才收尾 store 侧；伪造 claim 交回宿主自行判定
      const matches = pending !== undefined && pending.targetHostEpoch === input.hostEpoch
      const { outcome } = reportHostWindowFailure(input)
      if (pending !== undefined && matches) {
        deps.clearPending(pending)
        await deps.abortStoreTransfer(pending)
      }
      return outcome
    },

    /** 原生 X = 回停靠（不是逻辑关闭）：已提交时补一条回停靠事务把布局交还主窗。 */
    async handleNativeClose(input: NativeCloseInput): Promise<HostNativeCloseOutcome> {
      const pending = deps.findByTargetWindow(input.windowInstanceId)
      const matches = pending !== undefined && pending.targetHostEpoch === input.hostEpoch
      const outcome = host.handleNativeClose(input)
      if (pending !== undefined && matches) {
        // 在飞（未提交）：store 的归属仍是源，中止转移本身就是回停靠
        deps.clearPending(pending)
        await deps.abortStoreTransfer(pending)
        return outcome
      }
      if (outcome.status === 'redocked') await deps.redockCommittedWindow(input.windowInstanceId, input.hostEpoch, outcome.mode)
      return outcome
    }
  }

  /** 源 renderer 的 prepared ACK：真实准入（accepted=false ⇒ 中止事务并销毁目标壳窗）。 */
  const noteSourcePrepared = async (input: {
    operationId: string; source: WorkspaceHost; accepted: boolean
  }): Promise<{ accepted: boolean }> => {
    const pending = deps.findByOperation(input.operationId)
    if (!pending) return { accepted: false }
    if (pending.source.windowInstanceId !== input.source.windowInstanceId
      || pending.source.hostEpoch !== input.source.hostEpoch) {
      return { accepted: false }
    }
    if (deps.transferPhaseOf(pending.storeOperationId) !== 'awaiting-source-prepared') return { accepted: false }
    const result = await runtimeStore._sourcePrepared(pending.storeOperationId, pending.source, input.accepted)
    if (!input.accepted || !result.accepted) {
      await deps.rollbackPending(pending, 'content-error')
      return { accepted: false }
    }
    return { accepted: true }
  }

  return Object.freeze({
    hostPort,
    noteSourcePrepared,
    /** 宿主窗口失败驱动（编排的 `forgetHostWindow` 用）：顺带记录宿主是否确实投递了回退事件。 */
    reportHostWindowFailure,
    /** 该窗口此前是否已由宿主投递过回退事件（只读补发判据）。 */
    hostProvidedFallback: (windowInstanceId: string): boolean => hostFallbackWindows.has(windowInstanceId),
    /** 窗口收敛完成：释放该窗口的补发判据记录（有界内存）。 */
    forgetHostFallback: (windowInstanceId: string): void => { hostFallbackWindows.delete(windowInstanceId) },
    /** 诊断（只读）：已记录的窗口数。 */
    fallbackRecordCount: (): number => hostFallbackWindows.size
  })
}

export type PanelWorkspaceTransferAckPort = ReturnType<typeof createPanelWorkspaceTransferAckPort>
