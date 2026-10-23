import type { PanelContainerMode, WorkspaceBounds, WorkspaceSize } from '@platform/workspace/contracts'
import { WorkspaceTransferPolicy } from '@platform/workspace/policies'
import type { DetachedHostOutcome, DetachedPanelRequest } from './panelDetachedWindowHost'
import type { createPanelDetachedWindowHost } from './panelDetachedWindowHost'
import { detachedWindowSizeConstraint, resolveDetachedWindowRequestedSize, type DockMode } from './workspaceWindowBounds'
import type { WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（P2-03）。权威：技术设计 §4/§5/§5.4 与 A-T03～A-T05、A-T10。
 *
 * 受控**页面窗**（一级菜单页的独立窗）宿主。本模块**不实现任何窗口生命周期**：
 * 窗口创建/加载/超时回滚/迟到回调/崩溃收敛/预算/退出全部复用 P1-04 的
 * `createPanelDetachedWindowHost`（同一实例），registry 也复用同一个 `WorkspaceWindowRegistry`。
 * 本模块只做三件事：
 *  1) **身份翻译**：页面 Tab 的容器身份由 Tab runtime store 分配（`workspaceInstanceKey` 即逻辑实例键），
 *     registry 通过 `reserveDetachedTabWindow` **采纳**该身份并把 `detached-tab` 记录交给共享宿主的
 *     `reserveDetachedWindow`（见 registry 的采纳文档），因此 store 的 `ownsTab`/`managesTab` 归属判定与
 *     新窗身份**逐字一致**（不会出现两套身份分叉）；
 *  2) **语义翻译**：页面没有「停靠模式」概念，用户回停靠（原生 X）= `embedded`，逻辑关闭 = 共享宿主的
 *     `closeDetachedWindow`（销毁 + 撤销 owner + 记逻辑关闭意图，绝不 redock、绝不补发 fallback）；
 *  3) **父子双 detached 的收敛与权限**：`closeDetachedTab` 只收敛**本 Tab 所属工作区**的子面板窗，
 *     外来工作区的窗口一律拒绝且**零触碰**。
 *
 * 明确不做：不复制事务状态机、不自造 windowInstanceId/hostEpoch、不接受 renderer 声明的目标身份、
 * 不放宽「未预分配的 Tab 身份一律 fail closed」（绝不静默新建一个与 store 不一致的容器身份）。
 */

/** 一次页面分离请求。`windowInstanceId`/`hostEpoch` 必须来自 Tab runtime store 的 `detachTab` 结果。 */
export type TabDetachRequest = {
  operationId: string
  workspaceInstanceKey: string
  pageId: string
  menuKey: string
  title: string
  /** **PLAT-41**：`page-title-updated` 的受控白名单（本地化页面名 + pageId）；缺省 `[title]`。 */
  allowedTitles?: readonly string[]
  sourceHost: { windowInstanceId: string; hostEpoch: number }
  /** Tab runtime store 分配的容器身份（registry 采纳它，绝不另发）。 */
  windowInstanceId?: string
  hostEpoch?: number
  savedBounds?: WorkspaceBounds
  displayHintId?: string | null
  preferredSize?: WorkspaceSize
  /**
   * P2-14：源页面区域尺寸（DIP，Main 侧测量的真值，**不是** renderer 自报）。
   * 缺省/畸形 ⇒ 用 `WorkspaceDetachedWindowPolicy.defaultSize` 兜底（绝不退回面板注册的 480×360）。
   */
  sourceAreaSize?: WorkspaceSize
}

export type TabOwnershipClaim = { operationId: string; windowInstanceId: string; hostEpoch: number }
/**
 * P2-07：一次「本模块自己发起的 Tab 分离事务」的只读投影（页面窗据此经 `.tabs.hostLifecycle` 报 target-ready）。
 * 只有 **未提交** 的事务才存在该投影：提交/回滚/迟到后一律 `undefined`，页窗因此绝不 ACK 幽灵事务。
 */
export type TabPendingOperation = { operationId: string }
export type TabCloseOutcome =
  | { status: 'closed'; closedChildWindowIds: readonly string[]; refusedChildWindowIds: readonly string[] }
  | { status: 'ignored'; reason: 'unregistered' | 'epoch-mismatch' | 'not-a-page-window' }
