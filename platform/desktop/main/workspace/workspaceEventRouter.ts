import type {
  PanelContainerMode,
  WorkspaceEvent,
  WorkspaceEventScope,
  WorkspaceFallbackReason,
  WorkspaceSnapshot
} from '@platform/workspace/contracts'

/**
 * Owner: platform/desktop/main/workspace。权威：技术设计 §4/§5.1 与 P1-06a 门槛。
 * Main → renderer 的布局事件路由：只接受已授权订阅；内容事件必须带 workspace/panel 定向；
 * **内容事件投递 = 归属校验（windowInstanceId 与 hostEpoch 都与实时快照一致）且已授权订阅**；
 * 显式订阅只能收窄受众，不能替代归属校验（陈旧 epoch 的订阅者永远收不到）。
 * 主题/语言分工：它们继续走既有 app 级通道（settings/nativeTheme 等），workspace 事件只承载
 * workspace/panel 定向内容，`persistence-state` 是唯一允许全局（scope 为空）的类型。
 * `layoutRevision` 只来自注入的 getter（真实 runtime store 值），本模块绝不自造 revision。
 * `attachHost` 顺序固定为「退订旧 listener → 直发 current snapshot → 再续增量」；
 * 目标数按 maxTargets 有界；全部退订后回到基线（targetCount() === 0），本模块不持有 timer/listener。
 *
 * P2-10①：宿主销毁 / 登记回收 / 身份失效必须**释放**对应 target（`releaseHost`），否则 `maxTargets` 额度会被
 * 死宿主永久占满，同一会话里后续窗口只会拿到 `subscribed:false` 后静默降级为 IPC 拉取。释放带 epoch 守卫：
 * 陈旧 epoch 的释放**绝不**误删同窗口新 epoch 的在线订阅。上限语义保留（超限仍拒绝），但拒绝**可见**：
 * `capacity()` 暴露 `targets`/`available`/`rejectedCount`/`lastRejected`，绝不静默丢失。
 */

export type WorkspaceEventTarget = { windowInstanceId: string; hostEpoch: number; scope?: WorkspaceEventScope }
export type WorkspaceEventPublishInput = {
  type: WorkspaceEvent['type']
  scope?: WorkspaceEventScope
  hostEpoch?: number
  fallbackReason?: WorkspaceFallbackReason
  fallbackMode?: Exclude<PanelContainerMode, 'detached'>
  /**
   * P2-03：该事件的权威 revision。只有**持有该 revision 的权威 store** 才能提供（页面事件用 Tab runtime
   * store 的真实 revision）；缺省仍取注入的 `getLayoutRevision`（面板 store）。本模块绝不自造 revision。
   */
  layoutRevision?: number
}
/**
 * P2-03：作用域归属解析端口。页面的容器归属不存在于面板快照里（`WorkspaceSnapshot.tabs` 仍为空），
 * 因此组合根注入一个只读解析器（Tab runtime + registry 的合并视图）。返回 `undefined` 表示
 * 「本解析器不负责该作用域」，此时**回退**到既有的面板快照归属判定 —— 二者不是二选一，而是串联。
 * 解析器绝不放宽 epoch 校验：它必须返回与实时容器身份逐字一致的一对值。
 */
export type WorkspaceScopeOwnerResolver = (scope: WorkspaceEventScope) =>
  { windowInstanceId: string; hostEpoch: number } | undefined
export type WorkspaceEventPublishResult = { event: WorkspaceEvent; delivered: number }
export type WorkspaceEventAttachResult = { snapshotEvent: WorkspaceEvent; subscribed: boolean }
/** P2-10①：宿主销毁/登记回收的释放输入。`hostEpoch` 缺省 = 释放该窗口**当前登记**的身份（登记已被回收时用）。 */
export type WorkspaceEventTargetReleaseInput = { windowInstanceId: string; hostEpoch?: number }
export type WorkspaceEventTargetReleaseResult =
  | { released: true; windowInstanceId: string; hostEpoch: number }
  | { released: false; reason: 'invalid-identity' | 'unknown' | 'epoch-mismatch' }
/** P2-10①：容量自证（只读）。达到上限时的拒绝必须在这里**可见**，绝不静默丢失。 */
export type WorkspaceEventRouterCapacity = {
  maxTargets: number
  targetCount: number
  available: number
  targets: readonly string[]
  rejectedCount: number
  lastRejected: { windowInstanceId: string; reason: 'target-limit' } | null
}

