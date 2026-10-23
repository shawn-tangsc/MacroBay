import type { WorkspacePageRegistration } from '@platform/workspace/contracts'
import {
  TAB_COMMAND_FIELDS, TAB_COMMON_FIELDS, TAB_LIFECYCLE_PHASES
} from './tabWorkspaceCommandContract'
import { planTabDetachedTitle } from './tabWindowTitle'
import { createTabContainerIdentity } from './tabWorkspaceContainerIdentity'
import type { WorkspaceSize, WorkspaceTabCommandResult, WorkspaceTabState, WorkspaceTabSnapshot } from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy } from '@platform/workspace/policies'
import type { createWorkspacePageRegistry } from '@platform/workspace/registry/workspacePageRegistry'
import type { createWorkspaceTabStore } from '@platform/workspace/runtime/workspaceTabStore'
import { IpcChannels } from '../../ipc/channels'
import type { WorkspaceHostLifecycleOutcome } from './panelWorkspaceIpcHandlers'
import type { WorkspaceIpcSenderEvent } from './panelWorkspaceIpcHandlers'
import {
  claimMatchesHost, isLifecyclePhase, plainRecord, requiredRevision, requiredString, type WorkspaceHostLifecyclePhase
} from './panelWorkspacePayloadGuard'
import { toStoreHostIdentity } from './panelWorkspaceScopeProjection'
import type { TabDetachedWindowHost } from './tabDetachedWindowHost'
import { readSourceAreaSize } from './workspaceSourceArea'
import type { WorkspaceWindowRecord, WorkspaceWindowRegistry } from './workspaceWindowRegistry'
import {
  createWorkspaceHostSubscriptionLedger,
  type WorkspaceHostSubscriptionLedger
} from './workspaceHostSubscriptionLedger'

/**
 * Owner: platform/desktop/main/workspace（P2-03）。权威：技术设计 §4/§5.4 与 A-T02、A-T03～A-T05、A-T09、A-T10。
 *
 * `.tabs.*` 的 Main 侧接线（**只做准入 + 转发 + 投影**）：
 *  - 三条受控通道：`getSnapshot` / `command` / `hostLifecycle`（事件复用既有 `workspaceEvent` 通道与 router，
 *    因此**不新增事件词汇**，`workspaceClient.EVENT_TYPES` 白名单契约原样不动）；
 *  - 准入链与面板命令逐条同构：主 frame → 已登记未销毁 webContents → payload 白名单（含身份声明一致）
 *    → 严格方法白名单 → 真实 `workspaceTabStore`（revision CAS 由 store 决定，IPC 层绝不自造）；
 *  - 作用域投影：主窗拿全量；**独立页窗只拿自己承载的那一个实例**；独立面板宿主拿不到任何 Tab 布局；
 *  - `detachTab` 是两阶段事务 + 补偿回滚：先让 store 分配容器身份 → registry 采纳 → 共享宿主开事务；
 *    任一步失败即 `redockTab`（CAS）把 store 还原、并撤销未消费的采纳 —— 绝不留下「store 说 detached、
 *    却没有窗口」或「有窗口、store 说 main」的分叉；
 *  - `hostLifecycle` 只接受本事务的 `target-ready`（页面窗）与源相位（主窗）；页面没有独立内容适配器，
 *    因此 target-ready 被接受后由 Main 以**主窗身份**确认源释放（判据见 `detachTab` 只允许主窗发起）。
 *    陈旧 epoch / 未知 operation / 重复或迟到 ACK 一律 `accepted:false`，绝不复活状态；
 *  - **P2-07**：`getSnapshot` 额外投影 `pendingDetach`（additive，不新增通道/方法）——这是页面窗唯一能拿到
 *    「本次未提交事务 operationId」的受控入口（等价于面板链的 `pendingTransfer`，但走 `.tabs.*` 而非面板上下文）。
 *    它**不是**布局权限：只有该未提交事务的目标窗拿得到，且 ACK 的准入仍完全由 registry 身份 + operation 判定。
 *  - **P2-13**：`getSnapshot`/`command` 的受控投影额外带上 `recentlyClosedCount`（additive，不新增通道/
 *    方法）：主窗＝`tabStore.recentlyClosed()` 的真实条数，页窗/面板宿主/未授权 sender 一律 0。
 *    它只驱动渲染侧「重开最近关闭」入口的禁用态，**不是**布局权限，也不是持久化字段。
 */

/** 页窗受控待 ACK 投影（P2-07，additive）：renderer 侧镜像类型 `WorkspaceTabPendingDetach`。 */
export type TabPendingDetachView = { operationId: string; windowInstanceId: string; hostEpoch: number }

/** Tab 事件发布端口（复用 router；`layoutRevision` 用 Tab runtime store 的真实值）。 */
export type TabEventPublishPort = (input: {
  type: 'open' | 'close' | 'restore' | 'container-changed'
  scope: { workspaceInstanceKey: string }
  layoutRevision: number
}) => void

