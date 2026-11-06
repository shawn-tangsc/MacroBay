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
  /** 壳层自己发出的 Tab 命令回的权威快照也走这里写回（不维护第二份）。 */
  setState: (next: WorkspaceTabState) => void
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
      void client.port.openTab({ menuKey: landingNavKey })
        .then((result) => { if (!cancelled) setState(result.snapshot) })
        // 被拒（key 不在注册表）时目标页打不开：开发期必须吵一声，否则症状只剩「首次打开是空白」
        .catch((error: unknown) => { reportNavFallback(landingNavKey, error) })
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

  return { clientRef, state, setState }
}
