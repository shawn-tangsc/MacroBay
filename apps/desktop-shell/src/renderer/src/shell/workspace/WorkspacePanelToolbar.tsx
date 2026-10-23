import { Button, Dropdown, Tooltip, type MenuProps } from 'antd'
import { CornerDownLeft, ChevronDown, X } from 'lucide-react'

/**
 * Owner: apps/desktop-shell renderer / workspace 面板工具栏。
 * 权威：P1-03 纠偏裁决 §4（toolbar 用真实 AntD 组件 + lucide 图标）。
 * 菜单可用性与禁用原因由调用方（Frame）依据注册 supportedModes 与 port 能力计算。
 * 回归：WorkspacePanelHost.test.tsx。
 */

export type WorkspacePanelToolbarProps = {
  title: string
  actionsLabel: string
  closeLabel: string
  menuItems: MenuProps['items']
  onMenuClick: MenuProps['onClick']
  onClose: () => void
  /** 窄屏（overlay/exclusive）下的真实「返回页面」入口。 */
  returnToPage?: { label: string; onClick: () => void }
}

export function WorkspacePanelToolbar(props: WorkspacePanelToolbarProps): React.ReactElement {
  return (
    <header className="workspace-panel-toolbar">
      <span className="workspace-panel-title">{props.title}</span>
      <div className="workspace-panel-actions">
        {props.returnToPage ? (
          <Tooltip title={props.returnToPage.label}>
            <Button
              aria-label={props.returnToPage.label}
              title={props.returnToPage.label}
              icon={<CornerDownLeft size={14} />}
              onClick={props.returnToPage.onClick}
            />
          </Tooltip>
        ) : null}
        <Dropdown menu={{ items: props.menuItems, onClick: props.onMenuClick }} trigger={['click']}>
          <Button aria-label={props.actionsLabel} title={props.actionsLabel} icon={<ChevronDown size={14} />} />
        </Dropdown>
        <Tooltip title={props.closeLabel}>
          <Button aria-label={props.closeLabel} title={props.closeLabel} icon={<X size={14} />} onClick={props.onClose} />
        </Tooltip>
      </div>
    </header>
  )
}
