import { randomUUID } from 'node:crypto'

import type {
  WorkspaceBounds,
  WorkspacePageRegistration,
  WorkspaceTabCommandResult,
  WorkspaceTabErrorCode,
  WorkspaceTabRecentlyClosed,
  WorkspaceTabSnapshot,
  WorkspaceTabState
} from '../contracts'
import { WorkspaceOwnershipPolicy, WorkspaceTabPolicy } from '../policies'
import type { createWorkspacePageRegistry } from '../registry/workspacePageRegistry'
import { createWorkspaceCommandQueue } from './workspaceCommandQueue'
import {
  matchDetachedBounds,
  projectLayoutTabs,
  projectRestoredTabs,
  resolveRestoredActiveKey,
  type WorkspaceTabLayoutRecord,
  type WorkspaceTabLayoutRuntimeRecord,
  type WorkspaceTabRestoreResult
} from './workspaceTabLayoutProjection'

/**
 * PLAT-46：布局文档投影（v2 文档 ↔ runtime 记录的纯投影、恢复剪枝、单写载荷）已抽到
 * `workspaceTabLayoutProjection.ts`；这里**原样重导出**既有公开类型，外部 import 点不变。
 */
export type { WorkspaceTabLayoutRecord, WorkspaceTabRestoreResult } from './workspaceTabLayoutProjection'

/**
 * Owner: platform/workspace/runtime（P2-01）。权威：技术设计 §3.5 / §4 / §5.4。
 * Tab runtime 的 Main 侧权威：页面注册（纯描述）→ 打开/聚焦/关闭/重开/排序/分离/回停靠/绑定。
 *
 * 授权模型（§4，逐条对齐而不是放宽）：
 *  - **新建** tab 需要主窗身份（只有主窗持有本应用布局管理权）；
 *  - **管理**既有 tab（激活/关闭/重开/排序/分离/回停靠）允许主窗或该实例的承载宿主（主窗可
 *    focus/rehome/close 自己派生的独立实例）；
 *  - **绑定**是内容所有权：只有真正承载该实例的宿主可以补绑定，主窗不得代绑；
 *  - 每次命令都带 `expectedRevision`（CAS）与宿主身份声明，绝不接受 renderer 自选的实例键。
 *
 * 幂等：同一 `requestScope:requestId` 只在「方法 + 参数逐字一致」时回放原结果，否则 fail closed
 * （与 `panelWorkspaceStore` 同语义；IPC 通道接线在 P2-03）。容量/上界全部来自 `WorkspaceTabPolicy`。
 */

type PageRegistry = ReturnType<typeof createWorkspacePageRegistry>
/**
 * Tab runtime 记录 = 布局投影面（`WorkspaceTabLayoutRuntimeRecord`）+ 会话内的绑定键。
 * PLAT-46：布局文档投影已抽到 `workspaceTabLayoutProjection.ts`，本类型不再重复描述布局字段。
 */
type TabRecord = WorkspaceTabLayoutRuntimeRecord & { bindingKey?: string }
type TabMutation = {
  requestId: string
  requestScope?: string
  expectedRevision: number
  hostEpoch: number
  windowInstanceId?: string
}
type RequestCacheEntry = { fingerprint: string; result: Promise<unknown> }

const MAIN_WINDOW = WorkspaceOwnershipPolicy.initialWindowInstanceId
const MAIN_EPOCH = WorkspaceOwnershipPolicy.initialHostEpoch

function opaqueId(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}

/** 比较用指纹：对象键排序后序列化；环引用/超深结构不可确定性比较 ⇒ fail closed。 */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortValue(record[key])]))
  }
  return value
}

function validBindingKey(value: string | undefined, registration: WorkspacePageRegistration): boolean {
  if (value === undefined) return true
  const bytes = new TextEncoder().encode(value)
  return bytes.length > 0 && bytes.length <= registration.binding.maxKeyBytes && !/[\u0000-\u001f\u007f]/u.test(value)
}

/**
 * PLAT-04：Main 侧（共享宿主）观察到的页窗 bounds 的**受控结论**。
 * 它不是 renderer 命令：没有 `requestId`/`expectedRevision`/身份声明——调用方只能是持有真实窗口的 Main 组件，
 * 因此**不新增 IPC 通道、不新增 preload 方法、不扩 `.tabs.command` 字段表**。
 */
