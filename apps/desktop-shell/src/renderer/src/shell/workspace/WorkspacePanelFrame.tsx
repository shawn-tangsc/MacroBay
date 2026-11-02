import type { ReactNode } from 'react'
import type { MenuProps } from 'antd'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { PanelContainerMode, WorkspaceSize } from '@platform/workspace/contracts'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { Tabs } from '@platform/ui/components/tabs'
import { platformText } from '../../i18n/platformText'
import { useWorkspaceSplitter } from './useWorkspaceSplitter'
import {
  panelSizeBounds,
  type DockedMode,
  type WorkspacePresentation,
  type WorkspaceRegion
} from './workspacePresentation'
import { WorkspacePanelToolbar, type WorkspacePanelTextKey } from './WorkspacePanelToolbar'

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

/** 标签条那组的可访问名。面板标题来自注册表、不是键，所以只有这一个键走文案表。 */
const PANEL_TABS_LABEL_KEY = 'workspace.panelTabs'

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

  /*
   * 标签条（契约 §7）：`value` 用**面板实例 key**，不是下标——下标会随关闭/排序漂移，一旦存进布局就是错项。
   * 面板标题由模块注册时给出的那对已解析语言文本提供（`LocalizedText`，不是 i18n 键），所以 `labelKey`
   * 收的是同一个稳定标识，再由这一个解析器把它查回注册的标题；查不到退回通用「面板」，绝不把裸 key 上屏。
   */
  const panelTitles = new Map(props.tabs.map((tab) => [tab.panelKey, tab.title]))
  const tabItems = props.tabs.map((tab) => ({ value: tab.panelKey, labelKey: tab.panelKey }))
  const resolveTabText = (key: string): string =>
    key === PANEL_TABS_LABEL_KEY ? labels.panelTabs : (panelTitles.get(key) ?? labels.panelFallback)

  /*
   * 权威 active 可能指向刚关闭、本区域已不再列出的面板。此时回落到**本帧自己的 key**（它必定在清单里），
   * 而不是让组件兜底选第一个——兜底会对同区域每个隐藏帧各发一次激活命令，布局还没更新就先抖一轮。
   */
  const requested = props.activePanelKey
  const activeTabValue = requested !== undefined && panelTitles.has(requested) ? requested : props.panelKey
  const hasTabStrip = props.tabs.length > 1
  const panelContent = (
    <ShellLanguageProvider language={props.language}>{props.content}</ShellLanguageProvider>
  )
  /*
   * 面板正文**留在标签条外面**，位置固定：同区域的面板各自是一个帧，那些帧为了「换 Tab 不卸载、不丢草稿」
   * 一直挂载着，正文本来就归它们自己。把正文塞进 `Tabs.panels` 会在「本区域只剩一个面板」时把结构从
   * 「有标签条」切成「没有标签条」，React 于是在同一位置换掉子树 —— 实测会重建正文（输入框里的草稿被清空）。
   * 所以这里只借标签条：`panels` 留空，`roles="tabpanel"` 的空块不承载正文，也不重复挂载任何内容。
   */

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
        menuItems={menuItems}
        onMenuClick={onMenuClick}
        onClose={props.onClose}
        resolveText={(key: WorkspacePanelTextKey) =>
          key === 'workspace.panelActions'
            ? labels.panelActions
            : key === 'workspace.panelClose'
              ? labels.panelClose
              : labels.panelReturnToPage
        }
        returnToPage={props.presentation === 'normal' ? undefined : { onClick: props.onReturnToPage }}
      />
      <div className="workspace-panel-body" style={{ gridArea: 'body' }}>
        {hasTabStrip ? (
          <Tabs
            ariaLabelKey={PANEL_TABS_LABEL_KEY}
            items={tabItems}
            onChange={props.onActivate}
            panels={{}}
            resolveText={resolveTabText}
            value={activeTabValue}
          />
        ) : null}
        <div className="workspace-panel-content">{panelContent}</div>
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
