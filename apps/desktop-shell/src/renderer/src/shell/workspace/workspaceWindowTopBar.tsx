import { useEffect, type ReactNode } from 'react'
import { FileText, type LucideIcon } from 'lucide-react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { WorkspaceWindowChromePolicy } from '@platform/workspace/policies'
import { productMenuEntries } from '@products/generated/shellRegistry'
import { mergeShellNavItems } from '../navigation/mergeShellNavigation'

/**
 * Owner: apps/desktop-shell renderer / workspace（**PLAT-39 ①**：分离窗的**自绘顶栏**与原生标题）。
 *
 * 真机定位（两条都是同一个根因的两个面）：
 *  1) 分离窗此前用 Electron **默认装饰**（原生标题栏）。真机实测主窗 `bounds.height - contentBounds.height = 0`
 *     （`hiddenInset`，`createMainWindow.ts:186`），分离窗 `= 28`（DIP）——**浅色 OS 外观 + 深色应用主题**下，
 *     那 28pt 就是用户看到的「白色标题条」；`capturePage()` 不含原生框，所以早期截图看不到它。
 *  2) 原生标题显示的是**应用名**：入口 HTML 的 `<title>`（`MacroBay 观潮`）
 *     会覆盖 `BrowserWindow` 的 `title` 选项（Electron 明确语义），因此 Main 侧传进去的页面名是**惰性**的。
 *
 * 修法（与主窗做法一致，且不新增 IPC 通道/preload 方法）：
 *  - 装饰对齐（主进程侧）：分离窗改用 `hiddenInset` ⇒ 不再有由 OS 绘制的标题条；
 *  - **页面名由本自绘顶栏承载**（darwin `hiddenInset` 下原生标题文字不可见），并在渲染侧设置
 *    `document.title = 本地化页面名` ⇒ 窗口切换器 / Dock / 任务栏（非 darwin 的系统标题栏）仍显示页面名；
 *  - 顶栏高度/左侧让位走 `WorkspaceWindowChromePolicy`（与主窗 `--topbar-height`/`--traffic-light-width` 同源），
 *    顶栏为拖拽区（`-webkit-app-region: drag`），其中的按钮一律 `no-drag`。
 */

/** 页面名/图标：与主窗 Tab 条/侧边栏**同一来源**（`mergeShellNavItems` + 产品清单），绝不另建文案表。 */
export function resolveWindowPageChrome(input: {
  pageId: string
  menuKey: string
  language: AppLanguage
}): { title: string; icon: LucideIcon } {
  const item = mergeShellNavItems(input.language, productMenuEntries)
    .find((entry) => entry.pageId === input.pageId || entry.menuKey === input.menuKey)
  // 注册表缺项（产品被卸载等）⇒ 退回 pageId：绝不显示空白标题
  return { title: item?.label ?? input.pageId, icon: item?.icon ?? FileText }
}

/**
 * 原生标题：`document.title` 就是 Electron 用于窗口标题的页面标题（`page-title-updated`）。
 * 主窗不调用本 hook（主窗标题仍是应用名，由入口 HTML 决定，与本包无关）。
 */
export function useWindowDocumentTitle(title: string): void {
  useEffect(() => { document.title = title }, [title])
}

export type WorkspaceWindowTopBarProps = {
  /** 已本地化的页面名/面板名（调用方负责解析；本组件不读任何来源）。 */
  title: string
  icon: LucideIcon
  /** 右侧动作（页窗＝回停靠；PLAT-40 起面板窗＝回停靠，两者都复用既有受控命令通道）。 */
  actions?: ReactNode
}

/**
 * 分离窗顶栏：**同一份 DOM/高度/token** 供页窗与面板窗复用（两窗视觉逐字一致）。
 * 高度只走命名策略，不出现匿名数字；颜色只走主题 token（无硬编码 app 级颜色）。
 */
export function WorkspaceWindowTopBar(props: WorkspaceWindowTopBarProps): React.ReactElement {
  const Icon = props.icon
  return (
    <header
      className="workspace-window-topbar"
      data-window-topbar="true"
      style={{ height: `var(${WorkspaceWindowChromePolicy.topBarHeightVar})` }}>
      <span className="workspace-window-topbar-icon" aria-hidden="true"><Icon size={13} strokeWidth={1.8} /></span>
      <span className="workspace-window-topbar-title" title={props.title}>{props.title}</span>
      <span className="workspace-window-topbar-actions">{props.actions}</span>
    </header>
  )
}
