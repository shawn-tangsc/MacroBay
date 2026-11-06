/**
 * Owner: apps/desktop-shell renderer / shell/workspace。
 *
 * Tab 权威在渲染侧的**唯一入口**：受控 `.tabs.*` 桥 → client → 快照 state。
 * 从 `AppShell` 抽出来的理由有两条，都不是「好看」：
 *
 *  1. 首次落点（默认首页，`docs-private/10-development/home-menu-contract.md`）必须挂在
 *     「没有可恢复的活动页」这个判定点上，而那个点只存在于 adopt 里；它属于 Tab 会话，不属于壳层排版。
 *  2. `AppShell` 有体积基线（`check:file-size` 只减不增），功能不许再把行数加回去。
 *
 * 语义一条没改：没有桥（既有 shell 单测注入的 platform 不含 workspace）时 `clientRef.current === null`，
 * 壳层照旧走「直接切页」；本模块绝不复制一份 Tab 权威。
 */
import { useEffect, useRef, useState, type RefObject } from 'react'

import type { WorkspaceTabState } from '@platform/workspace/contracts'

import { reportNavFallback } from '../notifications/notificationDeeplinkWiring'
import { createWorkspaceTabClient, readWorkspaceTabsBridge, type WorkspaceTabClient } from './workspaceClient'

export interface WorkspaceTabSession {
  /** 受控桥存在时才有 client；壳层靠它区分「Tab 权威可用」与「直接切页兜底」。 */
  clientRef: RefObject<WorkspaceTabClient | null>
  state: WorkspaceTabState | null
  /**
   * 打开/激活一个菜单页（壳层点菜单、通知深链都走它）。返回值就是「到底开没开」：
   *  - `applied`  —— 已采用权威快照（页面真的打开了）；
   *  - `rejected` —— **没有**打开；已按 error 级记下 `errorCode`，且**绝不采用**拒绝投影；
   *  - `no-bridge`—— 这个渲染环境没有受控 `.tabs.*` 桥，调用方走既有的「只切高亮」兜底。
   */
  openMenuPage: (menuKey: string) => Promise<'applied' | 'rejected' | 'no-bridge'>
}

export function useWorkspaceTabSession(input: {
  /** 首次落点：菜单声明 `home` → 菜单 `order` 第一项 → 壳层兜底常量。 */
  landingNavKey: string
  /** 顶栏/侧栏高亮跟随权威活动项（menuKey 就是导航键）；本 hook 不持有第二份「当前页」。 */
  onActiveMenuKey: (menuKey: string) => void
}): WorkspaceTabSession {
  const { landingNavKey, onActiveMenuKey } = input
  const clientRef = useRef<WorkspaceTabClient | null>(null)
  const [state, setState] = useState<WorkspaceTabState | null>(null)

  /**
   * Tab 命令的**唯一**出口：只有「真的 applied」才写回快照。
   *
   * 拒绝是**返回值**（`status: 'rejected'` + `errorCode`），不是异常 —— `catch` 一个字都接不到；而它带的
   * snapshot 是「被拒那一刻的作用域投影」，未授权 sender 的那份是**空的**。把空投影写进 state，就会把已经
   * 开着的页签从界面上抹掉：症状是「点一下菜单，整页变成『当前没有打开的页面』」（2026-11-06 真机踩过）。
   * 所以这里只做两件事：applied 才采用快照；其余一律按 error 级留下 `errorCode`（应用日志只收 console.error）。
   */
  const openMenuPage = async (menuKey: string): Promise<'applied' | 'rejected' | 'no-bridge'> => {
    const client = clientRef.current
    if (client === null) return 'no-bridge'
    try {
      const result = await client.port.openTab({ menuKey })
      if (result.status === 'rejected') {
        reportNavFallback(menuKey, { status: result.status, errorCode: result.errorCode })
        return 'rejected'
      }
      setState(result.snapshot)
      return 'applied'
    } catch (error: unknown) {
      // 抛出（无权威 revision / 响应畸形 / 桥不在）同样是「没打开」，必须留下 error 级证据。
      reportNavFallback(menuKey, error)
      return 'rejected'
    }
  }

  useEffect(() => {
    const bridge = readWorkspaceTabsBridge()
    if (bridge === null) return
    const client = createWorkspaceTabClient(bridge)
    clientRef.current = client
    let cancelled = false
    /**
     * 首次落点是否已有答案：读到过活动页、或已经补开过一次，就永不再补。
     *
     * 只在**第一次**权威快照上补开首页。此后快照里没有活动页，是用户自己关掉了最后一页——
     * 那不是「没有历史」，补开就变成「关掉立刻弹回来」。
     */
    let landingDecided = false
    const adopt = (next: WorkspaceTabState | null): void => {
      if (cancelled || next === null) return
      setState(next)
      const active = next.tabs.find((tab) => tab.open && tab.workspaceInstanceKey === next.activeWorkspaceInstanceKey)
      if (active !== undefined) {
        landingDecided = true
        onActiveMenuKey(active.menuKey)
        return
      }
      /**
       * 没有可恢复的活动页 = 「首次打开 / 布局被重置」在运行时的**唯一判定点**
       * （`resolveRestoredActiveKey` 已经把「页已不在菜单里」处理成「剪掉后换第一个存活页 / 换不到 ⇒ null」，
       * 壳层不许再判一次布局文件在不在、tabs 空不空）。
       *
       * 口径 A（用户 2026-11-06 选）：这里补开首页；**已有活动页时一律不动**，所以「接着上次看」不受影响。
       */
      if (landingDecided) return
      landingDecided = true
      void openMenuPage(landingNavKey)
    }
    void client.load().then(adopt)
    const stop = client.observe(adopt)
    return () => {
      cancelled = true
      stop()
      client.dispose()
      clientRef.current = null
    }
    // `landingNavKey` 由菜单注册决定、不随会话变化；`onActiveMenuKey` 是 setter，引用稳定。
  }, [landingNavKey, onActiveMenuKey])

  return { clientRef, state, openMenuPage }
}
