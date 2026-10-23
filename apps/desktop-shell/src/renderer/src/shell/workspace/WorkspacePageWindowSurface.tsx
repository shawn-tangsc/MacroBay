import { useMemo } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { WorkspaceTabSnapshot } from '@platform/workspace/contracts'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { PageWindowRedockControl } from './PageWindowRedockControl'
import { resolveWindowPageChrome, useWindowDocumentTitle, WorkspaceWindowTopBar } from './workspaceWindowTopBar'
import { WorkspacePageHost } from './WorkspacePageHost'
import { createWorkspacePageContentProvider } from './workspacePageContentProvider'
import type { WorkspaceTabClient } from './workspaceClient'

/**
 * Owner: apps/desktop-shell renderer / workspace —— **页面窗内容面**（P2-03 F1）。
 *
 * PLAT-02 行数纪律：本面原先内联在 `WorkspaceWindowRoot.tsx`；它与「页面窗根（`.workspace-window-page`）
 * + 正文宿主 + 回停靠控件」同族，因此独立成文件。**搬运纪律：DOM/属性/相位语义逐字不变**
 * （P2-15 已把右上角回停靠悬浮控件抽到 `PageWindowRedockControl.tsx`；本面仍负责页面窗根与正文宿主）。
 *
 * 正文 provider 只接**受控 IPC**（`settings.get`/`modelProviders.list`/`agents.*`/`assistants.*` 订阅 +
 * 产品 loader 动态 import），因此页面数据仍以 Main 为权威、没有第二份状态；渲染不出来时
 * `WorkspacePageHost` 给出成对 i18n 安全壳（`data-page-missing`），绝不伪造正文。
 * 外层属性是页面窗的诊断/归属证据（窗口身份 + 页面身份），不承载任何布局权限。
 *
 * PLAT-03：`layoutRevision` 必须是**权威 Tab store revision**（`.tabs.getSnapshot` 受控投影
 * `WorkspaceTabState.layoutRevision` 的真实值），由 `WorkspaceWindowRoot` 在同一次权威读取里随快照下发。
 */

/**
 * 独立**页面**窗的内容面（P2-03 F1）：挂载该 Tab 的**真实页面正文**。
 *
 * 正文 provider 只接**受控 IPC**（`settings.get`/`modelProviders.list`/`agents.*`/`assistants.*` 订阅 +
 * 产品 loader 动态 import），因此页面数据仍以 Main 为权威、没有第二份状态；渲染不出来时
 * `WorkspacePageHost` 给出成对 i18n 安全壳（`data-page-missing`），绝不伪造正文。
 * 外层属性是页面窗的诊断/归属证据（窗口身份 + 页面身份），不承载任何布局权限。
 *
 * P2-15：右上角的**回停靠**悬浮控件已按 PLAT-02 行数纪律抽到 `PageWindowRedockControl.tsx`
 * （DOM/内联样式/相位语义逐字不变）；本面仍负责页面窗根（`.workspace-window-page`）与正文宿主。
 *
 * PLAT-03：本面交给 `WorkspacePageHost` 的 `state.layoutRevision` 必须是**权威 Tab store revision**
 * （`.tabs.getSnapshot` 受控投影 `WorkspaceTabState.layoutRevision`，Main 的真实值），由 `WorkspaceWindowRoot`
 * 在同一次权威读取里随快照一起下发。此前这里写的是 `tab.order`（Tab 在条带里的**位置**，另一个值空间）：
 * 那不是 revision，既与权威不一致，也无法区分「顺序相同、revision 不同」的两个 Tab。
 */
export function WorkspacePageWindowSurface({ language, timeZone, tab, layoutRevision, tabClient }: {
  language: AppLanguage
  timeZone: string
  tab: WorkspaceTabSnapshot
  /** 权威 Tab store revision（来自同一次受控快照读取；renderer 绝不自造/推导）。 */
  layoutRevision: number
  tabClient: WorkspaceTabClient
}): React.ReactElement {
  const provider = useMemo(() => createWorkspacePageContentProvider(), [])
  /**
   * PLAT-39 ①：页面名/图标取 shell 的**同一来源**（`mergeShellNavItems`），并设置为**原生标题**
   * （`document.title` ⇒ Electron 窗口标题；darwin `hiddenInset` 下由顶栏可见承载）。
   */
  const chrome = useMemo(
    () => resolveWindowPageChrome({ pageId: tab.pageId, menuKey: tab.menuKey, language }),
    [tab.pageId, tab.menuKey, language]
  )
  useWindowDocumentTitle(chrome.title)
  // 只有一个实例的受控快照：宿主语义（tablist/tabpanel、非活动就地隐藏）与主窗完全一致
  const state = useMemo(() => Object.freeze({
    layoutRevision, activeWorkspaceInstanceKey: tab.workspaceInstanceKey,
    tabs: Object.freeze([tab])
  }), [tab, layoutRevision])
  return (
    <ShellLanguageProvider language={language}>
    <ShellTimeZoneProvider timeZone={timeZone}><section
      className="workspace-window-shell workspace-window-page"
      role="region"
      aria-label={chrome.title}
      data-window-shell="page"
      data-workspace-tab={tab.workspaceInstanceKey}
      data-page-id={tab.pageId}
      data-page-menu-key={tab.menuKey}>
      <WorkspaceWindowTopBar
        title={chrome.title}
        icon={chrome.icon}
        actions={
          <PageWindowRedockControl
            language={language}
            workspaceInstanceKey={tab.workspaceInstanceKey}
            detached={tab.mode === 'detached'}
            redockTab={tabClient.port.redockTab}
          />
        }
      />
      <WorkspacePageHost
        language={language}
        state={state}
        renderPage={({ tab: activeTab }) => provider.render({
          pageId: activeTab.pageId, menuKey: activeTab.menuKey, language, active: true
        })}
      />
    </section>
    </ShellTimeZoneProvider>
    </ShellLanguageProvider>
  )
}
