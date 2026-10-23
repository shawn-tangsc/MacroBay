import { IpcChannels } from '../../ipc/channels'
import type { IpcMain } from 'electron'
import type { WorkspaceCommandResult } from '@platform/workspace/contracts'
import type { createPanelRegistry } from '@platform/workspace/registry/panelRegistry'
import type { createPanelWorkspaceStore } from '@platform/workspace/runtime/panelWorkspaceStore'
import type { WorkspaceDetachedHostPort, WorkspaceTransferDriver } from './panelWorkspaceTransferOrchestrator'
import {
  LANGUAGE_PATTERN, claimMatchesHost, commandFieldAllowlist, isLifecyclePhase, optionalString,
  plainRecord, requiredMode, requiredRevision, requiredSize, requiredString, safePreference, safeTimeZone
} from './panelWorkspacePayloadGuard'
import { fallbackTimeZone } from '@platform/settings/schema/appSettings'
import {
  emptySnapshot, pendingTransferFor, projectCommandOutcome, scopeHostMounts, scopeSnapshot, toStoreHostIdentity,
  type PersistenceStateReader, type WorkspaceCommandOutcome, type WorkspaceHostContextOutcome,
  type WorkspaceIpcRejection, type WorkspaceIpcRejectionCode, type WorkspaceSnapshotOutcome
} from './panelWorkspaceScopeProjection'
import type { WorkspaceWindowRecord, WorkspaceWindowRegistry } from './workspaceWindowRegistry'
import type { WorkspaceHostSubscriptionPort } from './workspaceHostSubscriptionLedger'
import type { createTabWorkspaceIpcHandlers } from './tabWorkspaceIpcHandlers'

/**
 * Owner: platform/desktop/main/workspace。权威：技术设计 §4/§5 与 P1-06a 审查清单，P1-06c 拆分后本模块
 * 只保留「准入」这一件事：channels、sender 解析（主 frame/已登记/未销毁）、10 方法严格分发、
 * `getHostContext`/`getSnapshot`、`hostLifecycle` 准入。payload 与字段白名单在
 * `panelWorkspacePayloadGuard.ts`，宿主侧投影与身份桥在 `panelWorkspaceScopeProjection.ts`。
 * P1-06d：`detachPanel` 只做「渲染器意图 → 注入的编排驱动」转发（目标窗口身份/bounds/operationId 一律
 * 由 Main 推导）；`source-prepared` 由 `unsupported` 改为真实准入（走编排驱动的 store 相位推进），
 * 未注入编排驱动时两者都保持 fail closed。宿主 ACK 端口允许返回 Promise（ACK 之后还要驱动 store 相位）。
 * 安全链固定顺序：
 * 1) `event.senderFrame` 必须是主 frame（拒绝子 frame / 缺失 frame）；
 * 2) `event.sender` 已登记且未销毁（未登记 webContents 一律拒绝，不猜 owner）；
 * 3) payload 里的 `windowInstanceId`/`hostEpoch` 是「声明」而非授权：与 registry 记录不一致即 `not-owner`；
 * 4) store 身份由 Main 从 registry 记录推导（主窗映射到 `initialWindowInstanceId`，renderer 不能自选）；
 * 5) 命令严格方法白名单 + 逐方法字段白名单（`url`/`path`/`requestScope`/未知字段/访问器属性 ⇒ `invalid-request`）；
 * 6) `expectedRevision` 只透传给 runtime store 判定 stale，IPC 层绝不自造 revision。
 * 语言/主题走白名单模式，bindingKey 永不外泄；本模块不 import electron。
 */

export type WorkspaceIpcSenderEvent = {
  senderFrame: { parent: unknown } | null
  sender: { id: number; isDestroyed: () => boolean }
}
export type WorkspaceHostLifecycleReason =
  | 'invalid-request' | 'not-owner' | 'unknown-operation' | 'unsupported' | 'registration-missing'
export type WorkspaceHostLifecycleOutcome = { accepted: boolean; reason?: WorkspaceHostLifecycleReason | string }

type DetachedHostPort = WorkspaceDetachedHostPort

