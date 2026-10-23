import { Button, Tooltip } from 'antd'
import { Maximize2, Menu, Minimize2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Search } from 'lucide-react'

import type { AgentSessionPanelPosition, ChatSettings } from '@platform/settings/schema/appSettings'
import { useAgentText } from './agentTextProvider'

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
        <Tooltip title={sidebarLabel}>
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
          <Tooltip title={t.navbar.openSessions}>
            <Button className="ant-shell-icon-button" type="text" size="small" icon={<Menu size={17} />} onClick={onOpenSidePanelDrawer} />
          </Tooltip>
        ) : null}
      </div>

      <div className="agent-navbar-center" />

      <div className="agent-navbar-right">
        <Tooltip title={t.navbar.search}>
          <Button className="ant-shell-icon-button" type="text" size="small" icon={<Search size={17} />} onClick={onSearch} aria-label={t.navbar.search} />
        </Tooltip>
        <Tooltip title={chatSettings?.narrowMode ? t.messageNavigation.none : t.settingsDrawer.narrowMode}>
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
