import { Button, Dropdown, type MenuProps } from 'antd'
import { CornerDownLeft, ChevronDown, X } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'

/**
 * Owner: apps/desktop-shell renderer / workspace 面板工具栏。
 * 权威：P1-03 纠偏裁决 §4（toolbar 用真实 AntD 组件 + lucide 图标）。
 * 菜单可用性与禁用原因由调用方（Frame）依据注册 supportedModes 与 port 能力计算。
 * 回归：WorkspacePanelHost.test.tsx。
 */

/**
 * 三个按钮的文案键。**句子不由调用方传**：它们都是壳层固定文案，句子只该存在 `platformText.workspace`
 * 一处，调用方给的是「解析器」而不是「三句话」。
 *
 * 为什么这件事重要：按钮要换成平台 `IconButton`（`ariaLabelKey` + `resolveText`），而旧签名收的是
 * 已解析的字符串，接上去只能写 `resolveText={() => '关闭面板'}`——同一句话两句出处。键在这里是闭集：
 * 写错一个键，`tsc` 直接红。
 */
export const WORKSPACE_PANEL_TEXT_KEYS = [
  'workspace.panelActions',
  'workspace.panelClose',
  'workspace.panelReturnToPage'
] as const

export type WorkspacePanelTextKey = (typeof WORKSPACE_PANEL_TEXT_KEYS)[number]

export type WorkspacePanelToolbarProps = {
  title: string
  menuItems: MenuProps['items']
  onMenuClick: MenuProps['onClick']
  onClose: () => void
  /** 窄屏（overlay/exclusive）下的真实「返回页面」入口；文案由 `resolveText` 给。 */
  returnToPage?: { onClick: () => void }
  /** 解析壳层文案键；由调用方注入，组件自己不持有任何句子、也不认识语言。 */
  resolveText: (key: WorkspacePanelTextKey) => string
}

export function WorkspacePanelToolbar(props: WorkspacePanelToolbarProps): React.ReactElement {
  const actionsLabel = props.resolveText('workspace.panelActions')
  // `IconButton` 的解析器收开区间 string；这里只接受闭集里的三个键，写错仍在 `tsc` 红。
  const resolveIconText = (key: string): string => props.resolveText(key as WorkspacePanelTextKey)
  return (
    <header className="workspace-panel-toolbar">
      <span className="workspace-panel-title">{props.title}</span>
      <div className="workspace-panel-actions">
        {props.returnToPage ? (
          <IconButton
            ariaLabelKey="workspace.panelReturnToPage"
            icon={CornerDownLeft}
            onSelect={props.returnToPage.onClick}
            resolveText={resolveIconText}
            size="md"
            tooltipKey="workspace.panelReturnToPage"
          />
        ) : null}
        <Dropdown menu={{ items: props.menuItems, onClick: props.onMenuClick }} trigger={['click']}>
          <Button aria-label={actionsLabel} title={actionsLabel} icon={<ChevronDown size={14} />} />
        </Dropdown>
        <IconButton
          ariaLabelKey="workspace.panelClose"
          icon={X}
          onSelect={props.onClose}
          resolveText={resolveIconText}
          size="md"
          tooltipKey="workspace.panelClose"
        />
      </div>
    </header>
  )
}