export type PanelWorkspaceIpcDependencies = {
  panelRegistry: ReturnType<typeof createPanelRegistry>
  pageIds: readonly string[]
  runtimeStore: ReturnType<typeof createPanelWorkspaceStore>
  windowRegistry: WorkspaceWindowRegistry
  /** 只投影语言/主题；本模块再做一次模式白名单，注入端口也无法把路径/密钥带进上下文。 */
  preferences: {
    getLanguage: () => string | Promise<string>
    getTheme: () => string | Promise<string>
    getTimeZone: () => string | Promise<string>
  }
  detachedHost?: DetachedHostPort
  /**
   * P1-06d 编排驱动：只有注入了完整 P1-04 宿主（含 requestDetach）时才有值。
   * 缺省时 `detachPanel` 与 `source-prepared` 保持 fail closed（`unsupported`），
   * 与 P1-06a「没有宿主端口就不假装支持」的语义一致。
   */
  transfers?: WorkspaceTransferDriver
  /**
   * **PLAT-35**：把「该页当前打开的 Tab 实例键」交给 Main 内部桥接（compose 从 Tab store 只读解析）。
   * 它只用于 `openWorkspace` 的**采纳**分支：有 Tab 就复用 Tab 的键，没有才保持既有「自造新键」语义。
   * 缺省 ⇒ 与既有行为逐字相同（绝不因缺端口而拒绝/伪造）；renderer 永远不能传入这个键。
   */
  resolvePageWorkspaceKey?: (pageId: string) => string | null
  /** 真实持久化状态（P1-05 的 panelLayoutStore.persistenceState）；缺省才是 store 的 saved。 */
  readPersistenceState?: PersistenceStateReader
  /** 命令被 store 接受后的持久化调度钩子；在返回快照投影之前触发，因此响应里的 persistenceState 是最新的。 */
  onApplied?: () => void
  /**
   * PLAT-28：面板宿主窗（`kind:'detached-panel'`）的**受控订阅**端口（真机即 compose 的 `attachHostWindow`
   * ⇒ `router.attachHost`）。缺省 ⇒ 不挂载、不记账，绝不假装已订阅。调用纪律（幂等/有界）在本模块内，
   * 端口只负责「按已登记身份挂载」。
   */
  attach?: (record: WorkspaceWindowRecord) => boolean
  /**
   * PLAT-30：**宿主订阅记账的唯一出口**按 kind 收窄后的视图（真机＝
   * `workspaceHostSubscriptionLedger.attachFor('detached-panel')`）。
   *
   * 注入它即把「挂载 / 幂等 / 降级 / 额度归还 / 释放」全部交给共享记账 —— 面板宿主的额度归还不再隐式依赖
   * 页窗模块的回收通知（PLAT-28 的跨模块耦合）；`attach` 端口（上面那条）随之只是共享记账内部用的挂载端口。
   * 缺省（未接线的测试缝）⇒ 本模块退回自有记账：仍然幂等、仍然在 `hostSubscriptionStatus()` 里**可见**，
   * 绝不静默。
   */
  attachSubscription?: WorkspaceHostSubscriptionPort
}

