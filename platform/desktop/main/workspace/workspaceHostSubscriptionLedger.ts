import type { WorkspaceWindowKind, WorkspaceWindowRecord, WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。权威：PLAT-30（并入项 1/2）、PLAT-01①②、P2-09/B3、P2-10①。
 *
 * **宿主订阅记账的唯一出口**。此前两块记账分散在两个模块里：`tabWorkspaceIpcHandlers` 记得页窗宿主，
 * `panelWorkspaceIpcHandlers` 记得面板宿主，而面板宿主的额度归还**跨模块隐式依赖**页窗模块的
 * `registry.onWindowRecycled` 订阅（不按 kind 过滤），并且「真实释放信用」是**全局一个计数器** ⇒
 * 一次面板宿主回收可能被另一个页窗身份消费（或反之）。本模块把面板宿主 / 页窗宿主两类订阅者的
 * 挂载、幂等、降级、额度归还与释放收进**同一份状态机**：回收派发点与记账同源，没有第二处可以分叉。
 *
 * 语义逐字保留（与 PLAT-01/P2-09/P2-10 的既有回归一致）：
 *  - 同一宿主身份（`windowInstanceId` + `hostEpoch`）**至多挂载一次**：首次挂载端口仍会直发一条快照
 *    （与 `router.attachHost` 既有语义一致），其后重复读只返回权威投影 ⇒ 绝不按读次数重发（无自持环）；
 *  - **先记账再调用**：端口抛错也不得让下一次读再产生副作用（幂等是「至多一次」，不是「成功才记」）；
 *    挂载失败/被拒记入 `degraded`（**绝不静默**），且只在**真实释放过额度**时重试一次；
 *  - 释放信用按**真实释放事件**逐个发放（即时回收通知或剪除各恰一个），**降级宿主消费自己的一次**；
 *  - **epoch 守卫**：陈旧 epoch 的迟到释放绝不误删同窗口新 epoch 的在线订阅与降级标记；
 *  - 登记回收（`registry.onWindowRecycled`）**当刻**结算：绝不依赖调用方「下一次读」。
 *
 * 与 PLAT-01② 同一取向：`attach` 与 `release` 都是**必填端口** —— 漏注在类型层不可构造，运行期在构造期
 * 以 `workspace-host-subscription-attach-required` / `workspace-host-subscription-release-required`
 * fail closed，绝不静默降级为「额度永不归还/永不订阅」。
 */

/** 记账覆盖的宿主类别（主窗不进入本记账：它由 `router.attachHost` 直挂，不参与 detached 额度预算）。 */
export type WorkspaceHostSubscriptionKind = Extract<WorkspaceWindowKind, 'detached-panel' | 'detached-tab'>

/** 只读自证：`subscribed` 与 `degraded` 互斥（身份要么真的订上了，要么如实记为降级）。 */
export type WorkspaceHostSubscriptionStatus = {
  subscribed: readonly string[]
  degraded: readonly string[]
}

/**
 * 按 kind 收窄的端口视图：只拿自己那一类的记账，**看不到也动不了**另一类的状态
 * （页窗 handler 拿 `attachFor('detached-tab')`，面板 handler 拿 `attachFor('detached-panel')`）。
 */
export type WorkspaceHostSubscriptionPort = {
  /** 挂载点（幂等、有界、fail closed）；返回是否**真的**订上了。 */
  attach: (record: WorkspaceWindowRecord) => boolean
  /** 只读记账投影（绝不修改状态）。 */
  status: () => WorkspaceHostSubscriptionStatus
}

export type WorkspaceHostSubscriptionLedger = {
  attachFor: (kind: WorkspaceHostSubscriptionKind) => WorkspaceHostSubscriptionPort
  /** 挂载点（与 `attachFor(kind).attach` 同一实现；未注入端口或身份非法一律 `false`，绝不静默记账）。 */
  attach: (record: WorkspaceWindowRecord, kind: WorkspaceHostSubscriptionKind) => boolean
  /** 宿主销毁 / 登记回收 / 身份失效的释放出口；`released` 表示端口真的释放了一个额度（epoch 守卫）。 */
  releaseHost: (input: { windowInstanceId: string; hostEpoch: number }) => { released: boolean }
  /** 只读自证（按 kind）。 */
  query: (kind: WorkspaceHostSubscriptionKind) => WorkspaceHostSubscriptionStatus
  /** 全部退订/退出：撤销回收订阅并清空记账（幂等）。 */
  dispose: () => void
}

const ATTACH_REQUIRED = 'workspace-host-subscription-attach-required'
const RELEASE_REQUIRED = 'workspace-host-subscription-release-required'
const MAX_ID_LENGTH = 200

function validIdentity(input: { windowInstanceId?: unknown; hostEpoch?: unknown }): boolean {
  return typeof input.windowInstanceId === 'string' && input.windowInstanceId.trim().length > 0
    && input.windowInstanceId.length <= MAX_ID_LENGTH
    && typeof input.hostEpoch === 'number' && Number.isSafeInteger(input.hostEpoch) && input.hostEpoch >= 1
}

export function createWorkspaceHostSubscriptionLedger(options: {
  windowRegistry: WorkspaceWindowRegistry
  /** 真机＝`router.attachHost`（退订旧 listener → 直发 current snapshot → 续增量）。**必填**。 */
  attach: (record: WorkspaceWindowRecord) => boolean
  /** 真机＝`router.releaseHost`。**必填**（与 PLAT-01② 同一取向）。 */
  release: (input: { windowInstanceId: string; hostEpoch: number }) => unknown
}): WorkspaceHostSubscriptionLedger {
  if (typeof options.attach !== 'function') throw new Error(ATTACH_REQUIRED)
  if (typeof options.release !== 'function') throw new Error(RELEASE_REQUIRED)
  const { windowRegistry } = options
  const attachPort = options.attach
  const releasePort = options.release

  /** 已挂载记账：`windowInstanceId → hostEpoch`（同一宿主身份至多挂载一次）。 */
  const mounted = new Map<string, number>()
  /** 降级记账（挂载被拒/端口失败）；按 epoch 记录，陈旧 epoch 的释放绝不清掉新身份的降级标记。 */
  const degraded = new Map<string, number>()
  /**
   * **真实释放事件**的额度信用（即时回收通知或剪除各恰一个）。每个降级宿主只在有信用时重试**一次**
   * 并消费它 ⇒ 重试由释放驱动，绝不由读次数驱动；信用属于发放它的那次释放，绝不跨 kind 串账。
   */
  let releasedCredits = 0
  const entryKind = new Map<string, WorkspaceHostSubscriptionKind>()

  /**
   * 记账条目的 kind：登记仍在 ⇒ 以 registry 为准；登记已回收 ⇒ 用挂载时记下的 kind
   * （降级条目也记 kind，否则回收后它的类别会丢失、可见面就会漏报）。
   */
  const kindOf = (windowInstanceId: string): WorkspaceHostSubscriptionKind | undefined => {
    const record = windowRegistry.describeWindow(windowInstanceId)
    if (record !== undefined) return record.kind === 'main' ? undefined : record.kind
    return entryKind.get(windowInstanceId)
  }

  const releaseHostTarget = (input: { windowInstanceId: string; hostEpoch: number }): { released: boolean } => {
    const current = mounted.get(input.windowInstanceId)
    const tracked = current !== undefined && current === input.hostEpoch
    if (tracked) {
      mounted.delete(input.windowInstanceId)
      // 真实释放了本记账跟踪的额度 ⇒ 恰一个重试信用（由释放事件驱动，绝不由读次数驱动）
      releasedCredits += 1
      entryKind.delete(input.windowInstanceId)
    }
    if (degraded.get(input.windowInstanceId) === input.hostEpoch) degraded.delete(input.windowInstanceId)
    let released = false
    if (tracked) {
      try { releasePort({ windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch }); released = true } catch { /* 通知失败不影响已提交结论 */ }
    }
    return { released }
  }

  /**
   * 登记已不在 registry（身份再也不可能通过准入读取）⇒ 走同一释放出口。这是**防御性**路径：
   * 即时回收通知已覆盖，剪除只为通知未达的登记分叉兜底，且绝不在可能仍存活的窗口上提前退订。
   */
  const prune = (): number => {
    if (mounted.size === 0) return 0
    let released = 0
    for (const [windowInstanceId, hostEpoch] of [...mounted]) {
      if (windowRegistry.describeWindow(windowInstanceId) !== undefined) continue
      releaseHostTarget({ windowInstanceId, hostEpoch })
      released += 1
    }
    return released
  }

  /** `registry.onWindowRecycled` 的**唯一**订阅：登记回收当刻结算，绝不依赖下一次读。 */
  const unsubscribeRecycle = windowRegistry.onWindowRecycled((record) => {
    releaseHostTarget({ windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch })
  })

  const attach = (record: WorkspaceWindowRecord, kind: WorkspaceHostSubscriptionKind): boolean => {
    if (record.kind !== kind || record.webContentsId === null) return false
    if (!validIdentity(record)) return false
    prune()
    const isMounted = mounted.get(record.windowInstanceId) === record.hostEpoch
    const degradedHere = degraded.get(record.windowInstanceId) === record.hostEpoch
    const retryDegraded = degradedHere && releasedCredits > 0
    if (isMounted && !retryDegraded) return !degradedHere
    // 先记账再调用：挂载端口即使抛错也不得让下一次读再次产生副作用（幂等是「至多一次」）
    if (retryDegraded) releasedCredits -= 1
    mounted.set(record.windowInstanceId, record.hostEpoch)
    entryKind.set(record.windowInstanceId, kind)
    let subscribed = false
    try { subscribed = attachPort(record) === true } catch { subscribed = false }
    if (subscribed) degraded.delete(record.windowInstanceId)
    else degraded.set(record.windowInstanceId, record.hostEpoch)
    return subscribed
  }

  const query = (kind: WorkspaceHostSubscriptionKind): WorkspaceHostSubscriptionStatus => {
    const subscribed: string[] = []
    const degradedHosts: string[] = []
    const visit = (entry: { windowInstanceId: string; hostEpoch: number }, isMounted: boolean): void => {
      if (kindOf(entry.windowInstanceId) !== kind) return
      if (isMounted) {
        // 已挂载但降级 ⇒ 只进 degraded；已挂载且健康 ⇒ 只进 subscribed（两者互斥）
        if (degraded.get(entry.windowInstanceId) === entry.hostEpoch) return
        subscribed.push(entry.windowInstanceId)
        return
      }
      // 降级账在登记回收后仍保留到剪除/释放为止 ⇒ 这里不要求身份仍在 registry
      // （否则「被拒的宿主」会在回收后从可见面消失，正是 PLAT-01① 要消灭的静默降级）
      if (!degraded.has(entry.windowInstanceId)) return
      degradedHosts.push(entry.windowInstanceId)
    }
    for (const [windowInstanceId, hostEpoch] of mounted) visit({ windowInstanceId, hostEpoch }, true)
    for (const [windowInstanceId, hostEpoch] of degraded) visit({ windowInstanceId, hostEpoch }, false)
    return Object.freeze({ subscribed: Object.freeze(subscribed), degraded: Object.freeze(degradedHosts) })
  }

  return Object.freeze({
    attachFor(kind: WorkspaceHostSubscriptionKind): WorkspaceHostSubscriptionPort {
      return Object.freeze({
        attach: (record: WorkspaceWindowRecord) => attach(record, kind),
        status: () => query(kind)
      })
    },
    attach,
    releaseHost: releaseHostTarget,
    query,
    dispose(): void {
      unsubscribeRecycle()
      mounted.clear()
      degraded.clear()
      entryKind.clear()
      releasedCredits = 0
    }
  })
}
