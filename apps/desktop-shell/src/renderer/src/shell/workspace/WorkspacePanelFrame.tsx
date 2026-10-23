import type { ReactNode } from 'react'
import { Tabs } from 'antd'
import type { MenuProps } from 'antd'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { PanelContainerMode, WorkspaceSize } from '@platform/workspace/contracts'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { platformText } from '../../i18n/platformText'
import { useWorkspaceSplitter } from './useWorkspaceSplitter'
import {
  panelSizeBounds,
  type DockedMode,
  type WorkspacePresentation,
  type WorkspaceRegion
} from './workspacePresentation'
import { WorkspacePanelToolbar } from './WorkspacePanelToolbar'

/**
 * Owner: apps/desktop-shell renderer / workspace 单个面板的稳定挂载帧。
 * 权威：P1-03 纠偏裁决 §4（[data-panel-key] 稳定挂载、style.gridArea、hidden 不卸载、dataset.presentation）。
 *
 * 关键不变量：
 *  - 帧元素由 panelInstanceKey 稳定 key 化，换区域/换 Tab 只改 gridArea 与 hidden，不卸载内容子树；
 *  - 面板状态全部来自 props（权威 snapshot），帧内不保留第二份 layout/active/open 权威；
 *  - 分隔条只处理自己轴的键盘，正文输入与 IME 不受影响。
 *
 * 回归：WorkspacePanelHost.test.tsx。
 */

export type WorkspacePanelTab = { panelKey: string; title: string }

export type WorkspacePanelFrameProps = {
  panelKey: string
  mode: PanelContainerMode
  region: WorkspaceRegion
  presentation: WorkspacePresentation
  gridArea: 'embedded' | 'page' | 'right' | 'bottom'
  hidden: boolean
  title: string
  language: AppLanguage
  content: ReactNode
  size: WorkspaceSize
  pageSize: WorkspaceSize
  pageMinSize: WorkspaceSize
  panelMinSize: WorkspaceSize
  supportedModes: readonly PanelContainerMode[]
  detachAvailable: boolean
  tabs: readonly WorkspacePanelTab[]
  activePanelKey: string | undefined
  onActivate: (panelKey: string) => void
  onSwitchContainer: (mode: PanelContainerMode) => void
  onResetSize: () => void
  onClose: () => void
  onPreviewSize: (size: WorkspaceSize | null) => void
  onResizeCommit: (size: WorkspaceSize) => void
  onReturnToPage: () => void
}

const modeOrder = ['embedded', 'docked-right', 'docked-bottom', 'detached'] as const

export function WorkspacePanelFrame(props: WorkspacePanelFrameProps): React.ReactElement {
  const labels = platformText[props.language].workspace
  const docked: DockedMode | null = props.presentation === 'normal' && (props.region === 'right' || props.region === 'bottom')
    ? (props.region === 'right' ? 'docked-right' : 'docked-bottom')
    : null
  const splitter = useWorkspaceSplitter({
    mode: docked,
    size: props.size,
    pageSize: props.pageSize,
    pageMinSize: props.pageMinSize,
    panelMinSize: props.panelMinSize,
    onPreview: props.onPreviewSize,
    onCommit: props.onResizeCommit
  })
  const bounds = docked ? panelSizeBounds(props.region as 'right' | 'bottom', props.pageSize, props.pageMinSize, props.panelMinSize) : null
  const currentAxisSize = props.region === 'right'
    ? (splitter.previewSize ?? props.size).width
    : (splitter.previewSize ?? props.size).height

  const menuItems: MenuProps['items'] = [
    ...modeOrder.map((mode) => {
      const modeSupported = props.supportedModes.includes(mode)
      const capabilityMissing = mode === 'detached' && !props.detachAvailable
      return {
        key: mode,
        label: modeLabel(mode, labels),
        disabled: props.mode === mode || !modeSupported || capabilityMissing,
        ...(modeSupported ? (capabilityMissing ? { title: labels.panelCapabilityMissing } : {}) : { title: labels.panelModeUnsupported })
      }
    }),
    { type: 'divider' as const },
    { key: 'reset', label: labels.panelResetSize, disabled: props.region === 'embedded' }
  ]

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'reset') {
      props.onResetSize()
      return
    }
    props.onSwitchContainer(key as PanelContainerMode)
  }

  const onFrameKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (props.presentation === 'normal') return
    if (isTextEntryTarget(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    props.onReturnToPage()
  }

  return (
    <section
      className="workspace-panel-frame"
      data-panel-key={props.panelKey}
      data-dock={props.mode}
      data-region={props.region}
      data-presentation={props.presentation}
      data-splitter={docked ? 'true' : 'false'}
      hidden={props.hidden}
      role="region"
      aria-label={props.title}
      style={{ gridArea: props.gridArea }}
      onKeyDown={onFrameKeyDown}
    >
      <WorkspacePanelToolbar
        title={props.title}
        actionsLabel={labels.panelActions}
        closeLabel={labels.panelClose}
        menuItems={menuItems}
        onMenuClick={onMenuClick}
        onClose={props.onClose}
        returnToPage={props.presentation === 'normal' ? undefined : { label: labels.panelReturnToPage, onClick: props.onReturnToPage }}
      />
      {props.tabs.length > 1 ? (
        <div className="workspace-panel-tabs" style={{ gridArea: 'tabs' }}>
          <Tabs
            size="small"
            activeKey={props.activePanelKey}
            onChange={(key) => props.onActivate(key)}
            items={props.tabs.map((tab) => ({ key: tab.panelKey, label: tab.title }))}
          />
        </div>
      ) : null}
      <div className="workspace-panel-body" style={{ gridArea: 'body' }}>
        <ShellLanguageProvider language={props.language}>{props.content}</ShellLanguageProvider>
      </div>
      {docked && bounds ? (
        <div
          className="workspace-panel-splitter"
          role="separator"
          tabIndex={0}
          aria-label={labels.panelResize}
          aria-orientation={props.region === 'right' ? 'vertical' : 'horizontal'}
          aria-valuemin={props.region === 'right' ? bounds.min.width : bounds.min.height}
          aria-valuemax={props.region === 'right' ? bounds.max.width : bounds.max.height}
          aria-valuenow={currentAxisSize}
          data-splitter-region={props.region}
          style={{ gridArea: 'splitter' }}
          {...splitter.separatorProps}
        />
      ) : null}
    </section>
  )
}

function modeLabel(mode: PanelContainerMode, labels: (typeof platformText)['en-US']['workspace']): string {
  if (mode === 'embedded') return labels.panelEmbedded
  if (mode === 'docked-right') return labels.panelDockRight
  if (mode === 'docked-bottom') return labels.panelDockBottom
  return labels.panelDetach
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}