export type WorkspaceTabBoundsObservation = {
  status: 'applied' | 'ignored'
  layoutRevision: number
  workspaceInstanceKey?: string
  reason?: 'unknown-identity' | 'malformed-bounds' | 'unchanged'
}

export type WorkspaceTabStoreOptions = {
  pageRegistry: PageRegistry
  /** 测试接缝：稳定实例 ID；缺省用不含语义的随机 ID（绝不编码 binding key）。 */
  createOpaqueId?: (prefix?: string) => string
}

export function createWorkspaceTabStore(options: WorkspaceTabStoreOptions) {
  const queue = createWorkspaceCommandQueue()
  const createId = options.createOpaqueId ?? ((prefix = 'id') => opaqueId(prefix))
  // 构造期就要求注册表已 seal：未 seal 的注册不得成为 Tab 的信任来源
  options.pageRegistry.list()
  const tabs: TabRecord[] = []
  const recentlyClosed: WorkspaceTabRecentlyClosed[] = []
  const requests = new Map<string, RequestCacheEntry>()
  let revision = 0
  let activeWorkspaceInstanceKey: string | null = null

  const snapshot = (): WorkspaceTabState => Object.freeze({
    layoutRevision: revision,
    activeWorkspaceInstanceKey,
    tabs: Object.freeze(tabs.map((tab, index) => Object.freeze({
      workspaceInstanceKey: tab.workspaceInstanceKey,
      pageId: tab.pageId,
      menuKey: tab.menuKey,
      open: tab.open,
      order: index,
      mode: tab.mode,
      bindingState: tab.bindingPersistence === 'none' || tab.bindingKey !== undefined
        ? 'bound' as const : 'unavailable' as const,
      windowInstanceId: tab.windowInstanceId,
      hostEpoch: tab.hostEpoch
    }) satisfies WorkspaceTabSnapshot))
  })

  const reject = (errorCode: WorkspaceTabErrorCode, workspaceInstanceKey?: string): WorkspaceTabCommandResult =>
    ({ status: 'rejected', snapshot: snapshot(), errorCode, ...(workspaceInstanceKey === undefined ? {} : { workspaceInstanceKey }) })
  const applied = (workspaceInstanceKey?: string): WorkspaceTabCommandResult =>
    ({ status: 'applied', snapshot: snapshot(), ...(workspaceInstanceKey === undefined ? {} : { workspaceInstanceKey }) })
  const validRevision = (expected: number): boolean => Number.isSafeInteger(expected) && expected === revision
  const byKey = (workspaceInstanceKey: string): TabRecord | undefined =>
    tabs.find((tab) => tab.workspaceInstanceKey === workspaceInstanceKey)
  const isMainClaim = (input: TabMutation): boolean =>
    (input.windowInstanceId ?? MAIN_WINDOW) === MAIN_WINDOW && input.hostEpoch === MAIN_EPOCH
  const ownsTab = (input: TabMutation, tab: TabRecord): boolean =>
    input.hostEpoch === tab.hostEpoch && (input.windowInstanceId ?? MAIN_WINDOW) === tab.windowInstanceId
  /** 主窗布局管理权 + 该实例承载者自身（§4）。 */
  const managesTab = (input: TabMutation, tab: TabRecord): boolean => isMainClaim(input) || ownsTab(input, tab)
  const openCount = (): number => tabs.filter((tab) => tab.open).length

  const remember = <T>(
    input: TabMutation,
    method: string,
    onMismatch: () => T,
    operation: () => T
  ): Promise<T> => {
    const key = `${input.requestScope ?? MAIN_WINDOW}:${input.requestId}`
    let fingerprint: string
    try {
      fingerprint = `${method}|${JSON.stringify(sortValue(input))}`
    } catch {
      return Promise.resolve(onMismatch())
    }
    const previous = requests.get(key)
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) return Promise.resolve(onMismatch())
      return previous.result as Promise<T>
    }
    const current = queue.enqueue(operation)
    requests.set(key, { fingerprint, result: current })
    current.finally(() => {
      if (requests.size > WorkspaceOwnershipPolicy.requestHistoryLimit) {
        requests.delete(requests.keys().next().value as string)
      }
    }).catch(() => undefined)
    return current
  }

  const rememberClosed = (tab: TabRecord): void => {
    const next = recentlyClosed.filter((entry) => entry.workspaceInstanceKey !== tab.workspaceInstanceKey)
    next.unshift({
      workspaceInstanceKey: tab.workspaceInstanceKey, pageId: tab.pageId, menuKey: tab.menuKey, mode: tab.mode
    })
    recentlyClosed.length = 0
    recentlyClosed.push(...next.slice(0, WorkspaceTabPolicy.maxRecentlyClosed))
  }
  /** 关闭后选中同序后继；没有后继才回退到前一个仍打开的 tab；都没有则是空工作区。 */
  const selectAfterClose = (tab: TabRecord): void => {
    if (activeWorkspaceInstanceKey !== tab.workspaceInstanceKey) return
    const index = tabs.indexOf(tab)
    const next = tabs.slice(index + 1).find((entry) => entry.open)
      ?? [...tabs.slice(0, index)].reverse().find((entry) => entry.open)
    activeWorkspaceInstanceKey = next?.workspaceInstanceKey ?? null
  }

  return Object.freeze({
    openTab(input: TabMutation & { pageId: string; bindingKey?: string; newInstance?: boolean }): Promise<WorkspaceTabCommandResult> {
      return remember(input, 'openTab', () => reject('invalid-request'), () => {
        if (!validRevision(input.expectedRevision)) return reject('stale-revision')
        const registration = options.pageRegistry.get(input.pageId)
        if (registration === undefined) return reject('registration-missing')
        if (!validBindingKey(input.bindingKey, registration)
          || (registration.binding.persistence === 'none' && input.bindingKey !== undefined)) {
          return reject('invalid-request')
        }
        if (input.newInstance !== undefined && typeof input.newInstance !== 'boolean') return reject('invalid-request')
        if (input.newInstance === true && !registration.allowMultipleInstances) return reject('invalid-request')

        const existing = input.newInstance === true ? undefined : tabs.find((tab) =>
          tab.pageId === input.pageId && tab.bindingKey === input.bindingKey)
        if (existing !== undefined) {
          if (!managesTab(input, existing)) return reject('not-owner', existing.workspaceInstanceKey)
          const changed = !existing.open
          existing.open = true
          const activated = activeWorkspaceInstanceKey !== existing.workspaceInstanceKey
          activeWorkspaceInstanceKey = existing.workspaceInstanceKey
          if (changed || activated) revision += 1
          return applied(existing.workspaceInstanceKey)
        }

        // 新建：只有主窗持有本应用布局管理权（§4）
        if (!isMainClaim(input)) return reject('not-owner')
        // 单实例页面上不得因换 bindingKey 而偷偷多开实例：显式拒绝而不是扩实例
        if (registration.allowMultipleInstances === false && tabs.some((tab) => tab.pageId === input.pageId)) {
          return reject('invalid-request')
        }
        if (openCount() >= WorkspaceTabPolicy.maxOpenTabs) return reject('limit-reached')
        const workspaceInstanceKey = createId('workspace')
        tabs.push({
          workspaceInstanceKey, pageId: input.pageId, menuKey: registration.menuKey,
          bindingPersistence: registration.binding.persistence,
          ...(input.bindingKey === undefined ? {} : { bindingKey: input.bindingKey }),
          open: true, mode: 'main', windowInstanceId: MAIN_WINDOW, hostEpoch: MAIN_EPOCH
        })
        activeWorkspaceInstanceKey = workspaceInstanceKey
        revision += 1
        return applied(workspaceInstanceKey)
      })
    },

    activateTab(input: TabMutation & { workspaceInstanceKey: string }): Promise<WorkspaceTabCommandResult> {
      return remember(input, 'activateTab', () => reject('invalid-request', input.workspaceInstanceKey), () => {
        const tab = byKey(input.workspaceInstanceKey)
        if (tab === undefined) return reject('registration-missing', input.workspaceInstanceKey)
        if (!validRevision(input.expectedRevision)) return reject('stale-revision', tab.workspaceInstanceKey)
        if (!managesTab(input, tab)) return reject('not-owner', tab.workspaceInstanceKey)
        const changed = !tab.open || activeWorkspaceInstanceKey !== tab.workspaceInstanceKey
        tab.open = true
        activeWorkspaceInstanceKey = tab.workspaceInstanceKey
        if (changed) revision += 1
        return applied(tab.workspaceInstanceKey)
      })
    },

    closeTab(input: TabMutation & { workspaceInstanceKey: string }): Promise<WorkspaceTabCommandResult> {
      return remember(input, 'closeTab', () => reject('invalid-request', input.workspaceInstanceKey), () => {
        const tab = byKey(input.workspaceInstanceKey)
        if (tab === undefined) return reject('registration-missing', input.workspaceInstanceKey)
        if (!validRevision(input.expectedRevision)) return reject('stale-revision', tab.workspaceInstanceKey)
        if (!managesTab(input, tab)) return reject('not-owner', tab.workspaceInstanceKey)
        if (!tab.open) return applied(tab.workspaceInstanceKey)
        tab.open = false
        rememberClosed(tab)
        selectAfterClose(tab)
        revision += 1
        return applied(tab.workspaceInstanceKey)
      })
    },

    closeOthers(input: TabMutation & { workspaceInstanceKey: string }): Promise<WorkspaceTabCommandResult> {
      return remember(input, 'closeOthers', () => reject('invalid-request', input.workspaceInstanceKey), () => {
        const tab = byKey(input.workspaceInstanceKey)
        if (tab === undefined) return reject('registration-missing', input.workspaceInstanceKey)
        if (!validRevision(input.expectedRevision)) return reject('stale-revision', tab.workspaceInstanceKey)
        if (!managesTab(input, tab)) return reject('not-owner', tab.workspaceInstanceKey)
        let changed = false
        for (const entry of tabs) {
          if (entry === tab || !entry.open) continue
          entry.open = false
          rememberClosed(entry)
          changed = true
        }
        if (changed) {
          tab.open = true
          activeWorkspaceInstanceKey = tab.workspaceInstanceKey
          revision += 1
        }
        return applied(tab.workspaceInstanceKey)
      })
    },

    closeRight(input: TabMutation & { workspaceInstanceKey: string }): Promise<WorkspaceTabCommandResult> {
      return remember(input, 'closeRight', () => reject('invalid-request', input.workspaceInstanceKey), () => {
        const tab = byKey(input.workspaceInstanceKey)
        if (tab === undefined) return reject('registration-missing', input.workspaceInstanceKey)
        if (!validRevision(input.expectedRevision)) return reject('stale-revision', tab.workspaceInstanceKey)
        if (!managesTab(input, tab)) return reject('not-owner', tab.workspaceInstanceKey)
        const index = tabs.indexOf(tab)
        let changed = false
        for (const entry of tabs.slice(index + 1)) {
          if (!entry.open) continue
          entry.open = false
          rememberClosed(entry)
          changed = true
        }
        if (changed) {
          tab.open = true
          activeWorkspaceInstanceKey = tab.workspaceInstanceKey
          revision += 1
        }
        return applied(tab.workspaceInstanceKey)
      })
    },

    /** 重开最近关闭：原地恢复同一实例键；历史为空时 fail closed（UI 据此禁用入口）。 */
    reopenLastClosed(input: TabMutation): Promise<WorkspaceTabCommandResult> {
      return remember(input, 'reopenLastClosed', () => reject('invalid-request'), () => {
        const entry = recentlyClosed[0]
        if (entry === undefined) return reject('invalid-request')
        const tab = byKey(entry.workspaceInstanceKey)
        if (tab === undefined) {
          recentlyClosed.shift()
          return reject('registration-missing')
        }
        if (!validRevision(input.expectedRevision)) return reject('stale-revision', tab.workspaceInstanceKey)
        if (!managesTab(input, tab)) return reject('not-owner', tab.workspaceInstanceKey)
        recentlyClosed.shift()
        tab.open = true
        activeWorkspaceInstanceKey = tab.workspaceInstanceKey
        revision += 1
        return applied(tab.workspaceInstanceKey)
      })
    },

    reorderTabs(input: TabMutation & { workspaceInstanceKeys: readonly string[] }): Promise<WorkspaceTabCommandResult> {
      return remember(input, 'reorderTabs', () => reject('invalid-request'), () => {
        if (!isMainClaim(input)) return reject('not-owner')
        if (!validRevision(input.expectedRevision)) return reject('stale-revision')
        const keys = input.workspaceInstanceKeys
        if (!Array.isArray(keys) || Object.getPrototypeOf(keys) !== Array.prototype) return reject('invalid-request')
        const current = tabs.map((tab) => tab.workspaceInstanceKey)
        if (keys.length !== current.length || new Set(keys).size !== keys.length) return reject('invalid-request')
        const reordered: TabRecord[] = []
        for (const key of keys) {
          if (typeof key !== 'string') return reject('invalid-request')
          const tab = byKey(key)
          if (tab === undefined) return reject('invalid-request')
          reordered.push(tab)
        }
        const changed = current.some((key, index) => key !== keys[index])
        if (changed) {
          tabs.length = 0
          tabs.push(...reordered)
          revision += 1
        }
        return applied(activeWorkspaceInstanceKey ?? undefined)
      })
    },

    detachTab(input: TabMutation & { workspaceInstanceKey: string }): Promise<WorkspaceTabCommandResult> {
      return remember(input, 'detachTab', () => reject('invalid-request', input.workspaceInstanceKey), () => {
        const tab = byKey(input.workspaceInstanceKey)
        if (tab === undefined) return reject('registration-missing', input.workspaceInstanceKey)
        if (!validRevision(input.expectedRevision)) return reject('stale-revision', tab.workspaceInstanceKey)
        if (!managesTab(input, tab)) return reject('not-owner', tab.workspaceInstanceKey)
        if (tab.mode === 'detached') return applied(tab.workspaceInstanceKey)
        tab.mode = 'detached'
        tab.windowInstanceId = createId('window')
        tab.hostEpoch += 1
        revision += 1
        return applied(tab.workspaceInstanceKey)
      })
    },

    redockTab(input: TabMutation & { workspaceInstanceKey: string }): Promise<WorkspaceTabCommandResult> {
      return remember(input, 'redockTab', () => reject('invalid-request', input.workspaceInstanceKey), () => {
        const tab = byKey(input.workspaceInstanceKey)
        if (tab === undefined) return reject('registration-missing', input.workspaceInstanceKey)
        if (!validRevision(input.expectedRevision)) return reject('stale-revision', tab.workspaceInstanceKey)
        if (!managesTab(input, tab)) return reject('not-owner', tab.workspaceInstanceKey)
        if (tab.mode === 'main') return applied(tab.workspaceInstanceKey)
        tab.mode = 'main'
        tab.windowInstanceId = MAIN_WINDOW
        tab.hostEpoch = MAIN_EPOCH
        revision += 1
        return applied(tab.workspaceInstanceKey)
      })
    },

    /** 原地补绑定：不新增实例、不改变容器；只有承载该实例的宿主可执行（内容所有权）。 */
    bindTab(input: TabMutation & { workspaceInstanceKey: string; bindingKey: string }): Promise<WorkspaceTabCommandResult> {
      return remember(input, 'bindTab', () => reject('invalid-request', input.workspaceInstanceKey), () => {
        const tab = byKey(input.workspaceInstanceKey)
        if (tab === undefined) return reject('registration-missing', input.workspaceInstanceKey)
        if (!validRevision(input.expectedRevision)) return reject('stale-revision', tab.workspaceInstanceKey)
        const registration = options.pageRegistry.get(tab.pageId)
        if (registration === undefined || registration.binding.persistence === 'none') {
          return reject('invalid-request', tab.workspaceInstanceKey)
        }
        if (!validBindingKey(input.bindingKey, registration)) return reject('invalid-request', tab.workspaceInstanceKey)
        if (!ownsTab(input, tab)) return reject('not-owner', tab.workspaceInstanceKey)
        if (tab.bindingKey === input.bindingKey) return applied(tab.workspaceInstanceKey)
        tab.bindingKey = input.bindingKey
        revision += 1
        return applied(tab.workspaceInstanceKey)
      })
    },

    /**
     * PLAT-04：**受控 bounds 采集入口**（Main 侧权威观察，唯一调用方＝共享宿主的 bounds 端口）。
     * 身份/畸形/同值判定是纯函数 `matchDetachedBounds`（见 `workspaceTabLayoutProjection.ts`）；
     * 这里只写回受控状态并抬 revision —— 覆盖语义与 fail-closed 判据逐字不变。
     */
    _observeDetachedBounds(input: {
      windowInstanceId: string
      hostEpoch: number
      bounds: WorkspaceBounds
    }): WorkspaceTabBoundsObservation {
      const match = matchDetachedBounds({ tabs, ...input })
      if (match.status === 'ignored') {
        return {
          status: 'ignored', layoutRevision: revision,
          ...(match.tab === null ? {} : { workspaceInstanceKey: match.tab.workspaceInstanceKey }),
          reason: match.reason
        }
      }
      match.tab.detachedBounds = match.bounds
      revision += 1
      return { status: 'applied', layoutRevision: revision, workspaceInstanceKey: match.tab.workspaceInstanceKey }
    },

    /**
     * PLAT-04 只读：该实例最近一次被用户调整过的页窗 bounds（缺失即「从未调整过 / 已丢失」）。
     * `.tabs.*` 的 `detachTab` 用它把用户尺寸作为 `savedBounds` 交回共享宿主，绝不重新按策略猜尺寸。
     */
    detachedBoundsOf(workspaceInstanceKey: string): WorkspaceBounds | undefined {
      const bounds = byKey(workspaceInstanceKey)?.detachedBounds
      return bounds === undefined ? undefined : { ...bounds }
    },

    /**
     * P2-04：从 v2 文档恢复 Tab 权威状态。只有主窗（本应用布局管理权）能恢复；每次恢复都是 CAS。
     * 文档解析/剪枝/身份重生成是**纯投影**（`workspaceTabLayoutProjection.ts`，PLAT-46 抽取），
     * 这里只做授权/CAS 守卫与运行时提交；`recentlyClosed` 恢复后为空（§7）。
     */
    _restoreTabs(input: TabMutation & {
      tabs: readonly WorkspaceTabLayoutRecord[]
      activeWorkspaceInstanceKey: string | null
    }): Promise<WorkspaceTabRestoreResult> {
      return remember(input, '_restoreTabs', () => ({
        status: 'rejected' as const, snapshot: snapshot(), errorCode: 'invalid-request' as const, restoredTabs: 0, prunedTabs: 0
      }), () => {
        if (!isMainClaim(input)) {
          return { status: 'rejected' as const, snapshot: snapshot(), errorCode: 'not-owner' as const, restoredTabs: 0, prunedTabs: 0 }
        }
        if (!validRevision(input.expectedRevision)) {
          return { status: 'rejected' as const, snapshot: snapshot(), errorCode: 'stale-revision' as const, restoredTabs: 0, prunedTabs: 0 }
        }
        if (!Array.isArray(input.tabs)) {
          return { status: 'rejected' as const, snapshot: snapshot(), errorCode: 'invalid-request' as const, restoredTabs: 0, prunedTabs: 0 }
        }
        const { restored, prunedTabs } = projectRestoredTabs({
          records: input.tabs,
          pageRegistry: options.pageRegistry,
          createId,
          mainWindowInstanceId: MAIN_WINDOW,
          mainHostEpoch: MAIN_EPOCH
        })
        tabs.length = 0
        tabs.push(...restored)
        recentlyClosed.length = 0 // §7：最近关闭只在会话内存，重启后为空，不自动重开
        activeWorkspaceInstanceKey = resolveRestoredActiveKey(restored, input.activeWorkspaceInstanceKey)
        revision += 1
        return { status: 'applied' as const, snapshot: snapshot(), restoredTabs: restored.length, prunedTabs }
      })
    },

    /**
     * P2-04：v2 单写出口的 Tab 载荷（有界）。排序/截断/冻结口径在纯投影
     * `projectLayoutTabs`（PLAT-46 抽取）里；本方法只把当前受控状态喂给它。
     */
    exportLayoutTabs(): { tabs: readonly WorkspaceTabLayoutRecord[]; droppedTabs: number } {
      return projectLayoutTabs({ tabs, recentlyClosed, maxTabs: WorkspaceTabPolicy.maxOpenTabs })
    },

    getSnapshot(): WorkspaceTabState {
      return snapshot()
    },

    /** 会话内存的最近关闭（最新在前，有界）；重启后自然为空，不落盘。 */
    recentlyClosed(): readonly WorkspaceTabRecentlyClosed[] {
      return Object.freeze(recentlyClosed.map((entry) => Object.freeze({ ...entry })))
    }
  })
}

export type WorkspaceTabStore = ReturnType<typeof createWorkspaceTabStore>