export type TabWorkspaceIpcDependencies = {
  pageRegistry: ReturnType<typeof createWorkspacePageRegistry>
  tabStore: ReturnType<typeof createWorkspaceTabStore>
  windowRegistry: WorkspaceWindowRegistry
  /** 页面窗宿主；未接线（没有共享宿主）时 `detachTab`/`redockTab` fail closed（`unsupported`）。 */
  host?: TabDetachedWindowHost
  /** 命令被真实接受后的受控事件发布；缺省不发布（不假装有订阅者）。 */
  publish?: TabEventPublishPort
  /**
   * 独立页窗挂载受控事件订阅（复用 router 的 `attachHost`：退订旧 listener → 直发 snapshot → 续增量）。
   * 缺省即「不接线」：页窗仍能读到快照并主动重取，但收不到主推增量（绝不假装已订阅）。
   */
  attach?: (record: WorkspaceWindowRecord) => boolean
  /**
   * P2-10①：宿主销毁 / 登记回收 / 身份失效时释放该身份在 router 里的 target（真机＝`router.releaseHost`）。
   *
   * **PLAT-01②：必填端口，绝不是可选接线。** 缺省意味着 `maxTargets` 额度永不归还 —— 死宿主会长期占满额度、
   * 后续页窗静默降级为仅 IPC 拉取且**没有任何可见信号**。因此漏注在类型层即不可构造，运行期也在构造期
   * fail closed（`tabs-release-port-required`）。本模块的回收通知（`registry.onWindowRecycled`）会自动调用它，
   * 调用方只需提供端口本身（幂等：releaseHost 对未登记/陈旧 epoch 一律 no-op，重复释放无害）。
   */
  release: (input: { windowInstanceId: string; hostEpoch: number }) => void
  /**
   * PLAT-30（并入项 1）：**宿主订阅记账的唯一出口**（真机＝组合根构造的同一个共享 ledger，同时交给面板 handler）。
   *
   * 给了它，本模块的挂载/幂等/降级/额度归还/回收释放都走那一处记账 —— 面板宿主与页窗宿主的记账与释放
   * 不可分叉；不给（测试缝/独立构造）则按本模块的 `attach`+`release` 端口自建一个同类 ledger（语义逐字相同，
   * 只是不与面板侧共享；`attach` 端口漏注仍在构造期 fail closed）。
   */
  hostSubscriptionLedger?: WorkspaceHostSubscriptionLedger
  /**
   * **PLAT-35**：`openTab` applied 后把同一 `workspaceInstanceKey` 采纳进面板链（幂等；缺省 = 不接线）。
   * 两条链因此共享一个页面实例键 —— 停靠面板才会出现在主窗正在显示的 Tab 页上。
   */
  adoptPanelWorkspace?: (input: { workspaceInstanceKey: string; pageId: string }) => void
  /**
   * **PLAT-41**：页窗建窗标题按当前宿主语言解析（与主窗 Tab 标签同源）；缺省回落到注册信息的 en-US。
   * 它同时决定 `allowedTitles`（`page-title-updated` 的受控白名单）里的主标题。
   */
  resolveTitle?: (registration: WorkspacePageRegistration) => string | Promise<string>
}

const MAIN_WINDOW = WorkspaceOwnershipPolicy.initialWindowInstanceId
const MAIN_EPOCH = WorkspaceOwnershipPolicy.initialHostEpoch
/** 非 detached 场景下 Tab 的容器身份：与 store 的 main 声明逐字一致（绝不自造）。 */
const MAIN_CONTAINER = Object.freeze({ windowInstanceId: MAIN_WINDOW, hostEpoch: MAIN_EPOCH })

