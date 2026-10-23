import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, PictureInPicture2, Plus, RotateCcw, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { WorkspaceTabCommandResult, WorkspaceTabState } from '@platform/workspace/contracts'
import { platformText } from '../../i18n/platformText'
import { WorkspaceTabMenu, type WorkspaceTabMenuItem } from './WorkspaceTabMenu'
import { workspaceTabElementIds } from './WorkspacePageHost'
import {
  runWorkspaceDraftBatch,
  type WorkspaceDirtyProbe,
  type WorkspaceDraftDecision,
  type WorkspaceDraftOwnerPort
} from './workspaceDraftGate'

/**
 * Owner: apps/desktop-shell renderer / workspace 顶部 Tab Strip（P2-02）。
 * 权威：技术设计 §3（一个 workspaceInstanceKey = 一个逻辑页面）、§5.4（Tab 视图）、
 * A-T01「全部一级菜单都在注册里」、A-T02「关闭/重开/其他/右侧/排序/最后 Tab：状态、顺序、焦点正确；
 * 最后 Tab 后空工作区仍可打开菜单」、A-T08「键盘可达、ARIA 正确」。
 *
 * 边界（P2-02 刻意收窄）：
 *  - **typed port + 受控快照**：本组件只消费 P2-01 `workspaceTabStore` 的权威快照与命令结果，
 *    绝不在 renderer 复制 tab 顺序/活动项（唯一的本地状态是焦点高亮、菜单开合与提示文案）；
 *  - 生产 IPC/窗口接线（`.tabs.*`、独立页面窗）属 P2-03；本包用 typed port + fake runtime 完成 UI；
 *  - P2-15：Tab 的**右键上下文菜单**（含「分离到新窗口」）在这里接线 —— 只转发 `detachTab` 命令，
 *    能力/实例判据来自受控快照与 shell 描述符，**不新增通道、不放宽准入链**。
 */

export type WorkspaceTabPort = {
  openTab: (input: { pageId: string; bindingKey?: string; newInstance?: boolean }) => Promise<WorkspaceTabCommandResult>
  activateTab: (input: { workspaceInstanceKey: string }) => Promise<WorkspaceTabCommandResult>
  closeTab: (input: { workspaceInstanceKey: string }) => Promise<WorkspaceTabCommandResult>
  closeOthers: (input: { workspaceInstanceKey: string }) => Promise<WorkspaceTabCommandResult>
  closeRight: (input: { workspaceInstanceKey: string }) => Promise<WorkspaceTabCommandResult>
  reopenLastClosed: () => Promise<WorkspaceTabCommandResult>
  reorderTabs: (input: { workspaceInstanceKeys: readonly string[] }) => Promise<WorkspaceTabCommandResult>
  /**
   * P2-15：把该实例分离到独立页面窗。命令面与准入链（身份/epoch/作用域/预算）完全沿用既有
   * `.tabs.detachTab`：strip 只**转发**，绝不在这里判定权限、也绝不静默吞掉拒绝结果。
   */
  detachTab: (input: { workspaceInstanceKey: string }) => Promise<WorkspaceTabCommandResult>
}

/** P2-01 shell 投影（`createShellWorkspacePageRegistry`）的结构子集：可见文案/图标仍由它唯一提供。 */
export type WorkspaceTabPageDescriptor = {
  pageId: string
  menuKey: string
  label: string
  icon: LucideIcon
  supportsDetached: boolean
  allowMultipleInstances: boolean
}

/**
 * 草稿保护端口：草稿状态**只能**由内容 owner（真实表单）回答；strip 自造布尔状态是禁止的。
 * 三态裁决界面也由 owner 侧提供（Settings 草稿的提示不得由通用 strip 伪造）。
 */
export type WorkspaceTabDraftGuard = {
  owner: (workspaceInstanceKey: string) => WorkspaceDraftOwnerPort | undefined
  renderPrompt: (input: {
    workspaceInstanceKey: string
    probe: WorkspaceDirtyProbe
    pending: boolean
    onDecision: (decision: WorkspaceDraftDecision) => void
  }) => ReactNode
}