type Target = { windowInstanceId: string; hostEpoch: number; scope: WorkspaceEventScope }
/**
 * 非内容事件（主题/语言/持久化状态类别）允许 scope 为空并全局广播。
 * 契约的 `WorkspaceEvent['type']` 目前只有 `persistence-state` 属于非内容类别。
 */
const GLOBAL_EVENT_TYPES: readonly WorkspaceEvent['type'][] = ['persistence-state']
const MAX_ID_LENGTH = 200

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH
}

function validEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

/** 空 scope = 全局兴趣；非法 scope（空串/错误类型）返回 null 而不是静默降级为全局。 */
function normalizeScope(scope: WorkspaceEventScope | undefined): WorkspaceEventScope | null {
  if (scope === undefined || scope === null) return {}
  if (typeof scope !== 'object' || Array.isArray(scope)) return null
  const keys = Reflect.ownKeys(scope)
  if (!keys.every((key) => key === 'workspaceInstanceKey' || key === 'panelInstanceKey')) return null
  const workspaceInstanceKey = (scope as WorkspaceEventScope).workspaceInstanceKey
  const panelInstanceKey = (scope as WorkspaceEventScope).panelInstanceKey
  if (workspaceInstanceKey !== undefined && !validId(workspaceInstanceKey)) return null
  if (panelInstanceKey !== undefined && !validId(panelInstanceKey)) return null
  return { ...(workspaceInstanceKey === undefined ? {} : { workspaceInstanceKey }), ...(panelInstanceKey === undefined ? {} : { panelInstanceKey }) }
}

