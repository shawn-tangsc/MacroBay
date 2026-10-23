import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { isAppLanguage } from '@platform/settings/schema/appSettings'
import type { WorkspacePanelRegistration, WorkspaceSize, WorkspaceTabSnapshot } from '@platform/workspace/contracts'
import { WorkspaceTransferPolicy } from '@platform/workspace/policies'
import { WorkspacePanelHost } from './WorkspacePanelHost'
import {
  MAIN_WINDOW_PANEL_PAGE_MIN_SIZE,
  WorkspaceMainPanelProvider
} from './workspaceMainPanelContext'
import { usePageWindowTabSubscription, useWorkspaceSnapshotSubscription, type HostState } from './useWorkspaceWindowState'
import { WorkspacePageWindowSurface } from './WorkspacePageWindowSurface'
import { DetachedWindowThemeShell, useDetachedWindowAppearance } from './workspaceWindowTheme'
import type { WorkspaceContentAdapter } from './workspaceHostAdapter'
import {
  buildPanelViews,
  hostableMounts,
  placeholderAdapter,
  placeholderRegistration,
  useErrorShellLanguage,
  usePageSize,
  WorkspaceDetachedPanelSurface,
  WorkspaceErrorShell,
  WorkspacePreparingShell,
  type WorkspacePanelAdapterInput,
  type WorkspacePanelContentInput
} from './workspaceWindowSurfaces'
import {
  createWorkspaceClient,
  createWorkspaceSourceAckRunner,
  createWorkspaceTabClient,
  planSourceAckTasks,
  readWorkspaceBridge,
  readWorkspaceTabsBridge,
  type WorkspaceTabClient
} from './workspaceClient'

/** 面板内容注入契约仍从本模块导出（定义随呈现面搬到 `workspaceWindowSurfaces.tsx`，公开面不变）。 */
export type { WorkspacePanelAdapterInput, WorkspacePanelContentInput }