export type TabRehomeOutcome =
  | { status: 'redocked'; mode: DockMode }
  | { status: 'ignored'; reason: 'unregistered' | 'epoch-mismatch' | 'unsupported' }

/** 页面窗只有「回主窗」这一种归宿，因此 supportedModes 只有一个成员（不伪装成停靠轨道）。 */
const TAB_REDOCK_MODES: readonly PanelContainerMode[] = Object.freeze(['embedded'])
const TAB_DETACH_MODES: readonly PanelContainerMode[] = Object.freeze(['embedded', 'detached'])
/**
 * 本模块记住的「窗口身份 → 本次分离事务」条数上界（= registry 的分离窗预算同阶）。
 * 它只是身份映射，不承载相位；已提交/已回滚的条目在查询时被求交淘汰，绝不单调增长。
 */
const MAX_TAB_OPERATIONS = WorkspaceTransferPolicy.maxDetachedHosts + 1

export function createTabDetachedWindowHost(options: {
  /** 共享的 P1-04 宿主实例（与面板窗同一个，绝不新建第二套生命周期）。 */
  host: ReturnType<typeof createPanelDetachedWindowHost>
  registry: WorkspaceWindowRegistry
}) {
  const { host, registry } = options
  /**
   * P2-07：`windowInstanceId → operationId` 的**只读身份映射**。共享宿主持有真实相位/截止时间/提交结论，
   * 本模块**不复制状态机**，只回答「这个窗口属于哪次仍未提交的分离请求」：查询时一律与宿主当时的
   * `pendingOperationIds()` 求交，因此已提交、已回滚、身份已被回收的事务都自然消失。
   */
  const tabOperations = new Map<string, { operationId: string; hostEpoch: number }>()
  const forgetConvergedOperations = (): void => {
    const live = new Set(host.pendingOperationIds())
    for (const [windowInstanceId, entry] of [...tabOperations]) {
      if (!live.has(entry.operationId)) tabOperations.delete(windowInstanceId)
    }
  }
  const rememberTabOperation = (input: { windowInstanceId: string; hostEpoch: number; operationId: string }): void => {
    forgetConvergedOperations()
    tabOperations.set(input.windowInstanceId, { operationId: input.operationId, hostEpoch: input.hostEpoch })
    // 有界：映射只服务诊断/ACK 发现，超界一律丢最旧（其身份随后仍按 registry 判定，绝不放宽准入）
    while (tabOperations.size > MAX_TAB_OPERATIONS) {
      const oldest = tabOperations.keys().next().value
      if (oldest === undefined) break
      tabOperations.delete(oldest)
    }
  }

  /**
   * 预分配身份的准入：必须是「本工作区、未绑定 webContents 的 detached-tab 记录」，且 epoch 必须等于
   * 共享宿主将会派生的容器 epoch（`sourceHost.hostEpoch + 1`）。
   *
   * epoch 这一条是**防静默分叉**的关键：共享宿主的 `requestDetach` 自己派生 `hostEpoch`，registry 的
   * 身份采纳也按该 epoch 匹配。若 store 给出的 epoch 与之不同，采纳不会发生，宿主会转而新建一个
   * **面板 kind** 的窗口 —— 于是 store 说 detached、真实容器却是另一个身份。这里 fail closed，绝不接受。
   */
  const adoptableReservation = (input: TabDetachRequest) => {
    if (typeof input.windowInstanceId !== 'string' || !Number.isSafeInteger(input.hostEpoch)) return null
    const record = registry.describeWindow(input.windowInstanceId)
    if (!record || record.kind !== 'detached-tab') return null
    if (record.webContentsId !== null) return null
    if (record.workspaceInstanceKey !== input.workspaceInstanceKey) return null
    if (record.hostEpoch !== input.hostEpoch) return null
    if (record.hostEpoch !== input.sourceHost.hostEpoch + 1) return null
    return record
  }

  const toPanelRequest = (input: TabDetachRequest): DetachedPanelRequest => Object.freeze({
    operationId: input.operationId,
    // 页面窗的「面板实例键」就是 Tab 的逻辑实例键：共享宿主只把它当成归属键使用
    workspaceInstanceKey: input.workspaceInstanceKey,
    panelInstanceKey: input.workspaceInstanceKey,
    panelId: input.pageId,
    title: input.title,
    ...(input.allowedTitles === undefined ? {} : { allowedTitles: input.allowedTitles }),
    sourceHost: input.sourceHost,
    lastValidDock: 'embedded' as const,
    supportedModes: TAB_DETACH_MODES,
    // P2-14：页面窗的默认尺寸来自**页面窗策略**（源区域 × 1.25 或策略默认值），
    // 绝不再借用面板注册表的 `WorkspaceRegistrationPolicy.preferredSize`（480×360）。
    preferredSize: input.preferredSize
      ?? resolveDetachedWindowRequestedSize(input.sourceAreaSize === undefined ? {} : { sourceAreaSize: input.sourceAreaSize }),
    fallbackConstraint: detachedWindowSizeConstraint(),
    ...(input.savedBounds === undefined ? {} : { savedBounds: input.savedBounds }),
    ...(input.displayHintId === undefined ? {} : { displayHintId: input.displayHintId })
  })

  return Object.freeze({
    /**
     * 分离一个页面 Tab：先由调用方（`.tabs.*` 层）用 store 身份完成 registry 采纳，再走共享宿主的
     * **真实事务**（预留 → 建窗 → 加载 entry → 等 target-ready → 等源释放 → commit）。
     * 没有可采纳的预分配身份时 fail closed：绝不新建一个与 Tab store 不一致的容器身份。
     */
    async requestTabDetach(input: TabDetachRequest): Promise<DetachedHostOutcome> {
      if (adoptableReservation(input) === null) {
        return { status: 'rejected', operationId: input.operationId, errorCode: 'invalid-request' }
      }
      const outcome = await host.requestDetach(toPanelRequest(input))
      // P2-07：只记住「真实进入 awaiting-ready」的事务；其余结论（已分离/被拒/已回滚）没有待 ACK 目标
      if (outcome.status === 'awaiting-ready') {
        rememberTabOperation({
          windowInstanceId: outcome.windowInstanceId, hostEpoch: outcome.hostEpoch, operationId: outcome.operationId
        })
      }
      return outcome
    },

    /**
     * P2-07 只读投影：该页面窗当前**仍未提交**的分离事务（提交/回滚/身份不匹配 ⇒ `undefined`）。
     * 身份（windowInstanceId + hostEpoch）必须与调用方给出的 registry 记录逐字一致 —— 绝不放宽归属判定。
     */
    pendingTabOperation(input: { windowInstanceId: string; hostEpoch: number }): TabPendingOperation | undefined {
      forgetConvergedOperations()
      const entry = tabOperations.get(input.windowInstanceId)
      if (entry === undefined || entry.hostEpoch !== input.hostEpoch) return undefined
      return Object.freeze({ operationId: entry.operationId })
    },

    /** 目标窗报告就绪（与面板同一条准入；陈旧 epoch/重复 ACK 一律 fail closed）。 */
    confirmTargetReady(claim: TabOwnershipClaim) {
      return host.confirmTargetReady(claim)
    },

    /**
     * 源释放确认。页面 Tab 的正文由 Main 权威 store 重建、没有独立内容适配器，因此主窗（布局权威）
     * 即源；调用方只在**已证明 source 是主窗**时才允许调用（`.tabs.*` 层判定），提交路径与面板共用。
     */
    confirmSourceReleased(claim: TabOwnershipClaim) {
      return host.confirmSourceReleased(claim)
    },

    confirmSourceInvalid(claim: TabOwnershipClaim) {
      return host.confirmSourceInvalid(claim)
    },

    reportWindowFailure(input: { windowInstanceId: string; hostEpoch: number; kind: 'crash' | 'unresponsive' }) {
      return host.reportWindowFailure(input)
    },

    /** 用户回停靠（原生 X / 菜单「回停靠」）：先试 `embedded`，失败即按既有语义 `unsupported`。 */
    rehomeTabToMain(input: { windowInstanceId: string; hostEpoch: number }): TabRehomeOutcome {
      const outcome = host.handleNativeClose({
        windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch,
        lastValidDock: 'embedded', supportedModes: TAB_REDOCK_MODES
      })
      return outcome.status === 'redocked' ? { status: 'redocked', mode: outcome.mode } : { status: 'ignored', reason: outcome.reason }
    },

    /**
     * 逻辑关闭一个页面窗（Tab 被 `closeTab` 关闭，不是用户回停靠、也不是崩溃）：
     * 销毁本窗 + 撤销 owner + 记逻辑关闭意图；随后**只**收敛本 Tab 所属工作区的子面板窗。
     * 身份非 current / 不是页面窗记录时 fail closed，绝不触碰不属于本次结论的窗口。
     */
    closeDetachedTab(input: {
      windowInstanceId: string
      hostEpoch: number
      /** 候选子窗（调用方按本 Tab 的工作区从共享 registry 取；越界的一律在这里被拒绝）。 */
      childPanelWindowInstanceIds?: readonly string[]
    }): TabCloseOutcome {
      const status = registry.identityStatus({ windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch })
      if (status === 'unregistered') return { status: 'ignored', reason: 'unregistered' }
      if (status === 'stale') return { status: 'ignored', reason: 'epoch-mismatch' }
      const self = registry.describeWindow(input.windowInstanceId)
      if (!self || self.kind !== 'detached-tab') return { status: 'ignored', reason: 'not-a-page-window' }
      const workspaceInstanceKey = self.workspaceInstanceKey

      const closed: string[] = []
      const refused: string[] = []
      for (const candidate of input.childPanelWindowInstanceIds ?? []) {
        const record = registry.describeWindow(candidate)
        // 权限语义：只有「同一工作区的 detached-panel」才是本 Tab 的子窗；其余（外来工作区/未知/非面板）一律拒绝且不触碰
        if (!record || record.kind !== 'detached-panel' || record.workspaceInstanceKey !== workspaceInstanceKey) {
          refused.push(candidate)
          continue
        }
        const childClose = host.closeDetachedWindow({ windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch })
        if (childClose.status === 'closed') closed.push(record.windowInstanceId)
        else refused.push(candidate)
      }
      host.closeDetachedWindow({ windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch })
      return { status: 'closed', closedChildWindowIds: Object.freeze(closed), refusedChildWindowIds: Object.freeze(refused) }
    },

    /** 诊断/只读：仍在飞的 operationId（共享宿主持有，本模块不复制状态）。 */
    pendingOperationIds(): readonly string[] {
      return host.pendingOperationIds()
    },
    /** 诊断/只读：已提交 owner 的实例键（页面窗下即 workspaceInstanceKey）。 */
    committedOwners(): readonly string[] {
      return host.committedOwners()
    },
    redockedByUser(windowInstanceId: string): DockMode | undefined {
      return host.redockedByUser(windowInstanceId)
    },
    closedByPanelCommand(windowInstanceId: string): boolean {
      return host.closedByPanelCommand(windowInstanceId)
    },
    /** 该身份是否仍是本模块可管理的页面窗（供 `.tabs.*` 层判定页面窗承载者）。 */
    describePageWindow(windowInstanceId: string): { windowInstanceId: string; hostEpoch: number; workspaceInstanceKey: string; webContentsId: number | null } | undefined {
      const record = registry.describeWindow(windowInstanceId)
      // 采纳身份时必然带了归属实例键；缺失即不是可管理的页面窗（fail closed）
      if (!record || record.kind !== 'detached-tab' || record.workspaceInstanceKey === null) return undefined
      return {
        windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch,
        workspaceInstanceKey: record.workspaceInstanceKey, webContentsId: record.webContentsId
      }
    },
    /** 只读：本 Tab 工作区当前已物化的子面板窗（供 `closeTab` 计算收敛候选）。 */
    childPanelWindowsOf(workspaceInstanceKey: string): readonly string[] {
      return Object.freeze(registry.listDetachedHosts()
        .filter((record) => record.workspaceInstanceKey === workspaceInstanceKey)
        .map((record) => record.windowInstanceId))
    },
  })
}

export type TabDetachedWindowHost = ReturnType<typeof createTabDetachedWindowHost>