export function createPanelWorkspaceIpcHandlers(dependencies: PanelWorkspaceIpcDependencies) {
  const { panelRegistry, runtimeStore, windowRegistry } = dependencies
  const pageIds = Object.freeze([...dependencies.pageIds])
  const pageIdSet = new Set(pageIds)
  const readPersistenceState: PersistenceStateReader = dependencies.readPersistenceState ?? (() => 'saved' as const)
  const channels = Object.freeze({
    workspaceGetHostContext: IpcChannels.workspaceGetHostContext,
    workspaceGetSnapshot: IpcChannels.workspaceGetSnapshot,
    workspaceCommand: IpcChannels.workspaceCommand,
    workspaceHostLifecycle: IpcChannels.workspaceHostLifecycle,
    workspaceEvent: IpcChannels.workspaceEvent
  })
  const rejection = (errorCode: WorkspaceIpcRejectionCode): WorkspaceIpcRejection => ({ status: 'rejected', errorCode })
  const rejectedCommand = (snapshot: WorkspaceCommandOutcome['snapshot'], errorCode: WorkspaceIpcRejectionCode): WorkspaceCommandOutcome =>
    ({ status: 'rejected', snapshot, errorCode })
  const scoped = (record: WorkspaceWindowRecord) => scopeSnapshot(runtimeStore.getSnapshot(), record, readPersistenceState)
  const storeHostOf = toStoreHostIdentity

  const resolveSender = (event: WorkspaceIpcSenderEvent): { record: WorkspaceWindowRecord } | WorkspaceIpcRejection => {
    if (typeof event !== 'object' || event === null) return rejection('not-owner')
    const frame = (event as { senderFrame?: unknown }).senderFrame
    if (typeof frame !== 'object' || frame === null) return rejection('not-owner')
    if ((frame as { parent?: unknown }).parent !== null) return rejection('not-owner')
    const sender = (event as { sender?: unknown }).sender
    if (typeof sender !== 'object' || sender === null) return rejection('not-owner')
    const webContentsId = (sender as { id?: unknown }).id
    if (typeof webContentsId !== 'number' || !Number.isSafeInteger(webContentsId) || webContentsId <= 0) return rejection('not-owner')
    const isDestroyed = (sender as { isDestroyed?: unknown }).isDestroyed
    if (typeof isDestroyed !== 'function' || (isDestroyed as () => boolean).call(sender) === true) return rejection('not-owner')
    const record = windowRegistry.resolveWebContents(webContentsId)
    return record ? { record } : rejection('not-owner')
  }

  const isRejection = (value: { record: WorkspaceWindowRecord } | WorkspaceIpcRejection): value is WorkspaceIpcRejection =>
    (value as WorkspaceIpcRejection).status === 'rejected'

  /** 有飞事务的定向查询：只认快照里真实存在的 transfer，不缓存、不自造 operation。 */
  const findTransfer = (operationId: string) => {
    const snapshot = runtimeStore.getSnapshot()
    const panel = snapshot.panels.find((entry) => entry.transfer?.operationId === operationId)
    return panel ? { panel, snapshot } : undefined
  }
  const findDetachedTarget = (panelInstanceKey: string) =>
    windowRegistry.listWindows().find((entry) => entry.kind === 'detached-panel' && entry.panelInstanceKey === panelInstanceKey)

  /**
   * PLAT-28：面板宿主窗的**受控订阅**（`kind:'detached-panel'`）。
   *
   * 存在的理由：面板窗此前在真机链路上**没有任何 router 订阅调用方**（`attachHostWindow` 只有主窗与
   * `.tabs.*` 两条入口）⇒ 它既收不到布局增量事件，也收不到偏好通知，「语言/主题跟随」无从谈起。
   * 本模块按 `.tabs.*` 的**同一姿态**补上：把「受控快照读取」当作挂载点（`getSnapshot` 是窗口角色解析
   * 与每次受控事件之后的既有读取）。
   *
   * PLAT-30（并入项 1/2）：挂载/幂等/降级/额度归还/释放的**记账**已收到唯一出口
   * `workspaceHostSubscriptionLedger`，本模块只转发（`attachSubscription`）。因此：
   *  - 面板宿主的额度归还**不再**隐式依赖页窗模块的回收通知（PLAT-28 的跨模块耦合）；
   *  - 未接线时（测试缝/漏配）本模块退回自有记账，且 `hostSubscriptionStatus()` **如实**报降级 —— 绝不静默；
   *  - 受控读的准入在这里（未登记/被拒的 sender 在此之前已返回），记账纪律在共享出口里逐条成立。
   */
  const unattachedHostEpochs = new Map<string, number>()
  const degradedHostEpochs = new Map<string, number>()

  /**
   * 未接线（测试缝）时的最小剪除：身份已不在 registry ⇒ 不再可能通过准入读取，记账随之剪除（有界）。
   * 已接线时这份记账恒空，剪除由共享出口负责 —— 两条路径的判据逐字相同（`describeWindow` 为准）。
   */
  const pruneUnattachedHosts = (): void => {
    for (const [windowInstanceId, hostEpoch] of [...unattachedHostEpochs]) {
      if (windowRegistry.describeWindow(windowInstanceId) !== undefined) continue
      unattachedHostEpochs.delete(windowInstanceId)
      if (degradedHostEpochs.get(windowInstanceId) === hostEpoch) degradedHostEpochs.delete(windowInstanceId)
    }
  }

  const attachHostOnce = (record: WorkspaceWindowRecord): boolean => {
    if (record.kind !== 'detached-panel' || record.webContentsId === null) return false
    // PLAT-30：接线了共享记账就一律交给它（唯一出口），本模块绝不再自行记账 ⇒ 两份账不可能分叉
    if (dependencies.attachSubscription !== undefined) return dependencies.attachSubscription.attach(record)
    pruneUnattachedHosts()
    // 未接线：任何挂载尝试都不可能成功 ⇒ 如实记为**降级**（可见），绝不静默、也绝不谎报已订阅
    unattachedHostEpochs.set(record.windowInstanceId, record.hostEpoch)
    degradedHostEpochs.set(record.windowInstanceId, record.hostEpoch)
    return false
  }

  /** PLAT-30：面板侧的只读可见面（与页窗侧 `hostSubscriptionStatus()` 对称）；接线后逐字来自共享记账。 */
  const hostSubscriptionStatus = (): { subscribed: readonly string[]; degraded: readonly string[] } => {
    if (dependencies.attachSubscription !== undefined) return dependencies.attachSubscription.status()
    pruneUnattachedHosts()
    return Object.freeze({ subscribed: Object.freeze([] as string[]), degraded: Object.freeze([...degradedHostEpochs.keys()]) })
  }

  return Object.freeze({
    channels,

    /**
     * PLAT-30（并入项 2）：**只读自证** —— 面板宿主身份的挂载状态（与页窗侧 `hostSubscriptionStatus()`
     * 对称）。`degraded` = 挂载被拒/端口未接线而只靠 IPC 拉取的宿主 ⇒ 降级**可见**，绝不静默。
     * 接线共享记账后逐字来自那唯一出口；未接线时本模块自己的记账同样如实（两者都不修改状态）。
     */
    hostSubscriptionStatus,

    /** sender 作用域内的安全上下文；无 payload（或空对象），任何字段都视为越界请求。 */
    async getHostContext(event: WorkspaceIpcSenderEvent, payload?: unknown): Promise<WorkspaceHostContextOutcome> {
      const sender = resolveSender(event)
      if (isRejection(sender)) return sender
      if (payload !== undefined && payload !== null && plainRecord(payload, []) === null) return rejection('invalid-request')
      const snapshot = runtimeStore.getSnapshot()
      const [language, theme, timeZone] = await Promise.all([dependencies.preferences.getLanguage(), dependencies.preferences.getTheme(), dependencies.preferences.getTimeZone()])
      return {
        status: 'ok',
        context: Object.freeze({
          windowInstanceId: sender.record.windowInstanceId, hostEpoch: sender.record.hostEpoch,
          role: sender.record.kind === 'main' ? 'main' as const : 'panel' as const,
          mounts: scopeHostMounts(snapshot, sender.record), layoutRevision: snapshot.layoutRevision, pageIds,
          // P1-06f：只有「被预留的待接管目标」拿得到受控视图；其余宿主恒为 null（不是布局权限，见投影模块）
          pendingTransfer: pendingTransferFor(snapshot, sender.record),
          preferences: Object.freeze({
            language: safePreference(language, 'en-US', LANGUAGE_PATTERN),
            theme: safePreference(theme, 'system'),
            timeZone: safeTimeZone(timeZone, fallbackTimeZone)
          })
        })
      }
    },

    /** 只读快照：任何已登记且未销毁的宿主都可读；persistenceState 用真实持久化状态覆盖 store 硬编码值。 */
    async getSnapshot(event: WorkspaceIpcSenderEvent, payload?: unknown): Promise<WorkspaceSnapshotOutcome> {
      const sender = resolveSender(event)
      if (isRejection(sender)) return sender
      if (payload !== undefined && payload !== null && plainRecord(payload, []) === null) return rejection('invalid-request')
      // PLAT-28：受控快照读取即面板宿主窗的**挂载点**（幂等、有界，见 attachHostOnce）——
      // 未登记/被拒的 sender 在上面已返回，绝不提前挂载；主窗与页窗不受影响（kind 门控在 attachHostOnce 内）。
      attachHostOnce(sender.record)
      return { status: 'ok', snapshot: scoped(sender.record) }
    },

    /** 严格方法白名单 → runtime store；未知方法/多余字段/非法类型在进 store 之前就被拒绝。 */
    async command(event: WorkspaceIpcSenderEvent, payload?: unknown): Promise<WorkspaceCommandOutcome> {
      const sender = resolveSender(event)
      // 未授权 sender 只拿空投影；已授权宿主才拿自己作用域的投影
      if (isRejection(sender)) return rejectedCommand(emptySnapshot(runtimeStore.getSnapshot(), readPersistenceState), sender.errorCode)
      const deny = (errorCode: WorkspaceIpcRejectionCode) => rejectedCommand(scoped(sender.record), errorCode)
      if (typeof payload !== 'object' || payload === null) return deny('invalid-request')
      const method = (payload as { method?: unknown }).method
      if (typeof method !== 'string') return deny('invalid-request')
      const allowedFields = commandFieldAllowlist(method)
      if (!allowedFields) return deny('invalid-request')
      const fields = plainRecord(payload, allowedFields)
      if (!fields) return deny('invalid-request')
      const requestId = requiredString(fields, 'requestId')
      const expectedRevision = requiredRevision(fields)
      if (requestId === null || expectedRevision === null || !claimMatchesHost(fields, sender.record)) {
        return deny(requestId === null || expectedRevision === null ? 'invalid-request' : 'not-owner')
      }
      const common = {
        requestId, requestScope: sender.record.windowInstanceId, expectedRevision,
        ...storeHostOf(sender.record)
      }
      const apply = async (result: Promise<WorkspaceCommandResult & { panelInstanceKey?: string; workspaceInstanceKey?: string; hostEpoch?: number }>) => {
        const raw = await result
        // 先触发持久化调度（状态可能变 pending），再按宿主投影快照，保证响应里的 persistenceState 真实
        if (raw.status === 'applied') dependencies.onApplied?.()
        return projectCommandOutcome(raw, sender.record, readPersistenceState)
      }
      const panelKey = () => requiredString(fields, 'panelInstanceKey')

      switch (method) {
        case 'openWorkspace': {
          const pageId = requiredString(fields, 'pageId')
          if (pageId === null) return deny('invalid-request')
          if (!pageIdSet.has(pageId)) return deny('registration-missing')
          // 只有主窗拥有本应用布局管理权；独立窗口不得新建工作区
          if (sender.record.kind !== 'main') return deny('not-owner')
          // PLAT-35：该页已有打开的 Tab ⇒ **采纳 Tab 链的键**（幂等，不自造第二个 workspace）；
          // 没有 Tab 才保持既有「自造新键」。桥接端口缺省 = 逐字回到旧语义。
          const tabWorkspaceKey = dependencies.resolvePageWorkspaceKey?.(pageId) ?? null
          if (tabWorkspaceKey !== null) {
            return apply(runtimeStore.adoptWorkspace({ workspaceInstanceKey: tabWorkspaceKey, pageId }))
          }
          return apply(runtimeStore.openWorkspace({ ...common, pageId }))
        }
        case 'openPanel': {
          const workspaceInstanceKey = requiredString(fields, 'workspaceInstanceKey')
          const panelId = requiredString(fields, 'panelId')
          const bindingKey = optionalString(fields, 'bindingKey')
          const newInstance = fields.newInstance
          if (workspaceInstanceKey === null || panelId === null || bindingKey === null
            || (newInstance !== undefined && typeof newInstance !== 'boolean')) return deny('invalid-request')
          return apply(runtimeStore.openPanel({
            ...common, workspaceInstanceKey, panelId,
            ...(bindingKey === undefined ? {} : { bindingKey }),
            ...(newInstance === undefined ? {} : { newInstance })
          }))
        }
        case 'bindPanel': {
          const panelInstanceKey = panelKey()
          const bindingKey = requiredString(fields, 'bindingKey')
          if (panelInstanceKey === null || bindingKey === null) return deny('invalid-request')
          return apply(runtimeStore.bindPanel({ ...common, panelInstanceKey, bindingKey }))
        }
        case 'activatePanel': {
          const panelInstanceKey = panelKey()
          if (panelInstanceKey === null) return deny('invalid-request')
          return apply(runtimeStore.activatePanel({ ...common, panelInstanceKey }))
        }
        case 'closePanel': {
          const panelInstanceKey = panelKey()
          if (panelInstanceKey === null) return deny('invalid-request')
          return apply(runtimeStore.closePanel({ ...common, panelInstanceKey }))
        }
        case 'switchContainer': {
          const panelInstanceKey = panelKey()
          const mode = requiredMode(fields)
          if (panelInstanceKey === null || mode === null) return deny('invalid-request')
          return apply(runtimeStore.switchContainer({ ...common, panelInstanceKey, mode }))
        }
        case 'resizePanel': {
          const panelInstanceKey = panelKey()
          const dockSize = requiredSize(fields, 'dockSize')
          if (panelInstanceKey === null || dockSize === null) return deny('invalid-request')
          return apply(runtimeStore.resizePanel({ ...common, panelInstanceKey, dockSize }))
        }
        case 'resetPanelSize': {
          const panelInstanceKey = panelKey()
          if (panelInstanceKey === null) return deny('invalid-request')
          return apply(runtimeStore.resetPanelSize({ ...common, panelInstanceKey }))
        }
        case 'reopenPanel': {
          const panelInstanceKey = panelKey()
          if (panelInstanceKey === null) return deny('invalid-request')
          return apply(runtimeStore.reopenPanel({ ...common, panelInstanceKey }))
        }
        case 'detachPanel': {
          const panelInstanceKey = panelKey()
          if (panelInstanceKey === null) return deny('invalid-request')
          // 分离是跨窗口事务：只有接线了 P1-04 完整宿主（含 requestDetach）才具备能力，否则 fail closed。
          if (!dependencies.transfers) return deny('unsupported')
          return apply(dependencies.transfers.detach({
            requestId, expectedRevision,
            sourceWindowInstanceId: sender.record.windowInstanceId, sourceHostEpoch: sender.record.hostEpoch,
            panelInstanceKey
          }))
        }
        case 'redockPanel': {
          const panelInstanceKey = panelKey()
          if (panelInstanceKey === null) return deny('invalid-request')
          // **PLAT-40**：只有分离面板窗自己可以请求回停靠（页窗/主窗调用一律 not-owner）；
          // 能力缺失（未接线编排）时 fail closed。目标停靠模式由 Main 收敛，renderer 不传 mode。
          if (sender.record.kind !== 'detached-panel') return deny('not-owner')
          const transfers = dependencies.transfers
          if (!transfers || typeof transfers.redock !== 'function') return deny('unsupported')
          return apply(transfers.redock({
            requestId, expectedRevision,
            sourceWindowInstanceId: sender.record.windowInstanceId, sourceHostEpoch: sender.record.hostEpoch,
            panelInstanceKey
          }))
        }
        default:
          return deny('invalid-request')
      }
    },

    /**
     * 窗口宿主异步 ACK 的准入：只接受「有飞事务 + 该阶段预期参与者 + 与 registry 记录一致的 epoch」。
     * 全部失败路径返回 `accepted:false` 且不改布局；P1-04 端口缺失（未接线）时报 `unsupported`。
     */
    async hostLifecycle(event: WorkspaceIpcSenderEvent, payload?: unknown): Promise<WorkspaceHostLifecycleOutcome> {
      const sender = resolveSender(event)
      if (isRejection(sender)) return { accepted: false, reason: 'not-owner' }
      const denied = (reason: WorkspaceHostLifecycleReason): WorkspaceHostLifecycleOutcome => ({ accepted: false, reason })
      const fields = plainRecord(payload, ['operationId', 'phase', 'windowInstanceId', 'hostEpoch', 'kind', 'accepted'])
      if (!fields) return denied('invalid-request')
      const operationId = requiredString(fields, 'operationId')
      const phase = fields.phase
      if (operationId === null || !isLifecyclePhase(phase)) return denied('invalid-request')
      if ((fields.kind !== undefined && phase !== 'window-failure') || (fields.accepted !== undefined && phase !== 'source-prepared')) {
        return denied('invalid-request')
      }
      if (phase === 'window-failure' && fields.kind !== 'crash' && fields.kind !== 'unresponsive') return denied('invalid-request')
      if (fields.accepted !== undefined && typeof fields.accepted !== 'boolean') return denied('invalid-request')
      if (!claimMatchesHost(fields, sender.record)) return denied('not-owner')

      const transfer = findTransfer(operationId)
      if (!transfer) return denied('unknown-operation')
      const record = sender.record
      const host = storeHostOf(record)

      if (phase === 'target-ready' || phase === 'window-failure' || phase === 'native-close') {
        const target = findDetachedTarget(transfer.panel.panelInstanceKey)
        if (!target || target.windowInstanceId !== record.windowInstanceId || target.hostEpoch !== record.hostEpoch) return denied('not-owner')
        if (!dependencies.detachedHost) return denied('unsupported')
        const claim = { operationId, windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch }
        if (phase === 'target-ready') return await dependencies.detachedHost.confirmTargetReady(claim)
        if (phase === 'window-failure') {
          const outcome = await dependencies.detachedHost.reportWindowFailure({
            windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch,
            kind: fields.kind as 'crash' | 'unresponsive'
          })
          return outcome.status === 'rejected' ? { accepted: false, reason: 'not-owner' } : { accepted: true }
        }
        const registration = panelRegistry.get(transfer.panel.panelId)
        if (!registration) return denied('registration-missing')
        const outcome = await dependencies.detachedHost.handleNativeClose({
          windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch,
          lastValidDock: transfer.panel.lastValidDock, supportedModes: registration.supportedModes
        })
        return { accepted: outcome.status === 'redocked' }
      }

      // 源宿主阶段：只有当前承载该面板的宿主才能 ACK；store 的 target 身份由 P1-05 内部持有，本包不改写。
      const isSource = transfer.panel.windowInstanceId === host.windowInstanceId && transfer.panel.hostEpoch === host.hostEpoch
      if (!isSource) return denied('not-owner')
      // P1-06d：P1-04 端口没有 prepared 信号，源 renderer 的 source-prepared 由编排器真实准入
      //（accepted=false 表示源拒绝准备 ⇒ 中止事务并销毁目标窗）；未接线时保持 fail closed。
      if (phase === 'source-prepared') {
        if (!dependencies.transfers) return denied('unsupported')
        const outcome = await dependencies.transfers.noteSourcePrepared({
          operationId, source: host,
          accepted: fields.accepted === undefined ? true : fields.accepted as boolean
        })
        return outcome.accepted ? { accepted: true } : { accepted: false, reason: 'source-rejected' }
      }
      if (!dependencies.detachedHost) return denied('unsupported')
      const claim = { operationId, windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch }
      return phase === 'source-released'
        ? await dependencies.detachedHost.confirmSourceReleased(claim)
        : await dependencies.detachedHost.confirmSourceInvalid(claim)
    }
  })
}