/**
 * Owner: apps/desktop-shell renderer / workspace 窗口入口（P1-06b，P1-06f 补齐跨窗口 ACK 链）。
 * 回归：WorkspaceWindowRoot.test.tsx、workspaceTransferSourceAck.test.tsx、workspaceTransferTargetAck.test.tsx。
 * 权威：P1-06f 派发单、P1-06d 的 `hostLifecycle` 六相位准入、技术设计 §4「每窗按宿主作用域渲染」。
 *
 * 角色判定**只**来自 `workspace.getHostContext()` 的受控结果：
 *  - `role:'main'` ⇒ 渲染 `props.children`（由 AppShell 传入的既有 shell 内容），**同时**保留权威快照以驱动源侧 ACK；
 *  - `role:'panel'` 且自己承载了挂载 ⇒ 渲染 `WorkspacePanelHost`；
 *  - `role:'panel'` 且拿到受控待接管视图（`pendingTransfer`）⇒ 渲染准备期界面并报 `target-ready`，
 *    提交后（受控上下文里出现挂载）再渲染真实面板宿主；**绝不**显示「本窗口没有可承载面板」错误壳；
 *  - 上下文被拒绝/畸形、待接管目标没有 ACK 能力、或面板宿主确实没有可承载挂载 ⇒ 安全 error-shell；
 *  - 解析中（已拿到桥、等 IPC 回包）⇒ 渲染 null，宁可空白一帧也不猜角色；
 *  - 完全没有 workspace 桥（例如既有 shell 单测）⇒ 按主窗兜底渲染 children，保持 P1-06b 之前的行为。
 *
 * ── P1-06f 两条 ACK 链（这是 D1「面板从未在独立窗渲染 / 事务恒停在 awaiting-source-prepared」的修复点）──
 * 源侧（本窗正在失去承载权）：权威快照里出现本窗承载的面板的飞事务时，先按 P1-03 语义调用
 *   `adapter.prepare()`（失败/异常/超时 ⇒ `accepted:false`，绝不静默），再发 `source-prepared`；
 *   相位推进到 `awaiting-source-release` 时调用 `adapter.release()`，只有真的释放成功才发 `source-released`，
 *   并在 ACK 被接受后立即重取权威快照（主窗与面板窗的布局由此同步）。每个 operationId×相位只发一次。
 * 目标侧（本窗即将接管）：先渲染准备期界面（受控视图 `reserved` 阶段还没有 operationId，只能等），
 *   拿到 `in-flight` 视图后报一次 `target-ready`；随后用「事件驱动 + 有界定时器兜底」重取受控上下文与快照，
 *   挂载出现即切到真实面板宿主，视图消失且无挂载则收敛到安全错误壳（绝不留准备期假象）。
 *
 * 明确不做的事：不读 URL/`location`/localStorage，不由 renderer 自造 operationId/目标身份/待接管视图，
 * 不维护第二份布局权威，不放宽 mounts 与快照的归属过滤（待接管视图不是布局权限）。
 * P1-06i（A）：面板窗把受控 `context.preferences.theme` 写到根节点 `data-theme`（主窗同走共享写入函数）。
 *
 * ── P2-07 页窗 ACK 链（真机 B1 修复点）──
 * 独立页面窗走的是**另一条**归属分支（`.tabs.*` ≤ `status:'page'`），受控上下文里 `pendingTransfer` 恒为 null，
 * 因此面板链的 `status:'pending'` 分支永远不会为它触发。此前页窗因此从不报 `target-ready`：真机上目标窗口确实
 * 出现并渲染真实正文，但事务恒停在 awaiting-ready，10s 后按 `window-load-failed` 回滚销毁（主窗事件序
 * open → container-change-requested → fallback）。修复：页窗从 `.tabs.getSnapshot` 的受控投影 `pendingDetach`
 * 拿 operationId（含本窗身份，且必须与受控上下文身份逐字一致），经 `.tabs.hostLifecycle` **恰一次**报
 * `target-ready`；提交后由同一投影消失收敛（绝不重复 ACK、绝不自造后续相位）。
 *
 * ── PLAT-10 页窗语言/主题跟随主窗（P2-04 集成项）──
 * 页窗的偏好只在**自己那次**受控读取里拿得到。因此：Main 在偏好的唯一受控读取点（`getHostContext`）做漂移
 * 对账，用**既有事件词汇** `snapshot` 定向通知已打开页窗；本窗收到事件后单飞、有界地重取一次 `getHostContext`
 * 并把 `preferences` 写回 `state.context`（实现见 `useWorkspaceWindowState.ts`），页面窗根与面板窗同走
 * `applyRootThemeAttributes`。词汇/通道/preload 零新增；未归属/失败一律显式不跟随。
 */

/**
 * 面板宿主窗口为「页面」保留的最小尺寸（DIP）：它是本文件尺寸推导的唯一上限来源，
 * 用具名常量而不是散落的匿名数字（WorkspacePanelHost 的 pageMinSize 语义）。
 * PLAT-35：主窗页面区域（`MainWindowPanelArea`）复用同一常量，两条窗口路径的页面保留尺寸不会分叉。
 */
const WORKSPACE_PANEL_WINDOW_PAGE_MIN_SIZE: WorkspaceSize = MAIN_WINDOW_PANEL_PAGE_MIN_SIZE

/**
 * 待接管目标的有界重取：提交只改 store，事件不保证到达目标窗，因此必须有兜底节奏；
 * 总预算复用平台转移上界（准备 + 释放），绝不自造魔法时长，也绝不让准备期无限悬挂。
 */
const WORKSPACE_PENDING_POLL_INTERVAL_MS = 250
const WORKSPACE_PENDING_POLL_BUDGET_MS =
  WorkspaceTransferPolicy.prepareTargetTimeoutMs + WorkspaceTransferPolicy.releaseTimeoutMs

