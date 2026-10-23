import { WorkspaceOwnershipPolicy, WorkspaceTransferPolicy } from '@platform/workspace/policies'

/**
 * Owner: platform/desktop/main/workspace。权威：技术设计 §4/§5 与 P1-04。
 *
 * Main 私有窗口 registry：`windowInstanceId` + `hostEpoch` 是运行期身份，webContents 只能通过这里
 * 反查归属，未登记/已销毁一律拒绝而不是猜 owner。detached 宿主预算直接消费
 * `WorkspaceTransferPolicy.maxDetachedHosts`（不复制字面量），预留即占额，超限只拒绝新分离，
 * 绝不挤掉既有宿主。迟到窗口只做判定（`identityStatus`），销毁动作由调用方按 sender 执行。
 * **PLAT-01**：登记回收（销毁/预留释放/采纳撤销）在回收**当刻**同步通知订阅者（`onWindowRecycled`），
 * 使运行期资源释放（router target、`maxTargets` 额度）不再依赖调用方下一次读 —— 但通知只在登记确实
 * 被回收时派发，绝不在窗口可能仍存活时提前通知。
 */

/**
 * P2-03：`detached-tab` 是**页面宿主窗**（一级菜单页的独立窗），与 `detached-panel` 共用同一份身份/预算，
 * 但**不**进入 `listDetachedHosts()`（面板收敛链按面板语义遍历，混入页窗会误收敛）。
 */
export type WorkspaceWindowKind = 'main' | 'detached-panel' | 'detached-tab'

export type WorkspaceWindowRecord = {
  windowInstanceId: string
  hostEpoch: number
  kind: WorkspaceWindowKind
  /** 尚未 attach（预留中）时为 null。 */
  webContentsId: number | null
  panelInstanceKey: string | null
  workspaceInstanceKey: string | null
}

/** 预留成功后返回的登记记录（此时还没有 webContents）。 */
export type WorkspaceWindowReservation = WorkspaceWindowRecord

/**
 * PLAT-01：**登记回收通知**的订阅者。registry 是回收的唯一权威，通知只承载「这条登记已从权威表里消失」，
 * 因此订阅者只做资源释放/记账（例如释放 router target、归还额度），**绝不**据此销毁任何窗口，
 * 也绝不把通知当成「窗口已死」以外的判据 —— 窗口是否仍存活的权威是 registry 登记本身。
 */
export type WorkspaceWindowRecycleListener = (record: WorkspaceWindowRecord) => void

export type WorkspaceWindowRegistryErrorCode = 'limit-reached' | 'unknown-window' | 'epoch-mismatch' | 'web-contents-bound'

/**
 * P2-03 的 Tab 身份预分配（**身份采纳**）：页面 Tab 的容器身份由 Tab runtime store 分配
 * （`workspaceTabStore.detachTab` 生成的 `windowInstanceId` + `hostEpoch`），registry **采纳**它而不是
 * 另发一个身份 —— 否则 store 的 `managesTab`/`ownsTab` 归属判定会与新窗身份分叉。
 *
 * 采纳分两步、且**一次性**：
 *  1) `reserveDetachedTabWindow` 登记 `detached-tab` 记录并留下一条待消费意图；
 *  2) 共享 P1 宿主随后的 `reserveDetachedWindow`（它不知道 Tab 概念）消费该意图并拿到**同一条**记录，
 *     因此面板宿主的事务/超时/迟到回调/预算语义原样复用，零复制。
 * 未被消费的意图由 `releaseReservation` 释放，绝不残留、绝不复用（同一身份第二次采纳一律拒绝）。
 */
export type WorkspaceDetachedTabReservation =
  | { status: 'reserved'; record: WorkspaceWindowRecord }
  | { status: 'rejected'; errorCode: 'limit-reached' | 'invalid-identity' | 'duplicate-identity' }