/**
 * PLAT-26：把**受控通道**挂到 `ipcMain` 的唯一点（注册内容与准入链逐字不变）。
 *
 * 拆出来的原因：`app.ts` 必须能在**建窗之前**注册（`createMainWindow()` 只加载 about:blank，但 preload 已挂
 * ⇒ 任何在 `start()` 之前被驱动的窗口都可能打出 `No handler registered`）。注册与「恢复布局」因此是两个入口：
 * 本函数只注册，恢复仍只在 `start()` 里发生一次；`.tabs.*` 仍以「注入完整宿主」（`tabHandlers !== null`）为门槛。
 * 重复调用由调用方（compose 的 `registerChannels()`）幂等保证 —— 二次 `ipcMain.handle` 会在运行期抛错。
 */
export function registerPanelWorkspaceIpcChannels(input: {
  ipcMain: Pick<IpcMain, 'handle'>
  handlers: ReturnType<typeof createPanelWorkspaceIpcHandlers>
  tabHandlers: null | ReturnType<typeof createTabWorkspaceIpcHandlers>
}): void {
  const { handlers, tabHandlers } = input
  input.ipcMain.handle(handlers.channels.workspaceGetHostContext, handlers.getHostContext)
  input.ipcMain.handle(handlers.channels.workspaceGetSnapshot, handlers.getSnapshot)
  input.ipcMain.handle(handlers.channels.workspaceCommand, handlers.command)
  input.ipcMain.handle(handlers.channels.workspaceHostLifecycle, handlers.hostLifecycle)
  if (tabHandlers === null) return
  input.ipcMain.handle(tabHandlers.channels.workspaceTabsGetSnapshot, tabHandlers.getSnapshot)
  input.ipcMain.handle(tabHandlers.channels.workspaceTabsCommand, tabHandlers.command)
  input.ipcMain.handle(tabHandlers.channels.workspaceTabsHostLifecycle, tabHandlers.hostLifecycle)
}
