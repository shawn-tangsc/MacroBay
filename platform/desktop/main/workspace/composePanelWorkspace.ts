import type { IpcMain } from 'electron'

import type { ProductManifest } from '@platform/product-manifest'
import { createPanelLayoutStore } from '@platform/workspace/persistence/panelLayoutStore'
import { createPanelRegistry, toProductPanelRegistration } from '@platform/workspace/registry/panelRegistry'
import { builtInWorkspacePageModuleIds } from '@platform/workspace/registry/builtInWorkspacePages'
import { createPanelWorkspaceStore } from '@platform/workspace/runtime/panelWorkspaceStore'
import { createWorkspaceTabStore } from '@platform/workspace/runtime/workspaceTabStore'
import { WorkspaceOwnershipPolicy, WorkspaceTransferPolicy } from '@platform/workspace/policies'
import type { WorkspaceEvent } from '@platform/workspace/contracts'
import {
  createWorkspaceLayoutRestore,
  type WorkspaceDetachedDowngrade,
  type WorkspaceLayoutRestoreSummary
} from './restoreWorkspaceLayout'
import type { createPanelDetachedWindowHost, DetachedHostEvent } from './panelDetachedWindowHost'
import {
  createAppliedLayoutCommandPublisher,
  createDetachedHostEventPublisher,
  createWorkspaceEventRouter
} from './workspaceEventRouter'
import { createWorkspacePreferenceFollow } from './workspacePreferenceChangePublisher'
import { createWorkspaceChainBridge } from './workspaceChainBridge'
import { createWorkspaceLayoutPersistencePort } from './workspaceLayoutPersistencePort'
import { disabledComposition } from './workspaceDisabledComposition'
import { createWorkspaceHostSubscriptionLedger } from './workspaceHostSubscriptionLedger'
import { createComposedPageRegistry } from './workspacePageRegistryComposition'
import { toStoreHostIdentity } from './panelWorkspaceScopeProjection'
import {
  createPanelWorkspaceIpcHandlers, registerPanelWorkspaceIpcChannels, type PanelWorkspaceIpcDependencies
} from './panelWorkspaceIpcHandlers'
import { createPanelWorkspaceTransferOrchestrator } from './panelWorkspaceTransferOrchestrator'
import { createTransferPreparePort, type TransferPrepareOutcome } from './workspaceTransferPreparePort'
import { createTabDetachedWindowHost, type TabDetachedWindowHost } from './tabDetachedWindowHost'
import { createTabWorkspaceIpcHandlers, type TabWorkspaceIpcHandlers } from './tabWorkspaceIpcHandlers'
import { createWorkspaceWindowRegistry, type WorkspaceWindowRecord, type WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。权威：技术设计 §4/§5/§7 与 P1-06a 门槛。
 * 把 registry、持久化 + runtime store、窗口 registry/宿主端口、IPC handlers 与事件路由组装成一个可被
 * app.ts 在「产品注册 seal 之后」调用的单一入口，不 import 产品代码。
 *
 * P2-03 之后本文件**只做接线**：布局事件语义在 `workspaceEventRouter.ts`（偏好 producer 在
 * `workspacePreferenceChangePublisher.ts`，宿主订阅记账在 `workspaceHostSubscriptionLedger.ts`），
 * 转移身份缝合在 `panelWorkspaceTransferOrchestrator.ts`，页面窗生命周期在 `tabDetachedWindowHost.ts`，
 * `.tabs.*` 准入/投影在 `tabWorkspaceIpcHandlers.ts`。compose 不重复实现其中任何一条。
 *
 * 两条 P1-05 门槛：恢复出的 `mode:'detached'` 面板不在启动时物化窗口（没有源宿主可 ACK），按
 * `lastValidDock → docked-right → docked-bottom → embedded` 降级并记 `restore-invalid`；
 * 快照 `persistenceState` 由 `panelLayoutStore.persistenceState()` 覆盖 store 硬编码的 `'saved'`。
 */

export type { WorkspaceDetachedDowngrade } from './restoreWorkspaceLayout'
export type WorkspaceStartReport = {
  status: 'ready' | 'disabled'
  reason?: 'no-pages'
  restore: 'restored' | 'empty' | 'protected' | 'stale' | 'disabled'
  restoredPanels: number
  downgradedDetached: readonly WorkspaceDetachedDowngrade[]
  /** 单个产品贡献非法时只跳过该面板并计数，不因一个坏贡献关掉整个工作区能力。 */
  registrationFailures: number
  mayOverwrite: boolean
  /** P2-04：恢复过程中的 Tab/剪裁/转换计数（可选，只为兼容禁用态最小形状）。 */
} & WorkspaceLayoutRestoreSummary
/**
 * P1-06m：退出 flush / 退出的**受控报告**（纯数据）。P2-03 起由编排器模块定义并在此 re-export，
 * 以保持既有导入点（`panelWorkspaceStartupReport.ts` 等）不变：
 * `hadPendingWrites` 是「flush 没跑」与「flush 跑输」的唯一判据；可选字段只为兼容禁用态最小形状。
 */
import {
  createWorkspaceLayoutLifecycle,
  type WorkspaceDisposeReport,
  type WorkspaceLayoutFlushReport
} from './workspaceLayoutLifecycle'
export type { WorkspaceLayoutFlushReport, WorkspaceDisposeReport } from './workspaceLayoutLifecycle'

export type PanelWorkspaceComposeOptions = {
  productManifests: readonly ProductManifest[]
  /** 受保护 seam：只用到 `handle`；类型取自 Electron，runtime 无 electron 依赖。 */
  ipcMain: Pick<IpcMain, 'handle'>
  layoutFilePath: string
  sendToHost: (webContentsId: number, event: WorkspaceEvent) => boolean
  preferences: PanelWorkspaceIpcDependencies['preferences']
  /** 测试接缝：注入已构造的 store / registry（后者必须是 P1-04 宿主用的**同一实例**）。 */
  panelLayoutStore?: ReturnType<typeof createPanelLayoutStore>
  windowRegistry?: WorkspaceWindowRegistry
  /**
   * P1-04 宿主端口。传入**完整宿主**（含 `requestDetach`）时启用真实 detach 编排（handlers 拿到编排后的
   * 端口）；只传 ACK 端口子集（测试接缝）时保持原准入语义，`detachPanel`/`source-prepared` fail closed。
   */
  detachedHost?: PanelWorkspaceIpcDependencies['detachedHost']
  /** 编排器截止时间端口（测试接缝，缺省 setTimeout）。 */
  transferTimers?: { schedule: (delayMs: number, run: () => void) => () => void }
  /** 测试接缝：runtime store 的时钟（缺省 Date.now），用于确定性验证相位截止时间。 */
  storeNow?: () => number
  /** 测试接缝：布局文档 `savedAt` 的来源（缺省真实时钟）。 */
  savedAtNow?: () => string
  maxTargets?: number
  /** 退出 flush 的有界上界；默认复用平台释放上界。 */
  disposeTimeoutMs?: number
}

export function composePanelWorkspace(options: PanelWorkspaceComposeOptions) {
  const windowRegistry = options.windowRegistry ?? createWorkspaceWindowRegistry()
  const registrations: Array<{ registration: ReturnType<typeof toProductPanelRegistration> }> = []
  const pageIds: string[] = []
  let registrationFailures = 0
  for (const manifest of options.productManifests) {
    for (const page of manifest.shellContributions?.menuPages ?? []) pageIds.push(`${manifest.id}.${page.id}`)
    for (const panel of manifest.shellContributions?.panels ?? []) {
      try {
        registrations.push({ registration: toProductPanelRegistration(manifest.id, panel) })
      } catch {
        registrationFailures += 1
      }
    }
  }
  const uniquePageIds = Object.freeze([...new Set(pageIds)])
  const panelRegistry = createPanelRegistry({ pageIds: uniquePageIds, moduleIds: registrations.map((entry) => entry.registration.module) })
  for (const entry of registrations) {
    try { panelRegistry.register(entry.registration) } catch { registrationFailures += 1 }
  }

  // 没有任何可用页面时不做半吊子接线：不建 store、不注册通道，IPC 保持 fail closed。
  if (uniquePageIds.length === 0) return disabledComposition(uniquePageIds, windowRegistry, registrationFailures)

  panelRegistry.seal()
  const runtimeStore = createPanelWorkspaceStore({
    panelRegistry, pageIds: uniquePageIds, ...(options.storeNow === undefined ? {} : { now: options.storeNow })
  })
  const layoutStore = options.panelLayoutStore ?? createPanelLayoutStore({ filePath: options.layoutFilePath })

  /** 事务身份贯通（P1-06c）：实现见 `workspaceTransferPreparePort.createTransferPreparePort`。 */
  const beginTransferToReservedHost = createTransferPreparePort({ runtimeStore, windowRegistry })

  /** P1-06d 宿主事件按面板定向投递（实现见 `workspaceEventRouter.createDetachedHostEventPublisher`）。 */
  const publishHostEventBase = createDetachedHostEventPublisher({
    registry: windowRegistry, getSnapshot: () => runtimeStore.getSnapshot(), sendToHost: options.sendToHost
  })

  // 完整宿主 ⇒ 启用编排；只有 ACK 端口子集 ⇒ 保持 P1-06a/c 的准入语义（fail closed）
  const fullDetachedHost = typeof (options.detachedHost as { requestDetach?: unknown } | undefined)?.requestDetach === 'function'
    ? options.detachedHost as unknown as ReturnType<typeof createPanelDetachedWindowHost>
    : null

  // ── P2-03：页面 Tab 的注册表 / runtime store / 共享宿主适配 / `.tabs.*` 准入 ──
  const pageRegistry = createComposedPageRegistry(options.productManifests, uniquePageIds)
  const tabStore = createWorkspaceTabStore({ pageRegistry })
  const tabHost: TabDetachedWindowHost | null = fullDetachedHost === null
    ? null : createTabDetachedWindowHost({ host: fullDetachedHost, registry: windowRegistry })

  const transferOrchestrator = fullDetachedHost === null ? null : createPanelWorkspaceTransferOrchestrator({
    host: fullDetachedHost, runtimeStore, windowRegistry, panelRegistry, beginTransferToReservedHost,
    resolveTitle: async (registration) => {
      const language = await options.preferences.getLanguage()
      return language.startsWith('zh') ? registration.title['zh-CN'] : registration.title['en-US']
    },
    publishHostEvent: (event) => publishHostEvent(event),
    ...(options.transferTimers === undefined ? {} : { timers: options.transferTimers })
  })

  /**
   * P2-04 单写出口：实现已抽到 `workspaceLayoutPersistencePort.ts`（PLAT-35 组按 PLAT-30 行数纪律抽取，
   * 语义逐字不变）；本层只接线。
   */
  const persistencePort = createWorkspaceLayoutPersistencePort({ layoutStore, tabStore, panelRegistry })

  let started: WorkspaceStartReport | null = null
  /** PLAT-26：受控通道只注册一次（幂等）；注册与恢复拆成两个入口，注册可早于建窗。 */
  let channelsRegistered = false
  /** 布局落盘生命周期（flush/退出/收敛）在编排器模块里，本层只接线。 */
  const layoutLifecycle = createWorkspaceLayoutLifecycle({
    layoutStore: persistencePort,
    runtimeStore,
    fullDetachedHost,
    orchestrator: transferOrchestrator,
    windowRegistry,
    savedAtNow: options.savedAtNow ?? ((): string => new Date().toISOString()),
    disposeTimeoutMs: options.disposeTimeoutMs ?? WorkspaceTransferPolicy.releaseTimeoutMs,
    resetRouter: () => router.reset()
  })
  const scheduleLayoutSave = layoutLifecycle.scheduleLayoutSave
  const convergeClosedPanelWindows = layoutLifecycle.convergeClosedPanelWindows

  /**
   * **PLAT-04 单点接线**：宿主交付**已合并**的页窗 bounds → `tabStore._observeDetachedBounds`（按
   * 「正 detached + 身份 + epoch」fail closed，同值不抬 revision）→ 命中即复用面板链同一入口落盘。
   * 不新增通道/preload 方法、不需要 `app.ts` 额外接线；面板窗的 bounds 事件到达时 Tab store 只认页窗身份。
   */
  const detachedBoundsSubscription = fullDetachedHost === null ? null : fullDetachedHost.subscribeDetachedWindowBounds((event) => {
    if (tabStore._observeDetachedBounds(event).status !== 'applied') return
    scheduleLayoutSave()
  })
  /** 退出/显式 flush 前先把宿主合并窗口里的 pending bounds 交出来（绝不丢在 shutdown barrier 之后）。 */
  const flushDetachedBounds = (): void => {
    try { fullDetachedHost?.flushPendingDetachedWindowBounds() } catch { /* 端口失败绝不阻断退出 */ }
  }

  /**
   * PLAT-30（并入项 1/2）：**宿主订阅记账的唯一出口**。面板宿主与页窗宿主共用这一个状态机（挂载幂等、
   * 降级可见、真实释放信用、epoch 守卫、回收当刻结算），因此三类订阅者的记账与释放不可分叉；
   * `attach`/`release` 端口都必填 ⇒ 漏注在构造期 fail closed。
   * 函数声明会提升、端口只在受控读取时被调用 ⇒ 此处引用尚未初始化的 `router` 不构成 TDZ 问题。
   */
  const hostSubscriptions = createWorkspaceHostSubscriptionLedger({
    windowRegistry,
    attach: (record) => record.webContentsId !== null && attachHostWindow({ webContentsId: record.webContentsId }).subscribed,
    release: (input) => { router.releaseHost(input) }
  })

  /**
   * **PLAT-35 组两链桥接单点**（实现与判据在 `workspaceChainBridge.ts`）：page→workspace 解析、Tab→面板
   * 采纳、页窗建窗标题（PLAT-41）、准备期定向受众（PLAT-31）。本层只接线，不复制任何判据。
   */
  const chainBridge = createWorkspaceChainBridge({
    tabStore, windowRegistry, runtimeStore,
    preferences: options.preferences,
    onAdopted: () => { scheduleLayoutSave() }
  })

  const rawHandlers = createPanelWorkspaceIpcHandlers({
    panelRegistry, pageIds: uniquePageIds, runtimeStore, windowRegistry,
    preferences: options.preferences,
    detachedHost: transferOrchestrator === null ? options.detachedHost : transferOrchestrator.hostPort,
    ...(transferOrchestrator === null ? {} : { transfers: transferOrchestrator.driver }),
    // PLAT-35：该页已有打开的 Tab ⇒ openWorkspace 采纳 Tab 链的键（无 Tab ⇒ 保持自造新键）
    resolvePageWorkspaceKey: chainBridge.resolvePageWorkspaceKey,
    readPersistenceState: () => layoutStore.persistenceState(),
    onApplied: () => { scheduleLayoutSave(); convergeClosedPanelWindows() },
    // PLAT-30：面板宿主窗的受控订阅交给共享记账（挂载仍复用同一 `attachHostWindow`，语义逐字不变）
    attachSubscription: hostSubscriptions.attachFor('detached-panel')
  })

  /**
   * P2-01/P2-03 事件路由：面板归属来自权威快照；**页面**归属由只读解析器给出（页面容器身份在
   * Tab runtime + registry 里）。解析器只回答「谁承载这个工作区实例」，绝不放宽 epoch 校验。
   */
  const router = createWorkspaceEventRouter({
    getLayoutRevision: () => runtimeStore.getSnapshot().layoutRevision,
    getSnapshot: () => runtimeStore.getSnapshot(),
    send: (windowInstanceId, event) => {
      const record = windowInstanceId === WorkspaceOwnershipPolicy.initialWindowInstanceId
        ? windowRegistry.listWindows().find((entry) => entry.kind === 'main')
        : windowRegistry.describeWindow(windowInstanceId)
      if (!record || record.webContentsId === null) return
      options.sendToHost(record.webContentsId, event)
    },
    resolveScopeOwner: (scope) => {
      // 面板作用域或带 panelInstanceKey 的作用域交给既有面板判定（回退，不是二选一）
      if (scope.panelInstanceKey !== undefined || scope.workspaceInstanceKey === undefined) return undefined
      const tab = tabStore.getSnapshot().tabs.find((entry) => entry.workspaceInstanceKey === scope.workspaceInstanceKey)
      if (tab === undefined) return undefined
      const record = windowRegistry.listDetachedTabs().find((entry) => entry.workspaceInstanceKey === scope.workspaceInstanceKey)
      // 容器漂移以 registry 为权威：登记已回收 ⇒ 归属回到主窗（store 的 mode 由 reconcile 收敛）
      if (record === undefined) {
        return { windowInstanceId: WorkspaceOwnershipPolicy.initialWindowInstanceId, hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch }
      }
      return { windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch }
    },
    // 目标预算：主窗 + P1-04 的 detached 宿主上限，不新增魔法常量
    maxTargets: options.maxTargets ?? WorkspaceTransferPolicy.maxDetachedHosts + 1
  })

  /**
   * P2-03：**页面/面板宿主真正接上 router 订阅**的单一挂载点（顺序复用 `router.attachHost`：
   * 退订旧 listener → 直发 current snapshot → 再续增量）；未登记身份一律 fail closed。
   */
  function attachHostWindow(input: { webContentsId: number }): { attached: boolean; subscribed: boolean } {
    const record = windowRegistry.resolveWebContents(input.webContentsId)
    if (!record) return { attached: false, subscribed: false }
    const host = toStoreHostIdentity(record)
    const attached = router.attachHost({ windowInstanceId: host.windowInstanceId, hostEpoch: host.hostEpoch })
    return { attached: true, subscribed: attached.subscribed }
  }

  const tabHandlers: TabWorkspaceIpcHandlers | null = tabHost === null ? null : createTabWorkspaceIpcHandlers({
    pageRegistry,
    tabStore,
    windowRegistry,
    host: tabHost,
    // PLAT-35：openTab applied 后采纳同键面板 workspace（幂等；落盘调度由 chainBridge 统一）
    adoptPanelWorkspace: chainBridge.adoptPanelWorkspace,
    // PLAT-41：页窗建窗标题按当前宿主语言解析（与主窗 Tab 标签同源）
    resolveTitle: chainBridge.resolvePageTitle,
    attach: (record) => {
      if (record.webContentsId === null) return false
      return attachHostWindow({ webContentsId: record.webContentsId }).subscribed
    },
    // P2-10①/PLAT-30①：页窗宿主的挂载/释放走**同一个**共享记账出口（额度归还、降级重试、epoch 守卫、
    // 回收当刻结算都在那一处，面板宿主与页窗宿主不可分叉）
    hostSubscriptionLedger: hostSubscriptions,
    release: ({ windowInstanceId, hostEpoch }) => { router.releaseHost({ windowInstanceId, hostEpoch }) },
    publish: (input) => {
      // Tab 事件用 **Tab runtime store 的真实 revision**，绝不用面板 store 的 revision 冒充
      router.publish({ type: input.type, scope: input.scope, layoutRevision: input.layoutRevision })
    }
  })

  /** 宿主事件：先按面板语义投递，再收敛页面容器漂移（失败路径绝不留「store 说 detached、却没有窗口」）。 */
  function publishHostEvent(event: DetachedHostEvent): boolean {
    const delivered = publishHostEventBase(event)
    if (event.type === 'fallback' || event.type === 'host-detach') void reconcileTabContainers()
    return delivered
  }
  async function reconcileTabContainers(): Promise<readonly string[]> {
    const reconciled = await tabHandlers?.reconcileContainerDrift() ?? Object.freeze([])
    return reconciled
  }

  // P2-03（PM 追加的抽取）：命令包装/事件发布语义在 `workspaceEventRouter.createAppliedLayoutCommandPublisher`
  const layoutEvents = createAppliedLayoutCommandPublisher({
    publish: (input) => { router.publish(input) },
    getSnapshot: () => runtimeStore.getSnapshot()
  })

  // PLAT-32/S1：偏好跟随只接线（对账/受众/有界性/基线/队列都在 `createWorkspacePreferenceFollow`）；
  // 受控读取不再带副作用，唯一的对账点是显式通知（`app.ts` 的 `settingsUpdate` 调用一行）。
  // PLAT-31：准备期（in-flight transfer 目标、面板尚未归属该窗）**另走**一条按 registry 定向的投递口 ——
  // 它不经过 `router.publish` 的归属判定，因此主窗仍 0 条；投递只读快照，绝不推进 P1 相位。
  const preferenceFollow = createWorkspacePreferenceFollow({
    preferences: options.preferences, windowRegistry, runtimeStore, tabStore,
    publish: (input) => { router.publish(input) },
    listPendingPanelWindows: chainBridge.listPendingPanelWindows,
    sendDirected: (webContentsId, event) => { options.sendToHost(webContentsId, event) }
  })

  /** PLAT-26：**只注册 handler、不恢复布局**（幂等，可早于建窗）；`start()` 仍先注册再恢复，语义不变。 */
  function registerChannels(): void {
    if (channelsRegistered) return
    channelsRegistered = true
    registerPanelWorkspaceIpcChannels({ ipcMain: options.ipcMain, handlers, tabHandlers })
    void preferenceFollow.ensureBaseline() // 通道一挂上，偏好基线就绪（建窗之前就位 ⇒ 首次真实切换恰一次转发）
  }

  const handlers = Object.freeze({
    ...rawHandlers,
    async command(event: Parameters<typeof rawHandlers.command>[0], payload?: unknown): Promise<Awaited<ReturnType<typeof rawHandlers.command>>> {
      const before = runtimeStore.getSnapshot()
      const result = await rawHandlers.command(event, payload)
      layoutEvents.publishApplied({ method: layoutEvents.methodOf(payload), before, result, payload })
      return result
    }
  })

  return Object.freeze({
    status: 'ready' as const,
    channels: handlers.channels,
    panelRegistry,
    pageRegistry,
    pageIds: uniquePageIds,
    runtimeStore,
    tabStore,
    layoutStore,
    windowRegistry,
    router,
    handlers,
    tabHandlers,
    tabHost,

    registerMainWindow(input: { webContentsId: number; hostEpoch?: number }): WorkspaceWindowRecord {
      return windowRegistry.registerMainWindow(input)
    },

    /** 宿主挂载：退订旧 listener → 直发 current snapshot → 续增量（全部由 router 保证顺序）。 */
    attachMainWindow(input: { webContentsId: number }): { attached: boolean; subscribed: boolean } {
      const record = windowRegistry.resolveWebContents(input.webContentsId)
      if (!record || record.kind !== 'main') return { attached: false, subscribed: false }
      return attachHostWindow(input)
    },

    /** P2-03：任何**已登记**宿主（主窗/独立面板窗/独立页窗）都可挂载受控订阅；未登记一律拒绝。 */
    attachHostWindow,

    /** 事务身份贯通（P1-06c）。实现见 `workspaceTransferPreparePort`：不驱动 ACK/commit。 */
    beginTransferToReservedHost,

    /** P1-06d 编排器（只有注入完整 P1-04 宿主时存在）；未接线时为 null。 */
    transferOrchestrator,

    /** 宿主端口（P1-04）→ renderer 的单向事件投递 + 页面容器漂移收敛。app.ts 把它接到宿主的 `onEvent`。 */
    publishHostEvent,

    /** P2-03：页面容器漂移的显式收敛入口（宿主事件之外，退出/诊断也可调用）。 */
    reconcileTabContainers,

    /**
     * P1-06d app 侧桥：宿主（P1-04）事件、原生关闭、窗口外部销毁都要回到编排/布局权威。
     * 未接线（没有完整宿主）时为 null，app.ts 据此不做任何投递。
     */
    mainHostBridge: transferOrchestrator === null || fullDetachedHost === null ? null : Object.freeze({
      publishHostEvent,
      /** 原生 X：回停靠（lastValidDock → 安全链），不是逻辑关闭。 */
      async nativeClose(input: { windowInstanceId: string; hostEpoch: number }): Promise<boolean> {
        // P2-09/B2：**页窗**（`detached-tab`）的归属不在面板 store 里 —— 页窗记录由 Tab runtime store 分配、
        // 由共享 registry 采纳，`panelInstanceKey` 恒为 null。若只按面板查找就会 `if (!panel) return false`，
        // 宿主 `handleNativeClose` 从不被调用（P2-06R 真机：X 被 preventDefault 后窗口 20s 不销毁、Tab 恒
        // detached）。因此先按 registry 的 kind 分派：页窗走 `.tabs.*` 的同一套回停靠语义，面板链逐字不变。
        if (windowRegistry.describeWindow(input.windowInstanceId)?.kind === 'detached-tab') {
          return (await tabHandlers?.nativeClose(input)) ?? false
        }
        const snapshot = runtimeStore.getSnapshot()
        const panelInstanceKey = windowRegistry.describeWindow(input.windowInstanceId)?.panelInstanceKey ?? null
        const panel = panelInstanceKey === null
          ? undefined
          : snapshot.panels.find((entry) => entry.panelInstanceKey === panelInstanceKey)
        if (!panel) return false
        const registration = panelRegistry.get(panel.panelId)
        if (!registration) return false
        const outcome = await transferOrchestrator.hostPort.handleNativeClose({
          windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch,
          lastValidDock: panel.lastValidDock, supportedModes: registration.supportedModes
        })
        return (outcome as { status?: string }).status === 'redocked'
      },
      /** 窗口被外部销毁（非宿主事务路径）：登记必须回收，飞事务必须收尾。 */
      async windowDestroyed(input: { windowInstanceId: string }): Promise<void> {
        await transferOrchestrator.lifecycle.forgetHostWindow(input)
        await reconcileTabContainers()
      }
    }),

    /**
     * 有界加载 + 迟到 CAS 恢复（`restoreWorkspaceLayout` 单点执行：面板与 Tab 同进同退）；**恢复之前先注册**
     * 受控通道与偏好基线（`registerChannels()` 幂等：app.ts 已在建窗之前调用过一次）⇒ start() 单独调用时
     * 语义与 packet 之前的「registry/handlers ready 之后才暴露通道」逐字一致。
     */
    async start(): Promise<WorkspaceStartReport> {
      if (started) return started
      registerChannels()
      await preferenceFollow.ensureBaseline()
      const restored = await createWorkspaceLayoutRestore({
        layoutStore, runtimeStore, tabStore, panelRegistry, pageRegistry,
        // P2-01：恢复也是 applied 布局命令；此时通常还没有宿主订阅，投递数为 0（宿主挂载时会拿到直发快照）
        onPanelsApplied: ({ before, result }) => { layoutEvents.publishApplied({ method: '_restoreLayout', before, result }) }
      }).restore()
      // 恢复确实发生了转换或剪裁时，用同一单写出口落一份「与注册表对账过」的 v2（一次有界写，绝不双写旧格式）
      if (restored.convertedFromV1 === true
        || (restored.prunedWorkspaces ?? 0) + (restored.prunedPanels ?? 0) + (restored.prunedTabs ?? 0) > 0) {
        scheduleLayoutSave()
      }
      started = { status: 'ready', registrationFailures, ...restored }
      return started
    },

    /** PLAT-26：显式注册入口（幂等、不恢复）；`app.ts` 在**建窗之前**调用，start() 内部也会调用一次。 */
    registerChannels,

    /** PLAT-32/S1：偏好变更的显式通知入口（唯一对账点）；返回是否真实转发，绝不 reject。 */
    notifyPreferencesChanged: () => preferenceFollow.notify(),

    /** P1-06m：退出/显式 flush（实现见 `workspaceLayoutLifecycle`）；PLAT-04 先交出 pending bounds。 */
    flushLayout: async () => { flushDetachedBounds(); return layoutLifecycle.flushLayout() },

    /** 退出：实现见 `workspaceLayoutLifecycle`；PLAT-04 在 barrier 前交付 pending bounds，退出后退订。 */
    dispose: async () => {
      flushDetachedBounds()
      try { return await layoutLifecycle.dispose() } finally { detachedBoundsSubscription?.() }
    }
  })
}

export type PanelWorkspaceComposition = ReturnType<typeof composePanelWorkspace>