export type WorkspaceWindowRegistry = {
  registerMainWindow: (input: { webContentsId: number; hostEpoch?: number }) => WorkspaceWindowRecord
  reserveDetachedWindow: (input: {
    hostEpoch: number
    panelInstanceKey: string
    workspaceInstanceKey: string
  }) => { status: 'reserved'; record: WorkspaceWindowReservation } | { status: 'rejected'; errorCode: 'limit-reached' }
  /** P2-03：页面 Tab 的受控身份采纳（见 `WorkspaceDetachedTabReservation`）。 */
  reserveDetachedTabWindow: (input: {
    windowInstanceId: string
    hostEpoch: number
    workspaceInstanceKey: string
  }) => WorkspaceDetachedTabReservation
  /** 页面宿主窗（不含面板宿主）：收敛链必须能区分两者。 */
  listDetachedTabs: () => readonly WorkspaceWindowRecord[]
  detachedTabCount: () => number
  /** 撤销一条**尚未被宿主消费**的 Tab 身份采纳（采纳失败/放弃分离时调用）。 */
  revokeDetachedTabReservation: (windowInstanceId: string) => boolean
  attachWebContents: (input: { windowInstanceId: string; webContentsId: number }) =>
    { status: 'attached'; record: WorkspaceWindowRecord } | { status: 'rejected'; errorCode: 'unknown-window' | 'web-contents-bound' }
  releaseReservation: (windowInstanceId: string) => boolean
  markDestroyed: (input: { windowInstanceId?: string; webContentsId?: number }) => WorkspaceWindowRecord | undefined
  /**
   * PLAT-01：**登记回收的同步通知**（`markDestroyed` / `releaseReservation` / `revokeDetachedTabReservation`
   * 确实回收了一条登记时，在回收当刻派发被回收的记录）。
   *
   * 存在的理由：资源释放（router target、`maxTargets` 额度）绝不能依赖调用方**下一次读**去剪除 ——
   * 那样死宿主的额度会被长期占用、后续窗口静默降级。登记一旦消失，该身份就再也不可能收到定向投递，
   * 因此这里是「销毁即释放」的唯一权威时点。
   * 硬约束：**只在登记确实被回收时派发**，绝不在窗口可能仍存活时提前通知（否则订阅方提前退订，
   * 下一次读会重挂并重发直发快照 ⇒ P2-09/B3 的 snapshot 重挂风暴）。
   * 订阅者异常一律吞掉（回收结论与其它订阅者不受影响）。返回退订函数。
   */
  onWindowRecycled: (listener: WorkspaceWindowRecycleListener) => () => void
  resolveWebContents: (webContentsId: number) => WorkspaceWindowRecord | undefined
  describeWindow: (windowInstanceId: string) => WorkspaceWindowRecord | undefined
  listWindows: () => readonly WorkspaceWindowRecord[]
  listDetachedHosts: () => readonly WorkspaceWindowRecord[]
  detachedHostCount: () => number
  /**
   * 身份是否仍是当前登记的宿主：'current'（身份+epoch 都匹配）/ 'stale'（已知窗口，但来者不是当前 owner）/
   * 'unregistered'（registry 完全不认识该身份）。**本判定不承载销毁指令**：'stale' 绝不允许据此销毁在线窗口；
   * 只有 'unregistered' 才可能是孤儿（外部孤儿由平台按 sender 销毁）。
   */
  identityStatus: (input: { windowInstanceId: string; hostEpoch: number }) => 'current' | 'stale' | 'unregistered'
  assertOwner: (input: { windowInstanceId: string; hostEpoch: number }) =>
    { status: 'ok'; record: WorkspaceWindowRecord } | { status: 'rejected'; errorCode: WorkspaceWindowRegistryErrorCode }
}