export type WorkspaceTabStripProps = {
  language: AppLanguage
  /** P2-01 权威快照（受控）：strip 不持有第二份 tab/布局状态。 */
  state: WorkspaceTabState
  pages: readonly WorkspaceTabPageDescriptor[]
  port: WorkspaceTabPort
  /** P2-01 `recentlyClosed()` 的条数；为 0 时「重开」入口禁用并给出可见原因。 */
  recentlyClosedCount: number
  /**
   * P2-10③：草稿门**必填**。可选 prop 会让生产路径静默退化成死代码（D2：`AppShell` 不传 ⇒ 三态提示永不出现），
   * 因此由组合根显式注入；没有草稿 owner 的页由 guard 回答 `undefined`（不是省略端口）。
   */
  draftGuard: WorkspaceTabDraftGuard
  /** 页面宿主（由组合根注入；strip 只提供 tablist 与语义，不复制布局权威）。 */
  children?: ReactNode
}

type PendingDecision = { workspaceInstanceKey: string; probe: WorkspaceDirtyProbe; keys: readonly string[] }

/** P2-15：右键上下文菜单的受控锚点（**视口坐标**）；`nonce` 让「同一 Tab 反复右键」也能重新打开。 */
type TabContextMenu = { workspaceInstanceKey: string; x: number; y: number; nonce: number }

function createDeferred(): { promise: Promise<WorkspaceDraftDecision>; resolve: (value: WorkspaceDraftDecision) => void } {
  let resolve: (value: WorkspaceDraftDecision) => void = () => undefined
  const promise = new Promise<WorkspaceDraftDecision>((settle) => { resolve = settle })
  return { promise, resolve }
}

export function WorkspaceTabStrip(props: WorkspaceTabStripProps): React.ReactElement {
  const labels = platformText[props.language].workspace
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingDecision | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** P2-15：`null` = 没有上下文菜单（同一时刻最多一个，绝不给每个 Tab 各挂一份菜单状态）。 */
  const [tabMenu, setTabMenu] = useState<TabContextMenu | null>(null)
  const deferredRef = useRef<ReturnType<typeof createDeferred> | null>(null)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const guard = props.draftGuard
  const openTabs = props.state.tabs.filter((tab) => tab.open)
  const activeKey = props.state.activeWorkspaceInstanceKey
  const tabbableKey = focusedKey ?? activeKey

  // 被关闭/消失的 Tab 不能继续吃掉 roving focus
  useEffect(() => {
    if (focusedKey !== null && openTabs.some((tab) => tab.workspaceInstanceKey === focusedKey)) return
    setFocusedKey(null)
  }, [focusedKey, openTabs])

  const descriptors = useMemo(
    () => new Map(props.pages.map((page) => [page.pageId, page])),
    [props.pages]
  )

  /**
   * 命令执行：`rejectedNotice` 只把**受控 errorCode** 映射成成对文案（绝不把错误码本身渲染给用户），
   * 缺省仍是 P2-02 的通用拒绝文案。
   */
  const run = useCallback(async (
    command: () => Promise<WorkspaceTabCommandResult>,
    rejectedNotice?: (errorCode: WorkspaceTabCommandResult['errorCode']) => string
  ): Promise<boolean> => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await command()
      if (result.status === 'rejected') {
        setNotice(rejectedNotice?.(result.errorCode) ?? labels.tabCommandRejected)
        return false
      }
      return true
    } catch {
      setNotice(labels.tabCommandFailed)
      return false
    } finally {
      setBusy(false)
    }
  }, [labels.tabCommandFailed, labels.tabCommandRejected])

/**
 * IME 组合中的按键判定：React 合成事件并不总是转发 `isComposing`，因此同时看 `nativeEvent`
 * 与旧式 `keyCode === 229` 上报。三条都命中不了才算「普通按键」。
 */