export type WorkspaceWindowRootProps = {
  children?: ReactNode
  /** 注入的面板注册信息（生产由 P1-06c 的注册表提供）；缺省 ⇒ 安全占位注册。 */
  registrations?: readonly WorkspacePanelRegistration[]
  /** 注入的真实内容 provider；返回 null/undefined 时退回安全占位视图。 */
  renderPanelContent?: (input: WorkspacePanelContentInput) => ReactNode | null
  /**
   * 源侧内容适配器（P1-03 的 prepare/release 语义）；缺省用具名安全空适配器
   * （prepare ⇒ ready、release ⇒ no-op），绝不因为缺少注入而跳过 ACK 或假装已释放。
   */
  resolvePanelAdapter?: (input: WorkspacePanelAdapterInput) => WorkspaceContentAdapter | null
  /**
   * 上下文不可用时的 error-shell 语言兜底；正常渲染的语言仍只取 context.preferences.language。
   * **PLAT-29** 起错误壳经既有 `platform.settings.get()` 同源有界重读跟随，本兜底只在读取不可用时生效。
   */
  fallbackLanguage?: AppLanguage
  /**
   * 待接管目标的兜底重取定时器端口（P1-06g 非阻塞①）：生产缺省即宿主的 `setTimeout`/`Date.now`；
   * 注入端口是为了让测试用手动时钟控制节奏，**不暴露任何时长旋钮**（节奏只由具名常量决定）。
   */
  pendingTimers?: WorkspacePendingTimerPort
}

/** 有界重取需要的全部时间能力；缺省实现见 `DEFAULT_PENDING_TIMERS`。 */
export type WorkspacePendingTimerPort = {
  schedule: (delayMs: number, run: () => void) => () => void
  now: () => number
}

const DEFAULT_PENDING_TIMERS: WorkspacePendingTimerPort = Object.freeze({
  schedule: (delayMs, run) => { const timer = setTimeout(run, delayMs); return () => clearTimeout(timer) },
  now: () => Date.now()
})

/**
 * 窗口根节点主题属性的**唯一写入点**（P1-06i / A）：主窗（`AppShellContent` 的 settings 效果）与独立面板窗
 * 共用，保证两条窗口路径的属性名/取值口径逐字一致。只写调用方**已解析好**的属性：不在这里读取任何来源
 * （更不读 OS/URL/localStorage）、不写颜色、不做校验——来源受控性由调用方负责。
 */
export function applyRootThemeAttributes(attributes: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(attributes)) document.documentElement.setAttribute(name, value)
}

/**
 * 面板窗根主题属性（P1-06i / A）：theme 取受控 `context.preferences.theme`（Main 已解析为 dark/light，N3 之后
 * 与 app 设置同源；面板窗不挂载 `AppShellContent`，只能走这里）。白名单外（未解析 `system`/脏值）⇒ null：
 * 宁可不写也绝不自造或回退 OS。accent 不在受控 workspace 契约里（PM 裁决 C 不扩契约）故不产出 `data-accent`。
 */
export function panelRootThemeAttributes(theme: string): Record<string, string> | null {
  return theme === 'dark' || theme === 'light' ? { 'data-theme': theme } : null
}