export function createWorkspaceWindowRegistry(options: {
  maxDetachedHosts?: number
  createOpaqueId?: (prefix: string) => string
} = {}): WorkspaceWindowRegistry {
  const maxDetachedHosts = options.maxDetachedHosts ?? WorkspaceTransferPolicy.maxDetachedHosts
  const createId = options.createOpaqueId ?? defaultOpaqueId
  const windows = new Map<string, WorkspaceWindowRecord>()
  const byWebContents = new Map<number, string>()

  const detachedHosts = (): WorkspaceWindowRecord[] =>
    [...windows.values()].filter((record) => record.kind === 'detached-panel')
  const detachedTabs = (): WorkspaceWindowRecord[] =>
    [...windows.values()].filter((record) => record.kind === 'detached-tab')
  /**
   * P2-03 共享预算：面板宿主与页面宿主窗消费**同一个** `maxDetachedHosts`。
   * 两条 kind 各自独立计数（收敛链不混），但占额合并 —— 不存在第二套预算常量。
   */
  const detachedWindows = (): WorkspaceWindowRecord[] =>
    [...windows.values()].filter((record) => record.kind !== 'main')
  /**
   * 待消费的 Tab 身份采纳（一次一条、有界、FIFO）：key = windowInstanceId。
   * 只保存身份与归属，不保存任何窗口句柄。
   */
  const pendingTabIdentities = new Map<string, { windowInstanceId: string; hostEpoch: number; workspaceInstanceKey: string }>()
  /**
   * PLAT-01：登记回收订阅者（有界：只由组合根在构造期注册；订阅者异常绝不影响回收结论）。
   */
  const recycleListeners = new Set<WorkspaceWindowRecycleListener>()

  /** PLAT-01：唯一的回收派发点（只在记录**确实被回收**时调用，绝不提前通知）。 */
  const notifyRecycled = (record: WorkspaceWindowRecord): void => {
    for (const listener of [...recycleListeners]) {
      try { listener(record) } catch { /* 单个订阅者失败不影响回收结论与其它订阅者 */ }
    }
  }

  /** 唯一的登记回收原语：从权威表移除并**当刻**通知订阅者（销毁/预留释放/采纳撤销共用）。 */
  const forget = (windowInstanceId: string): WorkspaceWindowRecord | undefined => {
    const record = windows.get(windowInstanceId)
    if (!record) return undefined
    windows.delete(windowInstanceId)
    if (record.webContentsId !== null) byWebContents.delete(record.webContentsId)
    notifyRecycled(record)
    return record
  }

  return Object.freeze({
    registerMainWindow(input: { webContentsId: number; hostEpoch?: number }): WorkspaceWindowRecord {
      const existingId = byWebContents.get(input.webContentsId)
      const existing = existingId === undefined ? undefined : windows.get(existingId)
      if (existing) return existing
      const record: WorkspaceWindowRecord = {
        windowInstanceId: createId('window'),
        hostEpoch: input.hostEpoch ?? WorkspaceOwnershipPolicy.initialHostEpoch,
        kind: 'main',
        webContentsId: input.webContentsId,
        panelInstanceKey: null,
        workspaceInstanceKey: null
      }
      windows.set(record.windowInstanceId, record)
      byWebContents.set(input.webContentsId, record.windowInstanceId)
      return record
    },

    reserveDetachedWindow(input: { hostEpoch: number; panelInstanceKey: string; workspaceInstanceKey: string }) {
      // P2-03：先消费「页面 Tab 身份采纳」意图 —— 共享 P1 宿主对页面窗与面板窗走同一条预留调用，
      // 采纳在这里发生，因此宿主侧零改动、零复制；匹配判据是采纳时登记的归属身份（不接受自选）。
      const adopted = [...pendingTabIdentities.values()].find((entry) =>
        entry.workspaceInstanceKey === input.workspaceInstanceKey && entry.hostEpoch === input.hostEpoch)
      if (adopted !== undefined) {
        pendingTabIdentities.delete(adopted.windowInstanceId)
        const record = windows.get(adopted.windowInstanceId)
        // 采纳意图指向的记录必须仍在（否则身份已失效）：fail closed，绝不临时新建一个身份
        if (record === undefined) return { status: 'rejected' as const, errorCode: 'limit-reached' as const }
        return { status: 'reserved' as const, record }
      }
      if (detachedWindows().length >= maxDetachedHosts) return { status: 'rejected' as const, errorCode: 'limit-reached' as const }
      const record: WorkspaceWindowRecord = {
        windowInstanceId: createId('window'),
        hostEpoch: input.hostEpoch,
        kind: 'detached-panel',
        webContentsId: null,
        panelInstanceKey: input.panelInstanceKey,
        workspaceInstanceKey: input.workspaceInstanceKey
      }
      windows.set(record.windowInstanceId, record)
      return { status: 'reserved' as const, record }
    },

    reserveDetachedTabWindow(input: { windowInstanceId: string; hostEpoch: number; workspaceInstanceKey: string }) {
      const lengthOk = typeof input.windowInstanceId === 'string' && input.windowInstanceId.trim().length > 0
        && input.windowInstanceId.length <= 200
      if (!lengthOk || !Number.isSafeInteger(input.hostEpoch) || input.hostEpoch < 1) {
        return { status: 'rejected' as const, errorCode: 'invalid-identity' as const }
      }
      // 已登记（在用）或已在待消费表里的身份一律拒绝：身份只采纳一次，绝不复用
      if (windows.has(input.windowInstanceId) || pendingTabIdentities.has(input.windowInstanceId)) {
        return { status: 'rejected' as const, errorCode: 'duplicate-identity' as const }
      }
      if (detachedWindows().length >= maxDetachedHosts) return { status: 'rejected' as const, errorCode: 'limit-reached' as const }
      const record: WorkspaceWindowRecord = {
        windowInstanceId: input.windowInstanceId,
        hostEpoch: input.hostEpoch,
        kind: 'detached-tab',
        webContentsId: null,
        panelInstanceKey: null,
        workspaceInstanceKey: input.workspaceInstanceKey
      }
      windows.set(record.windowInstanceId, record)
      pendingTabIdentities.set(record.windowInstanceId, {
        windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch, workspaceInstanceKey: input.workspaceInstanceKey
      })
      // 有界：待消费意图绝不超过共享预算（超出的最旧一条丢弃，其登记由调用方释放）
      while (pendingTabIdentities.size > maxDetachedHosts) {
        const oldest = pendingTabIdentities.keys().next().value
        if (oldest === undefined) break
        pendingTabIdentities.delete(oldest)
      }
      return { status: 'reserved' as const, record }
    },

    revokeDetachedTabReservation(windowInstanceId: string): boolean {
      const revoked = pendingTabIdentities.delete(windowInstanceId)
      const record = windows.get(windowInstanceId)
      // 只允许撤销**尚未绑定 webContents** 的采纳（已物化的窗口只能走 close/销毁路径）
      // PLAT-01：这里是一条真实回收路径 ⇒ 走同一回收原语（当刻通知订阅者释放该身份的运行期资源）
      if (record !== undefined && record.webContentsId === null) forget(windowInstanceId)
      return revoked
    },

    attachWebContents(input: { windowInstanceId: string; webContentsId: number }) {
      const record = windows.get(input.windowInstanceId)
      if (!record) return { status: 'rejected' as const, errorCode: 'unknown-window' as const }
      const claimedBy = byWebContents.get(input.webContentsId)
      // 同一 webContents 不得静默改绑到另一个窗口（旧绑定必须先显式释放），否则归属会漂移
      if (claimedBy !== undefined && claimedBy !== input.windowInstanceId) {
        return { status: 'rejected' as const, errorCode: 'web-contents-bound' as const }
      }
      if (record.webContentsId !== null && record.webContentsId !== input.webContentsId) {
        byWebContents.delete(record.webContentsId)
      }
      const bound: WorkspaceWindowRecord = { ...record, webContentsId: input.webContentsId }
      windows.set(bound.windowInstanceId, bound)
      byWebContents.set(input.webContentsId, bound.windowInstanceId)
      return { status: 'attached' as const, record: bound }
    },

    releaseReservation(windowInstanceId: string): boolean {
      // 释放登记必然同时作废该身份的采纳意图（两者是同一身份的两面）
      pendingTabIdentities.delete(windowInstanceId)
      const record = windows.get(windowInstanceId)
      if (!record || record.webContentsId !== null) return false
      forget(windowInstanceId)
      return true
    },

    markDestroyed(input: { windowInstanceId?: string; webContentsId?: number }): WorkspaceWindowRecord | undefined {
      const windowInstanceId = input.windowInstanceId
        ?? (input.webContentsId === undefined ? undefined : byWebContents.get(input.webContentsId))
      if (windowInstanceId !== undefined) pendingTabIdentities.delete(windowInstanceId)
      return windowInstanceId === undefined ? undefined : forget(windowInstanceId)
    },

    /** PLAT-01：登记回收的同步通知（见类型上的契约；退订后绝不再收到）。 */
    onWindowRecycled(listener: WorkspaceWindowRecycleListener): () => void {
      recycleListeners.add(listener)
      return () => { recycleListeners.delete(listener) }
    },

    resolveWebContents(webContentsId: number): WorkspaceWindowRecord | undefined {
      const windowInstanceId = byWebContents.get(webContentsId)
      return windowInstanceId === undefined ? undefined : windows.get(windowInstanceId)
    },

    describeWindow(windowInstanceId: string): WorkspaceWindowRecord | undefined {
      return windows.get(windowInstanceId)
    },

    listWindows(): readonly WorkspaceWindowRecord[] {
      return [...windows.values()]
    },

    listDetachedHosts(): readonly WorkspaceWindowRecord[] {
      return detachedHosts()
    },

    listDetachedTabs(): readonly WorkspaceWindowRecord[] {
      return detachedTabs()
    },

    detachedHostCount(): number {
      return detachedHosts().length
    },

    detachedTabCount(): number {
      return detachedTabs().length
    },

    identityStatus(input: { windowInstanceId: string; hostEpoch: number }): 'current' | 'stale' | 'unregistered' {
      const record = windows.get(input.windowInstanceId)
      if (!record) return 'unregistered'
      return record.hostEpoch === input.hostEpoch ? 'current' : 'stale'
    },

    assertOwner(input: { windowInstanceId: string; hostEpoch: number }) {
      const record = windows.get(input.windowInstanceId)
      if (!record) return { status: 'rejected' as const, errorCode: 'unknown-window' as const }
      if (record.hostEpoch !== input.hostEpoch) return { status: 'rejected' as const, errorCode: 'epoch-mismatch' as const }
      return { status: 'ok' as const, record }
    }
  })
}

function defaultOpaqueId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`
}