export function createWorkspaceEventRouter(options: {
  getLayoutRevision: () => number
  getSnapshot: () => WorkspaceSnapshot
  send: (windowInstanceId: string, event: WorkspaceEvent) => void
  maxTargets: number
  /** P2-03：页面/其它容器的归属解析（缺失即只有面板快照归属，行为与 P2-01 逐字一致）。 */
  resolveScopeOwner?: WorkspaceScopeOwnerResolver
}) {
  const targets = new Map<string, Target>()
  /** P2-10①：上限拒绝的可见账（绝不静默丢失）。 */
  let rejectedCount = 0
  let lastRejected: WorkspaceEventRouterCapacity['lastRejected'] = null

  /**
   * 归属匹配：事件 scope 指向的实例当前确实由该宿主承载（含 hostEpoch，陈旧窗口不得命中）。
   * P2-03：先问注入的容器解析器（页面宿主）；它不负责该作用域时才回退到面板快照判定。
   */
  const ownsScope = (target: Target, scope: WorkspaceEventScope): boolean => {
    const resolved = options.resolveScopeOwner?.(scope)
    if (resolved !== undefined) {
      return resolved.windowInstanceId === target.windowInstanceId && resolved.hostEpoch === target.hostEpoch
    }
    const panels = options.getSnapshot().panels
    if (scope.panelInstanceKey !== undefined) {
      const panel = panels.find((entry) => entry.panelInstanceKey === scope.panelInstanceKey)
      if (!panel || panel.windowInstanceId !== target.windowInstanceId || panel.hostEpoch !== target.hostEpoch) return false
      return scope.workspaceInstanceKey === undefined || panel.workspaceInstanceKey === scope.workspaceInstanceKey
    }
    if (scope.workspaceInstanceKey !== undefined) {
      return panels.some((panel) => panel.workspaceInstanceKey === scope.workspaceInstanceKey
        && panel.windowInstanceId === target.windowInstanceId && panel.hostEpoch === target.hostEpoch)
    }
    return false
  }

  /** 显式订阅兴趣：同一维度（panel 对 panel、workspace 对 workspace）相等才算命中。 */
  const subscribedToScope = (target: Target, scope: WorkspaceEventScope): boolean => {
    if (target.scope.panelInstanceKey !== undefined && target.scope.panelInstanceKey === scope.panelInstanceKey) return true
    return target.scope.workspaceInstanceKey !== undefined && target.scope.workspaceInstanceKey === scope.workspaceInstanceKey
  }

  /**
   * 内容事件授权 = 归属（含 epoch）**且** 已订阅。无显式 scope 的订阅（subscribe/attachHost 建立）
   * 表示「不额外收窄」，仍必须以归属为前提；显式 scope 只在其命中的维度上放行。
   */
  const authorizedForScope = (target: Target, scope: WorkspaceEventScope): boolean => {
    if (!ownsScope(target, scope)) return false
    const narrowed = target.scope.panelInstanceKey !== undefined || target.scope.workspaceInstanceKey !== undefined
    return narrowed ? subscribedToScope(target, scope) : true
  }

  const subscribe = (input: WorkspaceEventTarget): boolean => {
    if (!validId(input?.windowInstanceId) || !validEpoch(input?.hostEpoch)) return false
    const scope = normalizeScope(input.scope)
    if (scope === null) return false
    if (!targets.has(input.windowInstanceId) && targets.size >= options.maxTargets) {
      // 上限语义保留（明确拒绝），但拒绝**可观测**：调用方与容量探测都能看到「谁被拒、为什么」
      rejectedCount += 1
      lastRejected = { windowInstanceId: input.windowInstanceId, reason: 'target-limit' }
      return false
    }
    targets.set(input.windowInstanceId, { windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch, scope })
    return true
  }

  const unsubscribe = (windowInstanceId: string): boolean => targets.delete(windowInstanceId)

  /**
   * P2-10①：宿主销毁 / 登记回收 / 身份失效时释放 target（额度归还，之后可重新订阅）。
   *  - 非法身份 ⇒ `invalid-identity`（fail closed，绝不动别人的条目）；
   *  - 未登记 ⇒ `unknown`（幂等 no-op，登记回收可能被两条路径观测到）；
   *  - 给了 `hostEpoch` 且与当前登记不一致 ⇒ `epoch-mismatch`：**陈旧身份的释放绝不误删新身份的在订**；
   *  - 未给 `hostEpoch` ⇒ 释放该窗口当前登记的身份（登记已被回收、epoch 无从取回时使用）。
   */
  const releaseHost = (input: WorkspaceEventTargetReleaseInput): WorkspaceEventTargetReleaseResult => {
    if (!validId(input?.windowInstanceId)) return { released: false, reason: 'invalid-identity' }
    if (input.hostEpoch !== undefined && !validEpoch(input.hostEpoch)) return { released: false, reason: 'invalid-identity' }
    const current = targets.get(input.windowInstanceId)
    if (current === undefined) return { released: false, reason: 'unknown' }
    if (input.hostEpoch !== undefined && current.hostEpoch !== input.hostEpoch) return { released: false, reason: 'epoch-mismatch' }
    targets.delete(current.windowInstanceId)
    return { released: true, windowInstanceId: current.windowInstanceId, hostEpoch: current.hostEpoch }
  }

  return Object.freeze({
    subscribe,

    unsubscribe,

    /** P2-10①：释放某宿主身份的订阅（宿主销毁/登记回收/身份失效的唯一出口）。 */
    releaseHost,

    /** 注入真实 revision 后按授权范围投递；返回实际投递数，便于证明「拒绝而非猜测」。 */
    publish(input: WorkspaceEventPublishInput): WorkspaceEventPublishResult {
      const scope = normalizeScope(input?.scope) ?? {}
      const event: WorkspaceEvent = Object.freeze({
        type: input.type,
        layoutRevision: input.layoutRevision ?? options.getLayoutRevision(),
        scope,
        ...(input.hostEpoch === undefined ? {} : { hostEpoch: input.hostEpoch }),
        ...(input.fallbackReason === undefined ? {} : { fallbackReason: input.fallbackReason }),
        ...(input.fallbackMode === undefined ? {} : { fallbackMode: input.fallbackMode })
      })
      const global = scope.workspaceInstanceKey === undefined && scope.panelInstanceKey === undefined
      if (global && !GLOBAL_EVENT_TYPES.includes(input.type)) return { event, delivered: 0 }
      let delivered = 0
      for (const target of targets.values()) {
        if (!global && !authorizedForScope(target, scope)) continue
        options.send(target.windowInstanceId, event)
        delivered += 1
      }
      return { event, delivered }
    },

    /** 宿主迁移：必须先退订旧 listener，再直发 current snapshot，最后才续增量。 */
    attachHost(input: WorkspaceEventTarget): WorkspaceEventAttachResult {
      unsubscribe(input?.windowInstanceId)
      const scope = normalizeScope(input?.scope) ?? {}
      const snapshotEvent: WorkspaceEvent = Object.freeze({
        type: 'snapshot', layoutRevision: options.getLayoutRevision(), scope,
        ...(input?.hostEpoch === undefined ? {} : { hostEpoch: input.hostEpoch })
      })
      if (!validId(input?.windowInstanceId)) return { snapshotEvent, subscribed: false }
      options.send(input.windowInstanceId, snapshotEvent)
      return { snapshotEvent, subscribed: subscribe(input) }
    },

    targetCount(): number {
      return targets.size
    },

    /** P2-10①：容量自证 —— 上限、占用、剩余额度、当前订阅身份、以及被拒次数/最后一个被拒身份。 */
    capacity(): WorkspaceEventRouterCapacity {
      return Object.freeze({
        maxTargets: options.maxTargets,
        targetCount: targets.size,
        available: Math.max(0, options.maxTargets - targets.size),
        targets: Object.freeze([...targets.keys()]),
        rejectedCount,
        lastRejected
      })
    },

    reset(): void {
      targets.clear()
      rejectedCount = 0
      lastRejected = null
    }
  })
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * P2-03（PM 裁决 2）：`collectLayoutEventScopes` + `APPLIED_COMMAND_EVENT_TYPES` 从
 * `composePanelWorkspace.ts`（当时 696 行）原样抽出到这里。
 *
 * 抽出理由与判据：这两者是「applied 布局命令 → 受控增量事件」的**事件语义**，与 router 同属一条链
 * （发布者只决定类型 + 定向范围，router 决定授权与投递），放在一处才不会出现第二份事件词汇表。
 * 行为逐字未改：动词表只使用既有 `WorkspaceEvent['type']` 词汇（`workspaceClient.EVENT_TYPES`
 * 白名单契约未扩），范围推导判据仍全部来自真实 store 的前后快照 + 命令结果。
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * applied 布局命令 → 增量事件类型。只使用**既有**词汇：renderer 的 `workspaceClient.EVENT_TYPES`
 * 白名单是已验收契约（不扩词汇），且每一种都表示同一件事「revision 已推进，请回 Main 重取权威快照」。
 */
export const APPLIED_COMMAND_EVENT_TYPES: Readonly<Record<string, WorkspaceEvent['type']>> = Object.freeze({
  openWorkspace: 'open',
  openPanel: 'open',
  closePanel: 'close',
  reopenPanel: 'restore',
  activatePanel: 'container-changed',
  switchContainer: 'container-changed',
  resizePanel: 'container-changed',
  resetPanelSize: 'container-changed',
  _restoreLayout: 'restore'
})

const PANEL_COMPARE_KEYS = [
  'panelId', 'open', 'mode', 'presentation', 'bindingState', 'windowInstanceId', 'hostEpoch', 'lastValidDock'
] as const
const DOCK_REGIONS = ['embedded', 'docked-right', 'docked-bottom'] as const

function sameSize(left: WorkspaceSnapshot['panels'][number]['dockSize'], right: WorkspaceSnapshot['panels'][number]['dockSize']): boolean {
  return left?.width === right?.width && left?.height === right?.height
}
function sameBounds(left: WorkspaceSnapshot['panels'][number]['detachedBounds'], right: WorkspaceSnapshot['panels'][number]['detachedBounds']): boolean {
  return left?.x === right?.x && left?.y === right?.y && left?.width === right?.width && left?.height === right?.height
}
function samePanel(left: WorkspaceSnapshot['panels'][number], right: WorkspaceSnapshot['panels'][number]): boolean {
  if (PANEL_COMPARE_KEYS.some((key) => left[key] !== right[key])) return false
  return sameSize(left.dockSize, right.dockSize) && sameBounds(left.detachedBounds, right.detachedBounds)
    && left.transfer?.operationId === right.transfer?.operationId && left.transfer?.phase === right.transfer?.phase
}

/**
 * 受影响范围推导（纯函数）。判据全部来自真实 store 的前后快照 + 命令结果：
 *  - 真正的变化：面板记录变化、区域 `activePanels` 归属变化、页面顺序变化、工作区新增；
 *  - 命令目标：只按结果里的实例键在**新快照**中解析（绝不信任 renderer payload 里的身份字符串）；
 *  - 合并：同一个工作区在一次命令内最多产出一条事件；只有恰好一个面板受影响时才做面板级定向
 *    （多面板 ⇒ 工作区级），因此不会出现「每条命令 × 每个面板」的事件风暴。
 */
export function collectLayoutEventScopes(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  target: { panelInstanceKey?: string; workspaceInstanceKey?: string }
): readonly WorkspaceEventScope[] {
  const beforePanels = new Map(before.panels.map((panel) => [panel.panelInstanceKey, panel]))
  const panels = new Map(after.panels.map((panel) => [panel.panelInstanceKey, panel]))
  const affected = new Set<string>()
  for (const panel of after.panels) {
    const previous = beforePanels.get(panel.panelInstanceKey)
    if (previous === undefined || !samePanel(previous, panel)) affected.add(panel.panelInstanceKey)
  }

  const beforeLayouts = new Map(before.pageLayouts.map((layout) => [layout.workspaceInstanceKey, layout]))
  const workspaces = new Set<string>()
  for (const layout of after.pageLayouts) {
    const previous = beforeLayouts.get(layout.workspaceInstanceKey)
    if (previous === undefined || previous.panelOrder.join('|') !== layout.panelOrder.join('|')) {
      workspaces.add(layout.workspaceInstanceKey)
    }
    for (const region of DOCK_REGIONS) {
      const nextActive = layout.activePanels[region]
      const previousActive = previous?.activePanels[region]
      if (nextActive === previousActive) continue
      workspaces.add(layout.workspaceInstanceKey)
      if (previousActive !== undefined) affected.add(previousActive)
      if (nextActive !== undefined) affected.add(nextActive)
    }
  }

  if (target.panelInstanceKey !== undefined) {
    const panel = panels.get(target.panelInstanceKey)
    if (panel !== undefined) {
      affected.add(panel.panelInstanceKey)
      workspaces.add(panel.workspaceInstanceKey)
    }
  }
  if (target.workspaceInstanceKey !== undefined && after.pageLayouts.some(
    (layout) => layout.workspaceInstanceKey === target.workspaceInstanceKey
  )) {
    workspaces.add(target.workspaceInstanceKey)
  }

  const affectedByWorkspace = new Map<string, string[]>()
  for (const panelInstanceKey of affected) {
    const panel = panels.get(panelInstanceKey)
    if (panel === undefined) continue
    const list = affectedByWorkspace.get(panel.workspaceInstanceKey) ?? []
    list.push(panel.panelInstanceKey)
    affectedByWorkspace.set(panel.workspaceInstanceKey, list)
  }

  const scopes: WorkspaceEventScope[] = []
  for (const workspaceInstanceKey of new Set([...workspaces, ...affectedByWorkspace.keys()])) {
    const keys = affectedByWorkspace.get(workspaceInstanceKey) ?? []
    scopes.push(keys.length === 1
      ? { workspaceInstanceKey, panelInstanceKey: keys[0] as string }
      : { workspaceInstanceKey })
  }
  return Object.freeze(scopes)
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * P2-03：布局事件的**生产端**（从 `composePanelWorkspace.ts` 抽出，使 compose 回到「只做接线」）。
 *
 * 抽出后本模块完整拥有「applied 布局命令 / 宿主事件 → 受控事件 → 归属判定 → 定点投递」这一条链：
 *  - 事件类型与定向范围（`APPLIED_COMMAND_EVENT_TYPES`、`collectLayoutEventScopes`）；
 *  - 命令包装（捕获前快照 → 执行 → applied 后按**命令结果**的实例键定向）；
 *  - 宿主事件投递（受众 = 该面板当前承载者 + 事件自身窗口；承载者已销毁时退到存活主窗，绝不静默丢弃）。
 * `layoutRevision` 一律来自注入的真实 getter，绝不自造。
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

export type AppliedLayoutCommandInput = {
  method: string
  before: WorkspaceSnapshot
  result: { status: string; panelInstanceKey?: string; workspaceInstanceKey?: string }
  /** renderer payload（不可信）只作为「目标由 store 分配」时的查找线索，最终定向仍按新快照解析。 */
  payload?: unknown
}

/**
 * applied 布局命令发布者。事件是**尽力而为的通知**：发布异常绝不改变已提交的命令结论
 * （调用方拿到的仍是 store 的 `WorkspaceCommandResult`）。
 */
export function createAppliedLayoutCommandPublisher(options: {
  publish: (input: WorkspaceEventPublishInput) => unknown
  getSnapshot: () => WorkspaceSnapshot
}) {
  const fieldsOf = (payload: unknown): { method?: unknown; panelInstanceKey?: unknown; workspaceInstanceKey?: unknown } =>
    (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>

  return Object.freeze({
    /** 从不可信 payload 读方法名；白名单外的动词不会产生事件。 */
    methodOf(payload: unknown): string {
      const method = fieldsOf(payload).method
      return typeof method === 'string' ? method : ''
    },

    publishApplied(input: AppliedLayoutCommandInput): void {
      if (input.result.status !== 'applied') return
      const type = APPLIED_COMMAND_EVENT_TYPES[input.method]
      if (type === undefined) return
      try {
        const fields = fieldsOf(input.payload)
        // 实例键优先取**命令结果**（真实 store 返回）；payload 只补 openWorkspace/openPanel 这类目标由 store 分配的命令
        const panelInstanceKey = input.result.panelInstanceKey
          ?? (typeof fields.panelInstanceKey === 'string' ? fields.panelInstanceKey : undefined)
        const workspaceInstanceKey = input.result.workspaceInstanceKey
          ?? (typeof fields.workspaceInstanceKey === 'string' ? fields.workspaceInstanceKey : undefined)
        const scopes = collectLayoutEventScopes(input.before, options.getSnapshot(), {
          ...(panelInstanceKey === undefined ? {} : { panelInstanceKey }),
          ...(workspaceInstanceKey === undefined ? {} : { workspaceInstanceKey })
        })
        for (const scope of scopes) options.publish({ type, scope })
      } catch { /* 通知失败不影响已提交的布局结论 */ }
    }
  })
}

/**
 * 宿主事件（P1-04 的 container-changing／fallback／host-detach／container-changed）的定向投递：
 * 受众 = 该面板**当前承载者**（还没提交时是源、提交后是目标）+ 事件自身的窗口（同一时只投一次）。
 * 承载者已被外部销毁 ⇒ 退到仍存活的主窗（布局权威 + 面板下一次的归宿），绝不静默丢弃。
 */
export function createDetachedHostEventPublisher(options: {
  registry: {
    describeWindow: (windowInstanceId: string) => { windowInstanceId: string; webContentsId: number | null } | undefined
    listWindows: () => readonly { kind: string; windowInstanceId: string; webContentsId: number | null }[]
  }
  getSnapshot: () => WorkspaceSnapshot
  sendToHost: (webContentsId: number, event: WorkspaceEvent) => boolean
  /** 布局管理权哨兵（主窗在 store 里的身份）；缺省用平台策略值。 */
  mainWindowInstanceId?: string
}): (event: { type: WorkspaceEvent['type']; panelInstanceKey: string; windowInstanceId: string | null; fallbackReason?: WorkspaceFallbackReason; fallbackMode?: Exclude<PanelContainerMode, 'detached'> }) => boolean {
  const mainInstanceId = options.mainWindowInstanceId ?? 'main'
  const findMain = () => options.registry.listWindows().find((entry) => entry.kind === 'main')

  const send = (
    record: { windowInstanceId: string; webContentsId: number | null } | undefined,
    event: { type: WorkspaceEvent['type']; panelInstanceKey: string; fallbackReason?: WorkspaceFallbackReason; fallbackMode?: Exclude<PanelContainerMode, 'detached'> },
    panelInstanceKey: string
  ): boolean => {
    if (!record || record.webContentsId === null) return false
    const snapshot = options.getSnapshot()
    const panel = snapshot.panels.find((entry) => entry.panelInstanceKey === panelInstanceKey)
    const outgoing: WorkspaceEvent = {
      type: event.type,
      layoutRevision: snapshot.layoutRevision,
      scope: {
        ...(panel === undefined ? {} : { workspaceInstanceKey: panel.workspaceInstanceKey }),
        panelInstanceKey
      },
      ...(event.fallbackReason === undefined ? {} : { fallbackReason: event.fallbackReason }),
      ...(event.fallbackMode === undefined ? {} : { fallbackMode: event.fallbackMode })
    }
    return options.sendToHost(record.webContentsId, outgoing)
  }

  return (event): boolean => {
    const panel = options.getSnapshot().panels.find((entry) => entry.panelInstanceKey === event.panelInstanceKey)
    const ownerWindowInstanceId = panel?.windowInstanceId ?? null
    const owner = ownerWindowInstanceId === null
      ? undefined
      : ownerWindowInstanceId === mainInstanceId ? findMain() : options.registry.describeWindow(ownerWindowInstanceId)
    const eventWindow = event.windowInstanceId === null ? undefined : options.registry.describeWindow(event.windowInstanceId)
    const ownerSent = send(owner, event, event.panelInstanceKey)
    const sameWindow = eventWindow !== undefined && eventWindow.windowInstanceId === owner?.windowInstanceId
    const windowSent = sameWindow ? false : send(eventWindow, event, event.panelInstanceKey)
    if (ownerSent || windowSent) return true
    return send(findMain(), event, event.panelInstanceKey)
  }
}