export function WorkspaceWindowRoot(props: WorkspaceWindowRootProps): React.ReactElement | null {
  const bridge = useMemo(() => readWorkspaceBridge(), [])
  const [state, setState] = useState<HostState>(() => (bridge === null ? { status: 'shell' } : { status: 'resolving' }))
  // P1-06h（N2）：error-shell 的语言兜底只接受白名单语言；缺省或白名单外一律回退 en-US，
  // 绝不把未知字符串交给 platformText（那会渲染出未样式化的空白/抛错页面）。
  const fallbackLanguage: AppLanguage = isAppLanguage(props.fallbackLanguage) ? props.fallbackLanguage : 'en-US'
  /** **PLAT-29**：错误壳语言经既有 `settings.get()` 同源有界重读跟随（判据/边界见 hook 的文档注释）。 */
  const errorShellLanguage = useErrorShellLanguage(state.status === 'error', fallbackLanguage)
  const pageSize = usePageSize(WORKSPACE_PANEL_WINDOW_PAGE_MIN_SIZE)
  /**
   * P1-06i（A）：面板窗把受控主题写到根节点（`:root[data-theme='light']` 的壳样式才会匹配）。上下文未取得
   * （shell/resolving）或失败（error）时不写、绝不猜 OS/默认值；收敛到 error 时保留最后一次受控值（宁可维持
   * 已受控主题，也不闪回暗色默认）。PLAT-10：**页面窗同走这条唯一写入路径**（此前页窗不写主题）。
   */
  const contextTheme = state.status === 'panel' || state.status === 'pending' || state.status === 'page'
    ? state.context.preferences.theme
    : null
  /** PLAT-39 ②：分离窗外观与根属性（实现见 `workspaceWindowTheme.tsx`）；非分离角色零读写。 */
  const detachedRole = state.status === 'panel' || state.status === 'pending' || state.status === 'page'
  const { appearance, applyBeforeFirstCommit } = useDetachedWindowAppearance({
    contextTheme, enabled: detachedRole, write: applyRootThemeAttributes
  })
  const sentReadyOperations = useRef(new Set<string>())
  const pendingTick = useRef<() => void>(() => undefined)

  // 角色解析：唯一输入是受控 getHostContext()/getSnapshot()，不读 URL/location/localStorage。
  useEffect(() => {
    if (bridge === null) return
    const client = createWorkspaceClient(bridge)
    let cancelled = false
    const resolve = async (): Promise<void> => {
      const outcome = await client.readHostContext()
      if (cancelled) return
      if (outcome.status !== 'ok') {
        setState({ status: 'error', reason: 'context-unavailable' })
        return
      }
      const snapshot = await client.loadSnapshot()
      if (cancelled) return
      if (outcome.context.role === 'main') {
        // 主窗仍渲染既有 shell，但保留权威快照与订阅：源侧 ACK 必须由主窗发出
        setState({ status: 'main', context: outcome.context, snapshot, client })
        return
      }
      if (snapshot === null) {
        setState({ status: 'error', reason: 'panel-unmounted' })
        return
      }
      if (hostableMounts(outcome.context, snapshot).length > 0) {
        await applyBeforeFirstCommit(outcome.context.preferences.theme)
        if (cancelled) return
        setState({ status: 'panel', context: outcome.context, snapshot, client })
        return
      }
      // 提交前只认受控待接管视图；没有视图或没有 ACK 能力 ⇒ 继续判定页面窗（P2-03），最后才是 error-shell
      const transfer = outcome.context.pendingTransfer
      if (transfer !== null && client.canSendHostLifecycle()) {
        await applyBeforeFirstCommit(outcome.context.preferences.theme)
        if (cancelled) return
        setState({ status: 'pending', context: outcome.context, snapshot, transfer, client })
        return
      }
      const tabsBridge = readWorkspaceTabsBridge()
      if (tabsBridge !== null) {
        const tabClient = createWorkspaceTabClient(tabsBridge)
        // `load()` 就是页面窗的受控挂载点：Main 在此为该窗建立 router 订阅（退订旧 listener → 直发快照 → 续增量）
        const tabState = await tabClient.load()
        if (cancelled) { tabClient.dispose(); return }
        const owned = tabState === null ? [] : tabState.tabs.filter((tab) => tab.open
          && tab.windowInstanceId === outcome.context.windowInstanceId && tab.hostEpoch === outcome.context.hostEpoch)
        if (owned.length === 1 && tabState !== null) {
          await applyBeforeFirstCommit(outcome.context.preferences.theme)
          if (cancelled) { tabClient.dispose(); return }
          setState({
            status: 'page', context: outcome.context, tabClient, client, tab: owned[0] as WorkspaceTabSnapshot,
            // PLAT-03：与 tab 同源的权威 revision（`.tabs.getSnapshot` 投影里的真实值）
            layoutRevision: tabState.layoutRevision,
            pendingDetach: tabClient.pendingDetach()
          })
          return
        }
        tabClient.dispose()
      }
      setState({ status: 'error', reason: 'panel-unmounted' })
    }
    void resolve()
    return () => {
      cancelled = true
      client.dispose()
    }
  }, [bridge])

  // 独立页面窗订阅 Tab 权威快照（P2-03/P2-07/PLAT-03：事件到达即重取，快照与待 ACK 投影同源更新）。
  const pageTabClient = state.status === 'page' ? state.tabClient : null
  usePageWindowTabSubscription(pageTabClient, state.status === 'page' ? state.client : null, setState)

  // 已取得角色的窗口订阅权威快照；PLAT-28：面板窗在同一条订阅里跟随主窗语言/主题（见 useWorkspaceWindowState.ts）
  useWorkspaceSnapshotSubscription(
    state.status === 'main' || state.status === 'panel' ? state.client : null, state.status === 'panel', setState
  )

  // ── 源侧 ACK 链：prepare → source-prepared；release → source-released（每 operationId×相位只发一次）──
  const sourceClient = state.status === 'main' || state.status === 'panel' ? state.client : null
  const sourceContext = state.status === 'main' || state.status === 'panel' ? state.context : null
  const sourceSnapshot = state.status === 'main' || state.status === 'panel' ? state.snapshot : null
  const sourceTasks = sourceContext === null ? [] : planSourceAckTasks(sourceContext, sourceSnapshot)
  const sourceTaskKey = sourceTasks.map((task) => task.key).join('|')
  const sourceRunner = useMemo(
    () => (sourceClient === null ? null : createWorkspaceSourceAckRunner(sourceClient)),
    [sourceClient]
  )
  useEffect(() => {
    if (sourceRunner === null || sourceContext === null) return
    // P1-06g 非阻塞②：先声明当前仍在飞的 task key（收敛的已受理记录立即淘汰，长会话绝不单调增长），
    // 再执行；仍在飞的 key 因此绝不被淘汰，`每 operationId×相位只发一次`语义不变。
    sourceRunner.retain(sourceTasks.map((task) => task.key))
    for (const task of sourceTasks) {
      const registration = props.registrations?.find((item) => item.panelId === task.panelId)
        ?? placeholderRegistration(task.panelId)
      const adapter = props.resolvePanelAdapter?.({
        panelInstanceKey: task.panelInstanceKey, panelId: task.panelId,
        registration, language: sourceContext.preferences.language
      }) ?? placeholderAdapter()
      void sourceRunner.run(task, adapter)
    }
    // sourceTaskKey 覆盖 sourceTasks 的全部内容；sourceRunner/sourceContext 变化时也必须重跑
  }, [sourceTaskKey, sourceRunner, sourceContext]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 目标侧 ACK 链：有界重取受控上下文与权威快照（事件驱动 + 定时器兜底）──
  const pendingClient = state.status === 'pending' ? state.client : null
  const pendingOperationId = state.status === 'pending' && state.transfer.status === 'in-flight'
    ? state.transfer.operationId
    : null
  const pendingPollTimers = props.pendingTimers
  useEffect(() => {
    if (pendingClient === null) return
    const client = pendingClient
    const timers = pendingPollTimers ?? DEFAULT_PENDING_TIMERS
    let cancelled = false
    let cancelTimer: (() => void) | null = null
    const startedAt = timers.now()
    function scheduleNext(): void {
      // 事件与定时器可能同时触发：只保留一个在飞定时器，绝不让它无界累积
      cancelTimer?.()
      cancelTimer = timers.schedule(WORKSPACE_PENDING_POLL_INTERVAL_MS, () => { void readAuthority() })
    }
    async function readAuthority(): Promise<void> {
      const outcome = await client.readHostContext()
      if (cancelled) return
      if (outcome.status !== 'ok') {
        setState({ status: 'error', reason: 'context-unavailable' })
        return
      }
      const snapshot = await client.loadSnapshot()
      if (cancelled) return
      if (snapshot === null) {
        setState({ status: 'error', reason: 'panel-unmounted' })
        return
      }
      if (hostableMounts(outcome.context, snapshot).length > 0) {
        setState({ status: 'panel', context: outcome.context, snapshot, client })
        return
      }
      const transfer = outcome.context.pendingTransfer
      if (transfer === null) {
        // 飞事务消失且没有取得挂载 ⇒ 已回滚：收敛到安全错误壳，绝不留准备期假象
        setState({ status: 'error', reason: 'panel-unmounted' })
        return
      }
      setState((previous) => previous.status === 'pending' && previous.client === client
        ? { ...previous, context: outcome.context, snapshot, transfer }
        : previous)
      if (timers.now() - startedAt >= WORKSPACE_PENDING_POLL_BUDGET_MS) {
        setState({ status: 'error', reason: 'panel-unmounted' })
        return
      }
      scheduleNext()
    }
    pendingTick.current = () => { void readAuthority() }
    const unsubscribe = client.observe(() => { void readAuthority() })
    scheduleNext()
    return () => {
      cancelled = true
      pendingTick.current = () => undefined
      cancelTimer?.()
      unsubscribe()
    }
  }, [pendingClient, pendingPollTimers])

  // 渲染器就绪（受控上下文 + 首次快照已取、准备期界面已挂载）后报一次 target-ready。
  useEffect(() => {
    if (pendingClient === null || pendingOperationId === null) return
    if (sentReadyOperations.current.has(pendingOperationId)) return
    sentReadyOperations.current.add(pendingOperationId)
    void (async () => {
      const result = await pendingClient.sendHostLifecycle({ operationId: pendingOperationId, phase: 'target-ready' })
      if (!result.accepted) return
      // ready 被接受后 Main 可能立刻提交：马上追一次权威读取，不等兜底定时器
      pendingTick.current()
    })()
  }, [pendingClient, pendingOperationId])

  /**
   * ── P2-07 页窗 ACK 链（B1 修复点）────────────────────────────────────────────────────────────
   * 独立页面窗走的是**另一条**归属分支（`.tabs.*`，受控上下文里 `pendingTransfer` 恒为 null），因此面板链的
   * `status:'pending'` 分支永远不会为它触发 —— 这正是真机 B1：真实窗口已渲染正文，却从不报 `target-ready`，
   * 于是宿主 `schedule(prepareTargetTimeoutMs=10s)` 到期 `rollback → destroyWindow`，窗口消失、store 被漂移回 main。
   *
   * 这里用**同一姿态**补上页窗 ACK：operationId 与身份只来自受控 `.tabs.getSnapshot` 投影（`pendingDetach`），
   * 且必须与本窗受控上下文身份逐字一致（非目标窗/陈旧 epoch 一律零 ACK，fail closed）；
   * 每个 operationId 只发一次（StrictMode 双调用、重复事件、迟到重取都不得重复 ACK）。
   * 被拒（迟到/未知/非本窗）绝不重试、绝不伪造后续相位：Main 的截止时间会如实回滚并投递 fallback。
   */
  const pageClient = state.status === 'page' ? state.tabClient : null
  const pagePendingOperationId = state.status === 'page' && state.pendingDetach !== null
    && state.pendingDetach.windowInstanceId === state.context.windowInstanceId
    && state.pendingDetach.hostEpoch === state.context.hostEpoch
    ? state.pendingDetach.operationId
    : null
  useEffect(() => {
    if (pageClient === null || pagePendingOperationId === null) return
    if (sentReadyOperations.current.has(pagePendingOperationId)) return
    sentReadyOperations.current.add(pagePendingOperationId)
    void (async () => {
      const result = await pageClient.sendHostLifecycle({ operationId: pagePendingOperationId, phase: 'target-ready' })
      if (!result.accepted) return
      // 提交只改 store、事件不保证到达页窗：接受后立刻追一次权威读取（与面板链同一兜底姿态）
      const next = await pageClient.load()
      if (next === null) return
      setState((previous) => {
        if (previous.status !== 'page' || previous.tabClient !== pageClient) return previous
        const own = next.tabs.filter((tab) => tab.open
          && tab.windowInstanceId === previous.context.windowInstanceId
          && tab.hostEpoch === previous.context.hostEpoch)
        return {
          ...previous,
          tab: own.length === 1 ? own[0] as WorkspaceTabSnapshot : previous.tab,
          layoutRevision: next.layoutRevision,
          pendingDetach: pageClient.pendingDetach()
        }
      })
    })()
  }, [pageClient, pagePendingOperationId])

  /** PLAT-39 ②：分离窗正文的 antd 主题外壳（token 单一来源见 `workspaceWindowTheme.tsx`）。 */
  const themeShell = (language: AppLanguage, children: ReactNode): React.ReactElement =>
    <DetachedWindowThemeShell language={language} contextTheme={contextTheme} appearance={appearance}>{children}</DetachedWindowThemeShell>

  if (state.status === 'shell') return <>{props.children}</>
  if (state.status === 'main') {
    /**
     * **PLAT-35**：主窗把**同一份**受控客户端（权威快照 + 端口）下发给 shell，供
     * `MainWindowPanelArea` 用 Tab 链的活动实例键构造面板宿主。快照未取得前不下发（shell 原样渲染），
     * 绝不让主窗因一次慢读取被替换成空壳。
     */
    if (state.snapshot === null) return <>{props.children}</>
    const mainClient = state.client
    const mainSnapshot = state.snapshot
    return (
      <WorkspaceMainPanelProvider value={{
        context: state.context,
        snapshot: mainSnapshot,
        port: mainClient.port,
        reportSnapshot: (snapshot) => {
          setState((previous) => previous.status === 'main' && previous.client === mainClient
            ? { ...previous, snapshot }
            : previous)
        }
      }}>
        {props.children}
      </WorkspaceMainPanelProvider>
    )
  }
  if (state.status === 'resolving') return null
  if (state.status === 'error') {
    return themeShell(errorShellLanguage, <WorkspaceErrorShell language={errorShellLanguage} reason={state.reason} />)
  }

  if (state.status === 'page') {
    return themeShell(state.context.preferences.language, (
      <WorkspacePageWindowSurface
        language={state.context.preferences.language}
        timeZone={state.context.preferences.timeZone}
        tab={state.tab}
        layoutRevision={state.layoutRevision}
        tabClient={state.tabClient}
      />
    ))
  }

  if (state.status === 'pending') {
    const language = state.context.preferences.language
    const registration = props.registrations?.find((item) => item.panelId === state.transfer.panelId)
      ?? placeholderRegistration(state.transfer.panelId)
    // P1-06h（N2）：正文用受控上下文语言；注册信息缺该语言条目时用 AppShell 传来的当前语言兜底，
    // 再退到 panelId —— 准备期界面绝不渲染 undefined 标题。
    const title = registration.title[language] ?? registration.title[fallbackLanguage] ?? registration.panelId
    return themeShell(language, <WorkspacePreparingShell language={language} title={title} transfer={state.transfer} />)
  }

  const { context, snapshot } = state
  const language = context.preferences.language
  const mounts = hostableMounts(context, snapshot)
  // views 每次渲染重建：内容与适配器都无状态；真实内容 provider 与注册信息由 P1-06c 的注册表注入。
  const views = buildPanelViews({
    mounts,
    language,
    registrations: props.registrations,
    renderPanelContent: props.renderPanelContent,
    resolvePanelAdapter: props.resolvePanelAdapter
  })
  const workspaceInstanceKey = snapshot.activeWorkspaceInstanceKey
    ?? mounts[0].workspaceInstanceKey

  // 独立面板窗口（提交后的 mode:'detached'）走单面板内容面：页面级区域布局不承载 detached 面板
  if (mounts.every((mount) => mount.mode === 'detached')) {
    return themeShell(language, (
      <WorkspaceDetachedPanelSurface
        mounts={mounts}
        views={views}
        timeZone={context.preferences.timeZone}
        language={language}
        redock={state.client.port.redock}
      />
    ))
  }

  return themeShell(language, (
    <WorkspacePanelHost
      timeZone={context.preferences.timeZone}
      workspaceInstanceKey={workspaceInstanceKey}
      snapshot={snapshot}
      pageSize={pageSize}
      pageMinSize={WORKSPACE_PANEL_WINDOW_PAGE_MIN_SIZE}
      language={language}
      onSnapshot={(value) => {
        setState((previous) => (previous.status === 'panel' && previous.client === state.client ? { ...previous, snapshot: value } : previous))
      }}
      views={views}
      port={state.client.port}
    />
  ))
}
