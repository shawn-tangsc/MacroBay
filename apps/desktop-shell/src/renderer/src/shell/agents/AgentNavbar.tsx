import { Button } from 'antd'
import { Maximize2, Menu, Minimize2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Search } from 'lucide-react'

import type { AgentSessionPanelPosition, ChatSettings } from '@platform/settings/schema/appSettings'
import { Tooltip } from '@platform/ui/components/tooltip'

import { useAgentText } from './agentTextProvider'
import { resolveAgentTooltipText, type AgentTooltipKey } from './agentTooltipText'

type AgentNavbarProps = {
  showSidebar: boolean
  sessionPanelPosition: AgentSessionPanelPosition
  chatSettings: ChatSettings | null
  onToggleSidebar: () => void
  onOpenSidePanelDrawer: () => void
  onToggleNarrowMode: () => void
  onSearch: () => void
}

export default function AgentNavbar({
  showSidebar,
  sessionPanelPosition,
  chatSettings,
  onToggleSidebar,
  onOpenSidePanelDrawer,
  onToggleNarrowMode,
  onSearch
}: AgentNavbarProps): React.ReactElement {
  const t = useAgentText()
  const sidebarLabel = showSidebar ? t.navbar.hideSidebar : t.navbar.showSidebar
  // 键取自闭合联合 `AgentTooltipKey`：写错一处编译就红。
  const tooltipKeys = {
    hideSidebar: 'navbar.hideSidebar',
    showSidebar: 'navbar.showSidebar',
    openSessions: 'navbar.openSessions',
    search: 'navbar.search',
    narrowNone: 'messageNavigation.none',
    narrowToggle: 'settingsDrawer.narrowMode'
  } as const satisfies Record<string, AgentTooltipKey>
  const resolveText = (key: AgentTooltipKey): string => resolveAgentTooltipText(t, key)
  const sidebarIcon =
    sessionPanelPosition === 'right'
      ? showSidebar
        ? <PanelRightClose size={17} />
        : <PanelRightOpen size={17} />
      : showSidebar
        ? <PanelLeftClose size={17} />
        : <PanelLeftOpen size={17} />

  return (
    <header className="agent-navbar">
      <div className="agent-navbar-left">
        <Tooltip labelKey={showSidebar ? tooltipKeys.hideSidebar : tooltipKeys.showSidebar} resolveText={resolveText}>
          <Button
            className="ant-shell-icon-button"
            type="text"
            size="small"
            icon={sidebarIcon}
            onClick={onToggleSidebar}
            aria-label={sidebarLabel}
          />
        </Tooltip>
        {!showSidebar ? (
          <Tooltip labelKey={tooltipKeys.openSessions} resolveText={resolveText}>
            <Button className="ant-shell-icon-button" type="text" size="small" icon={<Menu size={17} />} onClick={onOpenSidePanelDrawer} />
          </Tooltip>
        ) : null}
      </div>

      <div className="agent-navbar-center" />

      <div className="agent-navbar-right">
        <Tooltip labelKey={tooltipKeys.search} resolveText={resolveText}>
          <Button className="ant-shell-icon-button" type="text" size="small" icon={<Search size={17} />} onClick={onSearch} aria-label={t.navbar.search} />
        </Tooltip>
        <Tooltip labelKey={chatSettings?.narrowMode ? tooltipKeys.narrowNone : tooltipKeys.narrowToggle} resolveText={resolveText}>
          <Button
            className="ant-shell-icon-button"
            type="text"
            size="small"
            icon={chatSettings?.narrowMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            onClick={onToggleNarrowMode}
            aria-label={t.settingsDrawer.narrowMode}
          />
        </Tooltip>
      </div>
    </header>
  )
}