function isCompositionKey(event: React.KeyboardEvent<HTMLElement>): boolean {
  return event.nativeEvent.isComposing === true || event.keyCode === 229
}

/** 三态提示：草稿 owner 提供界面，strip 只搬运用户裁决（不读草稿正文）。 */
  const askDecision = useCallback(async (input: PendingDecision): Promise<WorkspaceDraftDecision> => {
    const deferred = createDeferred()
    deferredRef.current = deferred
    setPending(input)
    const decision = await deferred.promise
    deferredRef.current = null
    setPending(null)
    return decision
  }, [])

  /**
   * 带草稿保护的关闭：先只读探针，只有用户明确保存/丢弃才继续；
   * 批量场景收集全部裁决后再落副作用 ⇒ 取消**零**副作用（不保存、不丢弃、不关闭）。
   */
  const guardedClose = useCallback(async (keys: readonly string[], command: () => Promise<WorkspaceTabCommandResult>): Promise<void> => {
    if (keys.length === 0) return
    const dirty = keys.flatMap((key) => {
      const owner = guard?.owner(key)
      const probe = owner?.probe()
      return probe?.status === 'dirty' ? [{ key, probe }] : []
    })
    if (dirty.length > 0) {
      const decision = await askDecision({ workspaceInstanceKey: dirty[0]!.key, probe: dirty[0]!.probe, keys })
      if (decision === 'cancel') return
      const outcome = await runWorkspaceDraftBatch({
        workspaceInstanceKeys: keys,
        getOwner: (key) => guard?.owner(key),
        decide: () => decision
      })
      if (outcome.status === 'aborted') {
        if (outcome.reason === 'save-failed') setNotice(labels.draftGateSaveFailed)
        return
      }
    }
    await run(command)
  }, [askDecision, guard, labels.draftGateSaveFailed, run])

  const activate = useCallback((workspaceInstanceKey: string): void => {
    void run(() => props.port.activateTab({ workspaceInstanceKey }))
  }, [props.port, run])

  const closeOne = useCallback((workspaceInstanceKey: string): void => {
    void guardedClose([workspaceInstanceKey], () => props.port.closeTab({ workspaceInstanceKey }))
  }, [guardedClose, props.port])

  const focusTab = useCallback((workspaceInstanceKey: string): void => {
    setFocusedKey(workspaceInstanceKey)
    tabRefs.current[workspaceInstanceKey]?.focus()
  }, [])

  /**
   * 右键 / Shift+F10：同一入口、同一份菜单（`nonce` 保证反复打开都能重建并重新聚焦）。
   * 只把该 Tab 设为**键盘锚点**（roving tabindex），**不激活**它 —— 右键不是「切换页面」。
   */
  const openTabContextMenu = useCallback((workspaceInstanceKey: string, x: number, y: number): void => {
    setFocusedKey(workspaceInstanceKey)
    setTabMenu((previous) => ({ workspaceInstanceKey, x, y, nonce: (previous?.nonce ?? 0) + 1 }))
  }, [])


  /** Alt+Shift+方向：在**打开的** Tab 序列里挪一位，再按完整（含已关闭）顺序提交给权威。 */
  const reorder = useCallback((workspaceInstanceKey: string, delta: -1 | 1): void => {
    const visible = props.state.tabs.filter((tab) => tab.open).map((tab) => tab.workspaceInstanceKey)
    const from = visible.indexOf(workspaceInstanceKey)
    const to = from + delta
    if (from < 0 || to < 0 || to >= visible.length) return
    const order = props.state.tabs.map((tab) => tab.workspaceInstanceKey)
    const firstIndex = order.indexOf(visible[from]!)
    const secondIndex = order.indexOf(visible[to]!)
    order[firstIndex] = visible[to]!
    order[secondIndex] = visible[from]!
    setFocusedKey(workspaceInstanceKey)
    void run(() => props.port.reorderTabs({ workspaceInstanceKeys: order }))
  }, [props.port, props.state.tabs, run])

  /**
   * 组合键快捷键只在**标签栏**范围内生效（Ctrl/Cmd+W 关闭活动标签、Ctrl/Cmd+Shift+T 重开最近关闭）：
   * 页面正文不是标签栏的后代，因此页面输入框里的 Ctrl+W/Delete 绝不会被这里劫持；
   * 全部标签都关闭时（无 tab 可聚焦）标签栏本身仍是同一个快捷键作用域。
   */
  const onTabBarKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (isCompositionKey(event)) return
    const primary = event.ctrlKey || event.metaKey
    if (!primary || event.altKey) return
    const lower = event.key.toLowerCase()
    if (lower === 'w' && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      if (activeKey !== null) closeOne(activeKey)
      return
    }
    if (lower === 't' && event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      if (props.recentlyClosedCount === 0) return
      void run(() => props.port.reopenLastClosed())
    }
  }, [activeKey, closeOne, props.port, props.recentlyClosedCount, run])

  const onTablistKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    // IME 组合中的按键绝不是快捷键：误触发会丢掉正在输入的内容
    if (isCompositionKey(event)) return
    const tabElement = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]')
    if (tabElement === null) return
    const key = tabElement.dataset.tabKey
    if (key === undefined) return
    const index = openTabs.findIndex((tab) => tab.workspaceInstanceKey === key)
    if (event.ctrlKey || event.metaKey) return

    // P2-15：右键菜单的键盘等价入口（`Shift+F10` / 专用 ContextMenu 键），锚点取该 Tab 的几何位置
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault()
      event.stopPropagation()
      const rect = tabElement.getBoundingClientRect()
      openTabContextMenu(key, rect.left, rect.bottom)
      return
    }
    if (event.altKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      event.stopPropagation()
      reorder(key, event.key === 'ArrowLeft' ? -1 : 1)
      return
    }
    if (event.altKey) return

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      const target = event.key === 'Home' ? 0
        : event.key === 'End' ? openTabs.length - 1
          : event.key === 'ArrowLeft' ? Math.max(index - 1, 0) : Math.min(index + 1, openTabs.length - 1)
      const next = openTabs[target]
      if (next !== undefined && next.workspaceInstanceKey !== key) focusTab(next.workspaceInstanceKey)
      return
    }
    if (event.key === 'Delete') {
      event.preventDefault()
      event.stopPropagation()
      closeOne(key)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      activate(key)
    }
  }, [activate, closeOne, focusTab, openTabContextMenu, openTabs, reorder])

  const openPageMenuItems: WorkspaceTabMenuItem[] = props.pages.map((page) => ({
    id: `page:${page.pageId}`,
    label: page.label,
    icon: page.icon
  }))

  const anchorKey = activeKey ?? openTabs[0]?.workspaceInstanceKey ?? null

  /**
   * 某个 Tab（或条级菜单的锚点）能做什么：关闭类**相对该 Tab** 计算（右键 agents 时「关闭右侧」
   * 必须关掉 agents 右侧的 Tab，而不是活动 Tab 右侧的）。
   */
  const keysRightOf = useCallback((key: string | null): readonly string[] => {
    const index = key === null ? -1 : openTabs.findIndex((tab) => tab.workspaceInstanceKey === key)
    return index < 0 ? [] : openTabs.slice(index + 1).map((tab) => tab.workspaceInstanceKey)
  }, [openTabs])
  const keysOtherThan = useCallback((key: string | null): readonly string[] =>
    openTabs.filter((tab) => tab.workspaceInstanceKey !== key).map((tab) => tab.workspaceInstanceKey), [openTabs])

  /**
   * P2-15：「分离到新窗口」的可见原因。**任一**不满足即禁用并给出**可见原因**，绝不静默灰掉、也绝不
   * 静默失败：没有锚点 Tab / 页面不在 shell 投影里 / 页面声明不可分离 / 该实例已在独立窗口。
   * （「有权管理该实例」由生产路径保证：strip 只在主窗渲染，`detachTab` 的准入仍由 Main 判定。）
   */
  const detachDisabledReason = useCallback((key: string | null): string | null => {
    if (key === null) return labels.tabDetachUnavailable
    const tab = props.state.tabs.find((entry) => entry.workspaceInstanceKey === key)
    if (tab === undefined) return labels.tabDetachUnavailable
    const descriptor = descriptors.get(tab.pageId)
    if (descriptor === undefined) return labels.tabPageMissing
    if (descriptor.supportsDetached !== true) return labels.tabDetachUnsupported
    if (tab.mode === 'detached') return labels.tabDetachAlreadyDetached
    return null
  }, [descriptors, labels.tabDetachAlreadyDetached, labels.tabDetachUnavailable, labels.tabDetachUnsupported, labels.tabPageMissing, props.state.tabs])

  const buildTabMenuItems = useCallback((key: string | null): WorkspaceTabMenuItem[] => {
    const detachReason = detachDisabledReason(key)
    return [
      {
        id: 'close',
        label: labels.tabClose,
        icon: X,
        disabled: key === null,
        disabledReason: labels.tabCloseUnavailable
      },
      {
        id: 'close-others',
        label: labels.tabCloseOthers,
        disabled: keysOtherThan(key).length === 0,
        disabledReason: labels.tabCloseOthersUnavailable
      },
      {
        id: 'close-right',
        label: labels.tabCloseRight,
        disabled: keysRightOf(key).length === 0,
        disabledReason: labels.tabCloseRightUnavailable
      },
      {
        id: 'reopen',
        label: labels.tabReopen,
        icon: RotateCcw,
        disabled: props.recentlyClosedCount === 0,
        disabledReason: labels.tabReopenUnavailable
      },
      {
        id: 'detach',
        label: labels.tabDetach,
        icon: PictureInPicture2,
        disabled: detachReason !== null,
        // 禁用项必须带可见原因；可用项不带 title（避免把「为什么可用」当提示）
        ...(detachReason === null ? {} : { disabledReason: detachReason })
      }
    ]
  }, [detachDisabledReason, keysOtherThan, keysRightOf, labels, props.recentlyClosedCount])

  const onTabMenuSelect = useCallback((id: string, key: string | null): void => {
    // 「重开」不依赖锚点 Tab：空工作区（最后一个 Tab 刚关闭）必须仍然可用
    if (id === 'reopen') {
      void run(() => props.port.reopenLastClosed())
      return
    }
    if (key === null) return
    if (id === 'close') closeOne(key)
    else if (id === 'close-others') void guardedClose(keysOtherThan(key), () => props.port.closeOthers({ workspaceInstanceKey: key }))
    else if (id === 'close-right') void guardedClose(keysRightOf(key), () => props.port.closeRight({ workspaceInstanceKey: key }))
    else if (id === 'detach') {
      void run(
        () => props.port.detachTab({ workspaceInstanceKey: key }),
        (errorCode) => (errorCode === 'limit-reached' ? labels.tabDetachLimitReached : labels.tabCommandRejected)
      )
    }
  }, [closeOne, guardedClose, keysOtherThan, keysRightOf, labels.tabCommandRejected, labels.tabDetachLimitReached, props.port, run])

  return (
    <div className="workspace-tab-strip" data-workspace-tab-strip="ready">
      <div className="workspace-tab-strip-bar" onKeyDown={onTabBarKeyDown}>
        <div
          className="workspace-tablist"
          role="tablist"
          aria-label={labels.tabStrip}
          aria-orientation="horizontal"
          onKeyDown={onTablistKeyDown}>
          {openTabs.map((tab) => {
            const descriptor = descriptors.get(tab.pageId)
            const ids = workspaceTabElementIds(tab.workspaceInstanceKey)
            const active = tab.workspaceInstanceKey === activeKey
            const Icon = descriptor?.icon
            return (
              <div
                key={tab.workspaceInstanceKey}
                className="workspace-tab-item"
                data-tab-item={tab.workspaceInstanceKey}
                data-active={active ? 'true' : 'false'}
                onContextMenu={(event) => {
                  // 右键是**用户可见入口**：必须真的打开菜单（此前右键完全无反应），并抑制宿主默认菜单
                  event.preventDefault()
                  event.stopPropagation()
                  openTabContextMenu(tab.workspaceInstanceKey, event.clientX, event.clientY)
                }}>
                <button
                  ref={(node) => { tabRefs.current[tab.workspaceInstanceKey] = node }}
                  type="button"
                  role="tab"
                  id={ids.tabId}
                  className="workspace-tab"
                  aria-selected={active}
                  aria-controls={ids.panelId}
                  // 上下文菜单的触发器就是这个 Tab：ARIA 展开态必须如实反映菜单开合
                  aria-haspopup="menu"
                  aria-expanded={tabMenu?.workspaceInstanceKey === tab.workspaceInstanceKey}
                  tabIndex={tab.workspaceInstanceKey === tabbableKey ? 0 : -1}
                  title={descriptor?.label ?? labels.tabPageMissing}
                  data-tab-key={tab.workspaceInstanceKey}
                  data-page-id={tab.pageId}
                  {...(descriptor === undefined ? { 'data-page-missing': 'true' } : {})}
                  onFocus={() => setFocusedKey(tab.workspaceInstanceKey)}
                  onClick={() => activate(tab.workspaceInstanceKey)}>
                  {Icon ? <Icon size={14} strokeWidth={1.8} /> : null}
                  <span>{descriptor?.label ?? labels.tabPageMissing}</span>
                </button>
                <button
                  type="button"
                  className="workspace-tab-close"
                  aria-label={`${labels.tabClose}: ${descriptor?.label ?? labels.tabPageMissing}`}
                  title={labels.tabClose}
                  tabIndex={-1}
                  onClick={() => closeOne(tab.workspaceInstanceKey)}>
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            )
          })}
        </div>
        {tabMenu === null ? null : (
          <WorkspaceTabMenu
            // 每次打开都是新实例：菜单的内部开合状态与锚点绝不跨次复用（同一 Tab 反复右键也成立）
            key={`context:${tabMenu.workspaceInstanceKey}:${tabMenu.nonce}`}
            label={labels.tabActions}
            menuLabel={labels.tabActions}
            icon={ChevronDown}
            items={buildTabMenuItems(tabMenu.workspaceInstanceKey)}
            onSelect={(id) => onTabMenuSelect(id, tabMenu.workspaceInstanceKey)}
            contextMenu
            anchor={{ x: tabMenu.x, y: tabMenu.y }}
            onClose={() => setTabMenu(null)}
            returnFocusTarget={() => tabRefs.current[tabMenu.workspaceInstanceKey] ?? null}
            triggerAttributes={{ 'data-tab-context-menu': 'true' }}
          />
        )}
        <div className="workspace-tab-strip-actions">
          <WorkspaceTabMenu
            label={labels.tabOpenPage}
            icon={Plus}
            items={openPageMenuItems}
            onSelect={(id) => { void run(() => props.port.openTab({ pageId: id.slice('page:'.length) })) }}
            triggerAttributes={{ 'data-tab-strip-open-page': 'true' }}
          />
          <WorkspaceTabMenu
            label={labels.tabActions}
            icon={ChevronDown}
            items={buildTabMenuItems(anchorKey)}
            onSelect={(id) => onTabMenuSelect(id, anchorKey)}
            triggerAttributes={{ 'data-tab-strip-actions': 'true' }}
          />
        </div>
      </div>
      {notice === null ? null : <div role="status" className="workspace-tab-notice">{notice}</div>}
      {props.children}
      {pending === null || guard === undefined ? null : guard.renderPrompt({
        workspaceInstanceKey: pending.workspaceInstanceKey,
        probe: pending.probe,
        pending: busy,
        onDecision: (decision) => deferredRef.current?.resolve(decision)
      })}
    </div>
  )
}
