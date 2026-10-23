import type { ReactNode } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { WorkspaceTabSnapshot, WorkspaceTabState } from '@platform/workspace/contracts'
import { platformText } from '../../i18n/platformText'

/**
 * Owner: apps/desktop-shell renderer / workspace 页面宿主（P2-02）。
 * 权威：技术设计 §3（一个 workspaceInstanceKey = 一个逻辑页面）、§6（容器移动只重新 attach/订阅）、
 * §5.4（Tab 视图）、A-T02「最后 Tab 后空工作区仍可打开菜单」。
 *
 * 职责边界：
 *  - 只把**受控** P2-01 快照投影成 tabpanel；**不**维护第二份 tab/布局状态，也不派生自己的顺序；
 *  - 所有 `open` 的实例同时挂载，非活动项用 `hidden` 就地隐藏 ⇒ 切换 Tab 不重建页面、不丢表单草稿
 *    （业务数据仍由各自 owner 持有，这里只保证视图不被无谓卸载）；
 *  - 关闭的实例立即卸载（释放视图，业务数据删除由内容 owner 负责，A-T04）；
 *  - 未注册/无渲染器的页面 **fail closed 但绝不隐藏 Tab**：给出成对 i18n 安全壳并标记 `data-page-missing`。
 */

export type WorkspacePageHostProps = {
  language: AppLanguage
  state: WorkspaceTabState
  /** 页面正文提供方（P2-03 接通真实 loader 前由组合根注入）。返回 null ⇒ 安全壳。 */
  renderPage: (input: { tab: WorkspaceTabSnapshot; active: boolean }) => ReactNode | null
}

/** tab 与 tabpanel 的 DOM id 唯一来源；strip 与宿主共用，避免两处各拼一套。 */
export function workspaceTabElementIds(workspaceInstanceKey: string): { tabId: string; panelId: string } {
  return {
    tabId: `workspace-tab-${workspaceInstanceKey}`,
    panelId: `workspace-tabpanel-${workspaceInstanceKey}`
  }
}

export function WorkspacePageHost(props: WorkspacePageHostProps): React.ReactElement {
  const labels = platformText[props.language].workspace
  const openTabs = props.state.tabs.filter((tab) => tab.open)

  if (openTabs.length === 0) {
    return (
      <section className="workspace-page-host workspace-page-host-empty" data-workspace-page-host="empty" role="status">
        <h1>{labels.tabEmptyTitle}</h1>
        <p>{labels.tabEmptyHint}</p>
      </section>
    )
  }

  return (
    <div className="workspace-page-host" data-workspace-page-host="tabs">
      {openTabs.map((tab) => {
        const active = tab.workspaceInstanceKey === props.state.activeWorkspaceInstanceKey
        const ids = workspaceTabElementIds(tab.workspaceInstanceKey)
        const content = props.renderPage({ tab, active })
        return (
          <section
            key={tab.workspaceInstanceKey}
            id={ids.panelId}
            role="tabpanel"
            aria-labelledby={ids.tabId}
            tabIndex={active ? 0 : -1}
            hidden={!active}
            className="workspace-page-host-panel"
            data-workspace-tab={tab.workspaceInstanceKey}
            data-page-id={tab.pageId}
            data-active={active ? 'true' : 'false'}
            {...(content === null ? { 'data-page-missing': 'true' } : {})}>
            {content ?? <p className="workspace-page-placeholder">{labels.tabPageMissing}</p>}
          </section>
        )
      })}
    </div>
  )
}