export function createTabWorkspaceIpcHandlers(dependencies: TabWorkspaceIpcDependencies) {
  const { pageRegistry, tabStore, windowRegistry } = dependencies
  // PLAT-01②：`release` 是容量正确性的必要条件，**不是**可选接线：漏注在类型层已不可构造，这里再守一次
  // 运行期（JS 调用方/断言绕过类型），绝不静默降级为「额度永不归还」。
  if (typeof dependencies.release !== 'function') throw new Error('tabs-release-port-required')
  const channels = Object.freeze({
    workspaceTabsGetSnapshot: IpcChannels.workspaceTabsGetSnapshot,
    workspaceTabsCommand: IpcChannels.workspaceTabsCommand,
    workspaceTabsHostLifecycle: IpcChannels.workspaceTabsHostLifecycle,
    workspaceEvent: IpcChannels.workspaceEvent
  })

  /** 页面窗的容器归属：以共享 registry 的 `detached-tab` 记录为唯一容器权威。 */
  // 容器身份翻译（pageWindowOf / containerOf / containerClaimOf）在 `tabWorkspaceContainerIdentity.ts`
  const { pageWindowOf, containerOf, containerClaimOf } = createTabContainerIdentity({
    windowRegistry, mainContainer: MAIN_CONTAINER
  })

  const resolveSender = (event: WorkspaceIpcSenderEvent): WorkspaceWindowRecord | null => {
    if (typeof event !== 'object' || event === null) return null
    const frame = (event as { senderFrame?: unknown }).senderFrame
    if (typeof frame !== 'object' || frame === null) return null
    if ((frame as { parent?: unknown }).parent !== null) return null
    const sender = (event as { sender?: unknown }).sender
    if (typeof sender !== 'object' || sender === null) return null
    const webContentsId = (sender as { id?: unknown }).id
    if (typeof webContentsId !== 'number' || !Number.isSafeInteger(webContentsId) || webContentsId <= 0) return null
    const isDestroyed = (sender as { isDestroyed?: unknown }).isDestroyed
    if (typeof isDestroyed !== 'function' || (isDestroyed as () => boolean).call(sender) === true) return null
    return windowRegistry.resolveWebContents(webContentsId) ?? null
  }

  /**
   * 空投影：保留真实 revision，但绝不含任何 Tab 布局（未授权 sender 只拿这个）。
   * P2-13：`recentlyClosedCount` 一律 0 —— 作用域外的宿主连「有几个最近关闭」都不该知道。
   */
  const emptyState = (): WorkspaceTabState => Object.freeze({
    layoutRevision: tabStore.getSnapshot().layoutRevision, activeWorkspaceInstanceKey: null, tabs: Object.freeze([]),
    recentlyClosedCount: 0
  })

  /**
   * 作用域投影：主窗全量；独立页窗只有自己承载的实例（且必须 `open`）；其它宿主为空。
   * `activeWorkspaceInstanceKey` 同样按作用域收窄（独立页窗的「活动项」就是它自己）。
   *
   * P2-13：`recentlyClosedCount` 逐字来自 Main 的 `tabStore.recentlyClosed()`（权威、真实状态），
   * 且**只**给主窗 —— 「最近关闭」是主窗工作区的历史，页窗/面板宿主不因本字段获得额外信息。
   */
  const scopeState = (record: WorkspaceWindowRecord): WorkspaceTabState => {
    const state = tabStore.getSnapshot()
    if (record.kind === 'main') {
      return Object.freeze({
        ...state,
        recentlyClosedCount: tabStore.recentlyClosed().length,
        tabs: Object.freeze(state.tabs.map((tab) => Object.freeze({ ...tab, ...containerOf(tab) })))
      })
    }
    if (record.kind !== 'detached-tab') return emptyState()
    const own = state.tabs.filter((tab) => tab.open
      && pageWindowOf(tab.workspaceInstanceKey)?.windowInstanceId === record.windowInstanceId)
    if (own.length === 0) return emptyState()
    return Object.freeze({
      layoutRevision: state.layoutRevision,
      activeWorkspaceInstanceKey: own[0].workspaceInstanceKey,
      tabs: Object.freeze(own.map((tab) => Object.freeze({ ...tab, ...containerOf(tab) }))),
      recentlyClosedCount: 0
    })
  }

  const publishFor = (type: Parameters<TabEventPublishPort>[0]['type'], workspaceInstanceKey: string): void => {
    try {
      dependencies.publish?.({ type, scope: { workspaceInstanceKey }, layoutRevision: tabStore.getSnapshot().layoutRevision })
    } catch { /* 通知失败不影响已提交的 Tab 结论 */ }
  }

  /**
   * P2-09/B3：页窗挂载的**幂等键**（宿主身份 = `windowInstanceId` + `hostEpoch`）。
   *
   * `getSnapshot` 是**只读**查询，绝不允许带无界副作用：`attach` 端口是 `router.attachHost`
   * （退订旧 listener → **直发一条 snapshot** → 续增量），因此每次调用都会产生一条事件；而 renderer 收到
   * `snapshot` 即 `refresh()` 再读一次 `getSnapshot` ⇒ 「每次读都挂载」形成**自持闭环**。
   * P2-06R 真机证据：detach 后零交互 32.6s 内该页窗收到 48550 条事件（~1487 条/秒），全部
   * `type=snapshot`/`scope={}`，主窗同期 0 条 ⇒ A-T07「无关窗 0 条」不成立（根因行号：本文件原第 213 行）。
   *
   * 因此同一宿主身份**至多挂载一次**：首次仍直发一条快照（页窗据此拿到自己作用域的快照，与既有 attach
   * 语义逐字一致），其后的重复读只返回权威投影 —— 不重发快照、不重注册 listener、事件数为 **O(1)**。
   * 身份变化（同 id 新 epoch）视为新宿主窗 ⇒ 重新挂载；登记已被回收的身份由**回收通知**当刻释放
   * （PLAT-01①：`registry.onWindowRecycled` 在构造期订阅，绝不等下一次页窗读），剪除只剩防御性兜底。
   *
   * PLAT-30（并入项 1/2）：这份记账已收到**唯一出口** `workspaceHostSubscriptionLedger` —— 面板宿主与页窗
   * 宿主共用同一个状态机（组合根注入同一个实例），因此「挂载/幂等/降级/额度归还/释放」不可分叉；`attach`
   * 端口（真机＝`router.attachHost`）在 ledger 里是**必填**，漏注在构造期 fail closed（绝不静默）。
   */
  const ledger = dependencies.hostSubscriptionLedger ?? createWorkspaceHostSubscriptionLedger({
    windowRegistry,
    attach: (record) => dependencies.attach?.(record) === true,
    release: (input) => { dependencies.release(input) }
  })
  const hostSubscriptionPort = ledger.attachFor('detached-tab')

  /**
   * P2-09/B3 幂等挂载 + P2-10① 释放：全部由唯一出口承担 —— 同一宿主身份至多挂载一次（绝不按读次数重发
   * 快照 ⇒ 无自持风暴）；因 `maxTargets` 满被拒的宿主进入 `degraded`（**可见**，绝不静默）；并且只在**真的**
   * 发生过释放（回收通知或剪除）时重试**一次**并消费那次信用 —— 重试由真实释放事件驱动，绝不由读次数驱动。
   * 身份已不在 registry 的记账由出口在挂载前剪除（防御性兜底，见 `workspaceHostSubscriptionLedger`）。
   */
  const attachHostOnce = (record: WorkspaceWindowRecord): boolean => hostSubscriptionPort.attach(record)

  /**
   * P2-07：页窗的受控待 ACK 投影（additive）。
   * 只有「该未提交事务的目标窗」（registry 的 `detached-tab` 记录 + epoch 逐字一致 + 宿主仍认为该事务未提交）
   * 拿得到 operationId；已提交/已回滚/未参与/非页窗 ⇒ `null`。renderer 据此报 `target-ready`，
   * 但**能否推进相位完全由 `hostLifecycle` 的身份 + operation 准入决定**（投影不是权限）。
   */
  const pendingDetachFor = (record: WorkspaceWindowRecord): TabPendingDetachView | null => {
    if (record.kind !== 'detached-tab') return null
    const pending = dependencies.host?.pendingTabOperation({
      windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch
    })
    if (pending === undefined) return null
    return Object.freeze({
      operationId: pending.operationId, windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch
    })
  }

  /** 未授权 sender 用的空投影拒绝（绝不回退成全量）。 */
  const emptyRejection = (errorCode: NonNullable<WorkspaceTabCommandResult['errorCode']>, workspaceInstanceKey?: string): WorkspaceTabCommandResult =>
    ({ status: 'rejected', snapshot: emptyState(), errorCode, ...(workspaceInstanceKey === undefined ? {} : { workspaceInstanceKey }) })

  /** 已授权 sender 的拒绝：仍按该 sender 的作用域投影（拒绝绝不能把主窗的 Tab 列表打进空白）。 */
  const deny = (
    record: WorkspaceWindowRecord,
    errorCode: NonNullable<WorkspaceTabCommandResult['errorCode']>,
    workspaceInstanceKey?: string
  ): WorkspaceTabCommandResult =>
    ({ status: 'rejected', snapshot: scopeState(record), errorCode, ...(workspaceInstanceKey === undefined ? {} : { workspaceInstanceKey }) })

  /** 补偿回滚：把 store 还原到 main 并撤销未消费的采纳（任一步失败都不留分叉）。 */
  const compensateDetach = async (input: { requestScope: string; workspaceInstanceKey: string; windowInstanceId?: string }): Promise<void> => {
    if (input.windowInstanceId !== undefined) windowRegistry.revokeDetachedTabReservation(input.windowInstanceId)
    const current = tabStore.getSnapshot()
    if (current.tabs.find((tab) => tab.workspaceInstanceKey === input.workspaceInstanceKey)?.mode !== 'detached') return
    await tabStore.redockTab({
      requestId: `tabs-compensate-${input.workspaceInstanceKey}`, requestScope: input.requestScope,
      expectedRevision: current.layoutRevision, windowInstanceId: MAIN_WINDOW, hostEpoch: MAIN_EPOCH,
      workspaceInstanceKey: input.workspaceInstanceKey
    })
  }

  return Object.freeze({
    channels,

    /** 只读受控快照：按宿主作用域投影（主窗全量 / 页窗自己的实例 / 其它为空）+ P2-07 待 ACK 投影。 */
    async getSnapshot(event: WorkspaceIpcSenderEvent, payload?: unknown): Promise<{
      status: 'ok'
      snapshot: WorkspaceTabState
      pendingDetach: TabPendingDetachView | null
    } | { status: 'rejected'; errorCode: string }> {
      const record = resolveSender(event)
      if (record === null) return { status: 'rejected', errorCode: 'not-owner' }
      if (payload !== undefined && payload !== null && plainRecord(payload, []) === null) {
        return { status: 'rejected', errorCode: 'invalid-request' }
      }
      // 页面宿主第一次读快照时挂上受控订阅（P2-09/B3：按宿主身份幂等 —— 重复读绝不重发 snapshot、绝不重注册）
      if (record.kind === 'detached-tab') attachHostOnce(record)
      return { status: 'ok', snapshot: scopeState(record), pendingDetach: pendingDetachFor(record) }
    },

    /** 严格方法白名单 → 真实 Tab runtime store；未知方法/多余字段/伪造身份在进 store 之前就被拒绝。 */
    async command(event: WorkspaceIpcSenderEvent, payload?: unknown): Promise<WorkspaceTabCommandResult> {
      const record = resolveSender(event)
      if (record === null) return emptyRejection('not-owner')
      if (typeof payload !== 'object' || payload === null) return deny(record, 'invalid-request')
      const method = (payload as { method?: unknown }).method
      if (typeof method !== 'string' || !Object.hasOwn(TAB_COMMAND_FIELDS, method)) return deny(record, 'invalid-request')
      const fields = plainRecord(payload, [...TAB_COMMON_FIELDS, ...TAB_COMMAND_FIELDS[method]])
      if (!fields) return deny(record, 'invalid-request')
      const requestId = requiredString(fields, 'requestId')
      const expectedRevision = requiredRevision(fields)
      if (requestId === null || expectedRevision === null) return deny(record, 'invalid-request')
      if (!claimMatchesHost(fields, record)) return deny(record, 'not-owner')

      const host = toStoreHostIdentity(record)
      const common = { requestId, requestScope: record.windowInstanceId, expectedRevision, ...host }
      const key = (): string | null => requiredString(fields, 'workspaceInstanceKey')
      const applied = async (
        result: Promise<WorkspaceTabCommandResult>,
        type: Parameters<TabEventPublishPort>[0]['type'],
        workspaceInstanceKey?: string
      ): Promise<WorkspaceTabCommandResult> => {
        const raw = await result
        if (raw.status === 'applied') {
          const target = raw.workspaceInstanceKey ?? workspaceInstanceKey
          if (target !== undefined) publishFor(type, target)
        }
        return Object.freeze({ ...raw, snapshot: scopeState(record) })
      }

      switch (method) {
        case 'openTab': {
          // 只接受「pageId 或 menuKey」**其一**：两者都经注册表解析成权威 pageId，renderer 不能自造身份。
          // menuKey 是 shell 一级菜单键（内置页 menuKey === pageId，产品页为 /productId/localPageId）。
          const hasPageId = fields.pageId !== undefined
          const hasMenuKey = fields.menuKey !== undefined
          if (hasPageId === hasMenuKey) return deny(record, 'invalid-request')
          const selector = requiredString(fields, hasMenuKey ? 'menuKey' : 'pageId')
          if (selector === null) return deny(record, 'invalid-request')
          const resolved = hasMenuKey ? pageRegistry.byMenuKey(selector) : pageRegistry.get(selector)
          if (resolved === undefined) return deny(record, 'registration-missing')
          const pageId = resolved.pageId
          const bindingKey = fields.bindingKey === undefined ? undefined : requiredString(fields, 'bindingKey')
          if (bindingKey === null) return deny(record, 'invalid-request')
          const newInstance = fields.newInstance
          if (newInstance !== undefined && typeof newInstance !== 'boolean') return deny(record, 'invalid-request')
          const result = await applied(tabStore.openTab({
            ...common, pageId,
            ...(bindingKey === undefined ? {} : { bindingKey }),
            ...(newInstance === undefined ? {} : { newInstance })
          }), 'open')
          // **PLAT-35**：Tab 键就是页面实例键 —— 采纳进面板链后，停靠面板才与主窗当前 Tab 同属一个工作区。
          // 只在 applied 时采纳；采纳失败绝不影响已提交的 Tab 结论（面板侧会保持原样，绝不会出现半采纳的假象）。
          if (result.status === 'applied' && typeof result.workspaceInstanceKey === 'string') {
            try { dependencies.adoptPanelWorkspace?.({ workspaceInstanceKey: result.workspaceInstanceKey, pageId }) } catch { /* 绝不影响 Tab 结论 */ }
          }
          return result
        }
        case 'activateTab': {
          const workspaceInstanceKey = key()
          if (workspaceInstanceKey === null) return deny(record, 'invalid-request')
          return applied(tabStore.activateTab({ ...common, workspaceInstanceKey }), 'container-changed', workspaceInstanceKey)
        }
        case 'closeTab': {
          const workspaceInstanceKey = key()
          if (workspaceInstanceKey === null) return deny(record, 'invalid-request')
          const result = await applied(tabStore.closeTab({ ...common, workspaceInstanceKey }), 'close', workspaceInstanceKey)
          // 逻辑关闭：独立页窗（及其本工作区子面板窗）必须收敛，绝不留下孤儿窗口
          if (result.status === 'applied') convergeClosedPageWindow(workspaceInstanceKey)
          return result
        }
        case 'closeOthers': {
          const workspaceInstanceKey = key()
          if (workspaceInstanceKey === null) return deny(record, 'invalid-request')
          const before = tabStore.getSnapshot()
          const result = await applied(tabStore.closeOthers({ ...common, workspaceInstanceKey }), 'close', workspaceInstanceKey)
          if (result.status === 'applied') {
            for (const tab of before.tabs) {
              if (tab.open && tab.workspaceInstanceKey !== workspaceInstanceKey) convergeClosedPageWindow(tab.workspaceInstanceKey)
            }
          }
          return result
        }
        case 'closeRight': {
          const workspaceInstanceKey = key()
          if (workspaceInstanceKey === null) return deny(record, 'invalid-request')
          const before = tabStore.getSnapshot()
          const result = await applied(tabStore.closeRight({ ...common, workspaceInstanceKey }), 'close', workspaceInstanceKey)
          if (result.status === 'applied') {
            const index = before.tabs.findIndex((tab) => tab.workspaceInstanceKey === workspaceInstanceKey)
            for (const tab of before.tabs.slice(index + 1)) {
              if (tab.open) convergeClosedPageWindow(tab.workspaceInstanceKey)
            }
          }
          return result
        }
        case 'reopenLastClosed':
          return applied(tabStore.reopenLastClosed({ ...common }), 'restore')
        case 'reorderTabs': {
          const keys = fields.workspaceInstanceKeys
          if (!Array.isArray(keys) || Object.getPrototypeOf(keys) !== Array.prototype) return deny(record, 'invalid-request')
          if (!keys.every((entry) => typeof entry === 'string')) return deny(record, 'invalid-request')
          return applied(tabStore.reorderTabs({ ...common, workspaceInstanceKeys: keys as string[] }), 'container-changed')
        }
        case 'detachTab':
          // P2-14：源区域尺寸在**这里**从 sender 的真实窗口读（Main 侧权威测量），再作为页面窗默认尺寸的输入
          return detachTab(record, fields, common, readSourceAreaSize(event))
        case 'redockTab':
          return redockTab(record, fields, common)
        case 'bindTab': {
          const workspaceInstanceKey = key()
          const bindingKey = requiredString(fields, 'bindingKey')
          if (workspaceInstanceKey === null || bindingKey === null) return deny(record, 'invalid-request')
          return applied(tabStore.bindTab({ ...common, workspaceInstanceKey, bindingKey }), 'container-changed', workspaceInstanceKey)
        }
        default:
          return deny(record, 'invalid-request')
      }
    },

    /**
     * 容器漂移收敛（零分叉保证）：任何失败路径（准备超时、加载失败、崩溃、外部销毁、逻辑关闭）都可能让
     * 共享宿主回收登记，而 store 仍记着 `mode:'detached'`。组合根在**每次宿主事件之后**调用本入口，
     * 把「store 说 detached、registry 里却没有页面窗」的实例还原到 `main`（CAS 用 store 的真实 revision），
     * 并撤销仍未被消费的身份采纳。返回收敛的实例键（诊断用），绝不抛。
     */
    async reconcileContainerDrift(): Promise<readonly string[]> {
      const reconciled: string[] = []
      const state = tabStore.getSnapshot()
      for (const tab of state.tabs) {
        if (tab.mode !== 'detached') continue
        if (pageWindowOf(tab.workspaceInstanceKey) !== undefined) continue
        // 登记已回收（窗口崩溃/外部销毁/采纳被撤销）⇒ 释放该身份的 router target（P2-10①）
        ledger.releaseHost({ windowInstanceId: tab.windowInstanceId, hostEpoch: tab.hostEpoch })
        try {
          const current = tabStore.getSnapshot()
          await tabStore.redockTab({
            requestId: `tabs-reconcile-${tab.workspaceInstanceKey}-${current.layoutRevision}`,
            requestScope: MAIN_WINDOW, expectedRevision: current.layoutRevision,
            windowInstanceId: MAIN_WINDOW, hostEpoch: MAIN_EPOCH,
            workspaceInstanceKey: tab.workspaceInstanceKey
          })
          windowRegistry.revokeDetachedTabReservation(tab.windowInstanceId)
          publishFor('container-changed', tab.workspaceInstanceKey)
          reconciled.push(tab.workspaceInstanceKey)
        } catch { /* 收敛失败只影响该实例的下一次 reconcile，绝不影响调用方 */ }
      }
      return Object.freeze(reconciled)
    },

    /**
     * P2-09/B2：**页窗原生关闭（用户按 X）的 app 侧消费者**。
     *
     * 窗口工厂对原生关闭**无条件 `preventDefault`** 后只回调 app 侧桥，因此这是页窗回停靠的唯一入口：
     * 它必须把页窗记录送进**既有宿主机制**，否则窗口既不销毁也不回停靠（Tab 恒 `detached`、
     * `container-changed` 永不出现；P2-06R 真机 20s 复现，差分对照是同一 Tab 走 IPC `redockTab` 立即生效）。
     *
     * 语义与 `.tabs.redockTab` 的承载者路径**逐字同构**（宿主回停靠 → store 回 `main` → 定向通知），
     * 只是发起者不是 renderer 而是窗口自身；身份仍以 registry 为唯一权威（含 epoch，逐字一致），
     * 未知/陈旧/非页窗一律 `false` 且**零触碰**（不调宿主、不动 store、不碰任何其它窗口）。
     */
    async nativeClose(input: { windowInstanceId: string; hostEpoch: number }): Promise<boolean> {
      const record = windowRegistry.describeWindow(input.windowInstanceId)
      if (!record || record.kind !== 'detached-tab' || record.hostEpoch !== input.hostEpoch) return false
      const host = dependencies.host
      const workspaceInstanceKey = record.workspaceInstanceKey
      if (!host || workspaceInstanceKey === null) return false
      // 既有宿主机制：用户回停靠 = `embedded`（同时销毁窗口、释放登记、记用户意图供 closed 收敛链消费）
      const outcome = host.rehomeTabToMain({ windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch })
      if (outcome.status !== 'redocked') return false
      // 窗口已销毁而 Tab store 可能仍停在 detached：必须回到 main，绝不留下「store 说 detached、窗口已消失」。
      // 与漂移收敛共用同一条 CAS 路径；竞争失败（同一结论的另一条收敛路径已回停靠）由收敛链兜底。
      const current = tabStore.getSnapshot()
      if (current.tabs.find((tab) => tab.workspaceInstanceKey === workspaceInstanceKey)?.mode === 'detached') {
        try {
          await tabStore.redockTab({
            requestId: `tabs-native-close-${workspaceInstanceKey}-${current.layoutRevision}`,
            requestScope: MAIN_WINDOW, expectedRevision: current.layoutRevision,
            windowInstanceId: MAIN_WINDOW, hostEpoch: MAIN_EPOCH, workspaceInstanceKey
          })
        } catch { /* CAS 竞争与队列拒绝都不改变已成立的窗口结论 */ }
      }
      // 定向语义不变：容器确实从页窗回到主窗 ⇒ 按该工作区发布一条 container-changed
      publishFor('container-changed', workspaceInstanceKey)
      // P2-10①：宿主已销毁（窗口已回停靠/销毁）⇒ 立即释放它的 router target，不等下一次读来剪除
      ledger.releaseHost({ windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch })
      return true
    },

    /**
     * P2-10①（只读自证）：页窗挂载状态。`degraded` = 曾在 `maxTargets` 满时被拒、当前只靠 IPC 拉取的宿主
     * ⇒ 降级**可见**，绝不静默；额度一旦由登记回收归还，它会在下一次读重挂（重试只由真实释放事件触发）。
     * `subscribed` 与 `degraded` 互斥（身份要么真的订上了，要么如实记为降级）；两者都按 epoch 记账，
     * 因此陈旧 epoch 的迟到释放绝不会把它谎报成已订阅（PLAT-01③）。
     */
    hostSubscriptionStatus(): { subscribed: readonly string[]; degraded: readonly string[] } {
      return hostSubscriptionPort.status()
    },

    /**
     * PLAT-01①：**宿主已销毁（登记已回收）时的即时释放出口**。registry 的回收通知在构造期已自动接到这里；
     * 本方法供迟到/外部观察到的回收复用，幂等且带 epoch 守卫（陈旧 epoch 的释放绝不误删同窗口新 epoch 的
     * 在线订阅与挂载记账 —— 守卫在 router 与本模块记账两侧同时生效）。只做释放，绝不销毁任何窗口。
     */
    releaseHost(input: { windowInstanceId: string; hostEpoch: number }): void {
      ledger.releaseHost({ windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch })
    },

    /**
     * 页面窗异步 ACK 的准入：只接受**本事务**的参与者与阶段。
     *  - `target-ready`：必须来自该 Tab 当前登记（未提交 owner）的页面窗；接受后 Main 以主窗身份确认源释放
     *    （页面 Tab 的源恒为主窗：`detachTab` 只允许主窗发起，因此这条确认不是权限放宽而是页面语义）；
     *  - `source-released` / `source-invalid`：必须来自该实例当前承载者（主窗）。
     * 全部失败路径 `accepted:false` 且不改布局；陈旧/未知/重复一律 fail closed。
     */
    async hostLifecycle(event: WorkspaceIpcSenderEvent, payload?: unknown): Promise<WorkspaceHostLifecycleOutcome> {
      const record = resolveSender(event)
      if (record === null) return { accepted: false, reason: 'not-owner' }
      const denied = (reason: string): WorkspaceHostLifecycleOutcome => ({ accepted: false, reason })
      const fields = plainRecord(payload, ['operationId', 'phase', 'windowInstanceId', 'hostEpoch'])
      if (!fields) return denied('invalid-request')
      const operationId = requiredString(fields, 'operationId')
      const phase = fields.phase
      if (operationId === null || !isLifecyclePhase(phase) || !TAB_LIFECYCLE_PHASES.includes(phase)) {
        return denied(phase === 'target-ready' ? 'invalid-request' : 'unsupported')
      }
      if (!claimMatchesHost(fields, record)) return denied('not-owner')
      const host = dependencies.host
      if (!host) return denied('unsupported')

      // 未知 operation：只做判定（不触碰任何窗口），绝不把「不属于本事务的 ACK」当成有效阶段。
      // 已提交事务的迟到 ACK 同样走这条判定（`pendingOperationIds()` 只含未提交事务）⇒ 一律 accepted:false。
      if (!host.pendingOperationIds().includes(operationId)) return denied('unknown-operation')
      const pageWindow = host.describePageWindow(record.windowInstanceId)
      const claim = { operationId, windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch }

      if (phase === 'target-ready') {
        if (!pageWindow) return denied('not-owner')
        const ready = host.confirmTargetReady(claim)
        if (!('accepted' in ready) || ready.accepted !== true) return denied('invalid-phase')
        // 页面没有独立内容适配器：源恒为主窗，Main 以主窗身份确认释放（提交路径与面板完全共用）
        const released = host.confirmSourceReleased(claim)
        if (!('accepted' in released) || released.accepted !== true) return denied('source-release-failed')
        publishFor('container-changed', pageWindow.workspaceInstanceKey)
        return { accepted: true }
      }

      // 源相位：只有该实例当前的 store 承载者（主窗）可以 ACK；`claimMatchesHost` 已保证声明与 registry 一致
      if (record.kind !== 'main') return denied('not-owner')
      return phase === 'source-released' ? host.confirmSourceReleased(claim) : host.confirmSourceInvalid(claim)
    }
  })

  function convergeClosedPageWindow(workspaceInstanceKey: string): void {
    const host = dependencies.host
    if (!host) return
    const record = pageWindowOf(workspaceInstanceKey)
    if (record === undefined) return
    host.closeDetachedTab({
      windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch,
      childPanelWindowInstanceIds: host.childPanelWindowsOf(workspaceInstanceKey)
    })
  }

  /** `detachTab`：store 分配身份 → registry 采纳 → 共享宿主开事务；失败即补偿回滚。 */
  async function detachTab(
    record: WorkspaceWindowRecord,
    fields: Record<string, unknown>,
    common: { requestId: string; requestScope: string; expectedRevision: number } & { windowInstanceId: string; hostEpoch: number },
    /** P2-14：源窗口内容区尺寸（Main 侧测量）；缺省时页面窗宿主走策略默认尺寸。 */
    sourceAreaSize?: WorkspaceSize
  ): Promise<WorkspaceTabCommandResult> {
    const workspaceInstanceKey = requiredString(fields, 'workspaceInstanceKey')
    if (workspaceInstanceKey === null) return deny(record, 'invalid-request')
    // 新建分离 = 布局管理权：只允许主窗（与 store 的 `isMainClaim` 逐字同语义）
    if (record.kind !== 'main') return deny(record, 'not-owner', workspaceInstanceKey)
    const host = dependencies.host
    if (!host) return deny(record, 'unsupported', workspaceInstanceKey)
    const tab = tabStore.getSnapshot().tabs.find((entry) => entry.workspaceInstanceKey === workspaceInstanceKey)
    if (tab === undefined) return deny(record, 'registration-missing', workspaceInstanceKey)
    const registration = pageRegistry.get(tab.pageId)
    if (registration === undefined) return deny(record, 'registration-missing', workspaceInstanceKey)
    const alreadyDetached = pageWindowOf(workspaceInstanceKey)
    if (alreadyDetached !== undefined) return deny(record, 'invalid-request', workspaceInstanceKey)

    const started = await tabStore.detachTab({ ...common, workspaceInstanceKey })
    if (started.status !== 'applied') return Object.freeze({ ...started, snapshot: scopeState(record) })
    const claim = containerClaimOf(started, workspaceInstanceKey)
    if (claim === null) return deny(record, 'invalid-request', workspaceInstanceKey)

    const reserved = windowRegistry.reserveDetachedTabWindow({
      windowInstanceId: claim.windowInstanceId, hostEpoch: claim.hostEpoch, workspaceInstanceKey
    })
    if (reserved.status === 'rejected') {
      await compensateDetach({ requestScope: record.windowInstanceId, workspaceInstanceKey })
      return deny(record, reserved.errorCode === 'limit-reached' ? 'limit-reached' : 'invalid-request', workspaceInstanceKey)
    }

    // PLAT-04：用户调整过的页窗尺寸是**布局数据**（随逻辑实例保存）：再次分离必须回到同一尺寸，
    // P2-14 的策略默认只在该实例从未被调整过时生效；策略仍只做工作区内夹紧，绝不覆盖用户尺寸。
    const savedBounds = tabStore.detachedBoundsOf(workspaceInstanceKey)

    // PLAT-41：建窗标题（当前语言）+ `page-title-updated` 白名单（实现在 `tabWindowTitle.ts`）
    const { title, allowedTitles } = await planTabDetachedTitle({
      registration, fallbackPageId: tab.pageId,
      ...(dependencies.resolveTitle === undefined ? {} : { resolveTitle: dependencies.resolveTitle })
    })

    const outcome = await host.requestTabDetach({
      operationId: `${common.requestScope}:${common.requestId}`,
      workspaceInstanceKey,
      pageId: tab.pageId,
      menuKey: tab.menuKey,
      title,
      allowedTitles,
      // 宿主端口用的是 **registry 身份**（共享宿主会拿它调 `assertOwner`），不是 store 哨兵身份
      sourceHost: { windowInstanceId: record.windowInstanceId, hostEpoch: record.hostEpoch },
      windowInstanceId: claim.windowInstanceId,
      hostEpoch: claim.hostEpoch,
      ...(sourceAreaSize === undefined ? {} : { sourceAreaSize }),
      ...(savedBounds === undefined ? {} : { savedBounds })
    })
    if (outcome.status === 'rejected' || outcome.status === 'rolled-back') {
      await compensateDetach({
        requestScope: record.windowInstanceId, workspaceInstanceKey, windowInstanceId: claim.windowInstanceId
      })
      return deny(record, outcome.status === 'rejected' && outcome.errorCode === 'limit-reached' ? 'limit-reached' : 'unsupported', workspaceInstanceKey)
    }
    publishFor('open', workspaceInstanceKey)
    return Object.freeze({ status: 'applied' as const, snapshot: scopeState(record), workspaceInstanceKey })
  }

  /** `redockTab`：走共享宿主的用户回停靠路径（`embedded`），成功后才把 store 还原到 main。 */
  async function redockTab(
    record: WorkspaceWindowRecord,
    fields: Record<string, unknown>,
    common: { requestId: string; requestScope: string; expectedRevision: number } & { windowInstanceId: string; hostEpoch: number }
  ): Promise<WorkspaceTabCommandResult> {
    const workspaceInstanceKey = requiredString(fields, 'workspaceInstanceKey')
    if (workspaceInstanceKey === null) return deny(record, 'invalid-request')
    const host = dependencies.host
    if (!host) return deny(record, 'unsupported', workspaceInstanceKey)
    const pageWindow = pageWindowOf(workspaceInstanceKey)
    // 没有独立页窗 ⇒ 已经是 main：幂等成功，不触碰任何窗口
    if (pageWindow === undefined) {
      const result = await tabStore.redockTab({ ...common, workspaceInstanceKey })
      return Object.freeze({ ...result, snapshot: scopeState(record) })
    }
    // 权限：主窗或该页窗自己（承载者）可回停靠；其它宿主 fail closed
    const isCarrier = record.kind === 'detached-tab' && pageWindow.windowInstanceId === record.windowInstanceId
    if (record.kind !== 'main' && !isCarrier) return deny(record, 'not-owner', workspaceInstanceKey)
    host.rehomeTabToMain({ windowInstanceId: pageWindow.windowInstanceId, hostEpoch: pageWindow.hostEpoch })
    const result = await tabStore.redockTab({ ...common, workspaceInstanceKey })
    if (result.status === 'applied') publishFor('container-changed', workspaceInstanceKey)
    return Object.freeze({ ...result, snapshot: scopeState(record) })
  }
}

export type TabWorkspaceIpcHandlers = ReturnType<typeof createTabWorkspaceIpcHandlers>
