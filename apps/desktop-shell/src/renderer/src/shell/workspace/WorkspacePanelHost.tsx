import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type {
  PanelContainerMode,
  WorkspacePanelRegistration,
  WorkspacePanelResult,
  WorkspacePanelSnapshot,
  WorkspacePreparation,
  WorkspaceSize,
  WorkspaceSnapshot
} from '@platform/workspace/contracts'
import { platformText } from '../../i18n/platformText'
import { WorkspacePanelFrame, type WorkspacePanelTab } from './WorkspacePanelFrame'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import type { WorkspaceContentAdapter, WorkspacePanelHostPort } from './workspaceHostAdapter'
import {
  applyWidthBudget,
  buildWorkspaceGridTracks,
  clampPanelSize,
  derivePanelPresentation,
  resolveNarrowRegion,
  resolveRegionSize,
  regionMode,
  WorkspaceNarrowPriority,
  WorkspaceUiPolicy,
  workspaceRegion,
  type WorkspacePresentation,
  type WorkspaceRegion
} from './workspacePresentation'

/**
 * Owner: apps/desktop-shell renderer / workspace 页面级 composition。回归：WorkspacePanelHost.test.tsx。
 * 权威：P1-03 裁决 §4 与纠偏 R1–R8。
 *
 * ── 窄屏（overlay/exclusive）路径状态模型，owner = 本文件 ──
 * 状态恰好三份，互不复制：
 *  A 权威快照 props.snapshot：panel.open/mode/dockSize + pageLayouts[].activePanels；applied 与 rejected
 *    的权威 snapshot 都经 onSnapshot 回传。
 *  B 派生（每帧纯函数重算）：每区域 occupant = 该区域 open ∧ 权威 active 的面板；区域呈现 = 由 occupant
 *    的注册尺寸推导（区域级，不再按面板各自推导）；被呈现区域 = resolveNarrowRegion(权威 + 瞬时态)；
 *    可见 = normal 区域取其 occupant，窄屏区域取「被呈现区域的 occupant」。
 *  C 允许的瞬时 UI 状态（仅此两个）：dismissed =「返回页面」（工作区级临时收起全部窄屏呈现）；
 *    pinnedRegion =「区域级 pin」（多区域同时窄屏时指定呈现哪个区域，绝不指定面板）。
 * 转移：入口(open,非 active)→activate；入口(closed)→reopen；入口(open,active)→不发命令；区域标签→activate；
 *  以上三者同时置 pinnedRegion=该区域, dismissed=false。关闭→close（瞬时态不变，焦点交回入口）。
 *  返回页面(Escape/工具栏)→dismissed=true, pinnedRegion=null。区域不再窄屏→剪枝：pin 不在窄屏集合则清空，
 *  无窄屏区域时 dismissed 也清空。
 * 不变量：I1 每区域只要存在 open ∧ 权威 active 的面板，它就是 occupant，轨道与呈现只由 occupant 决定，
 *  窄屏同时至多呈现一个区域（WorkspaceNarrowPriority 或 pinnedRegion）。I2 activePanels[region] /
 *  可见帧正文 / 可见帧内标签高亮同源于 props.snapshot，必然一致。I3 呈现 = 权威快照 + 上述两个具名瞬时
 *  状态，不存在第二个「哪个面板被选中」的权威（旧 focusKey 已删除）。I4 每个被渲染的入口都有真实且幂等
 *  的可见行为：入口只在面板不可见时渲染，点击后它必成为所在区域 occupant（必要时先 activate/reopen）。
 *  I5 每个 open 面板至少有一个可达控件（自身可见帧 / 可见帧内标签 / 入口），含权威 active 面板。
 *
 * close 边界：adapter.prepare gate → port.close → 只消费 result.snapshot → 拒绝/异常保留内容 →
 * 仅 accepted 的 closed snapshot 才卸载内容；本包不把 adapter.release 接进宿主（跨窗口闭环归 P1-04/P1-06）。
 */

export type WorkspacePanelView = {
  registration: WorkspacePanelRegistration
  title: string
  content: ReactNode
  adapter: WorkspaceContentAdapter
}

export type WorkspacePanelHostProps = {
  workspaceInstanceKey: string
  snapshot: WorkspaceSnapshot
  pageSize: WorkspaceSize
  pageMinSize: WorkspaceSize
  language: AppLanguage
  /** 窗口级已解析显示时区（来自受控 host context）；产品按它格式化时间。 */
  timeZone: string
  onSnapshot: (snapshot: WorkspaceSnapshot) => void
  views: Readonly<Record<string, WorkspacePanelView>>
  port: WorkspacePanelHostPort
  children?: ReactNode
}

type HostedPanelCore = {
  panel: WorkspacePanelSnapshot
  view: WorkspacePanelView
  region: WorkspaceRegion
  size: WorkspaceSize
  regionActive: boolean
}

type HostedPanel = HostedPanelCore & { presentation: WorkspacePresentation; visible: boolean; needsEntry: boolean }

/** 入口：closed 走 reopen，open 非 active 走 activate，并总是把区域级 pin 指向该面板所在区域。 */
type PanelEntry = {
  panel: WorkspacePanelSnapshot
  title: string
  region: WorkspaceRegion
  reopen: boolean
  regionActive: boolean
}

/** 窄屏瞬时显示态（模型 C）：返回页面 + 区域级 pin；没有第二个「哪个面板被选中」的权威。 */
type NarrowViewState = { dismissed: boolean; pinnedRegion: WorkspaceRegion | null }

export function WorkspacePanelHost(props: WorkspacePanelHostProps): React.ReactElement {
  const labels = platformText[props.language].workspace
  const hostRef = useRef<HTMLDivElement | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const [previewSizes, setPreviewSizes] = useState<Readonly<Record<string, WorkspaceSize>>>({})
  const [narrow, setNarrow] = useState<NarrowViewState>({ dismissed: false, pinnedRegion: null })
  const [notice, setNotice] = useState<string | null>(null)

  const layout = props.snapshot.pageLayouts.find((item) => item.workspaceInstanceKey === props.workspaceInstanceKey)
  const orderedPanels = (layout?.panelOrder ?? [])
    .map((key) => props.snapshot.panels.find((item) => item.panelInstanceKey === key))
    .filter((item): item is WorkspacePanelSnapshot => item !== undefined && item.mode !== 'detached')

  const core: HostedPanelCore[] = []
  const { pageSize, pageMinSize } = props
  for (const panel of orderedPanels) {
    const view = props.views[panel.panelInstanceKey]
    if (!view) continue
    const mapped = workspaceRegion(panel.mode)
    const region: WorkspaceRegion = mapped === 'detached' ? 'embedded' : mapped
    const size = resolveRegionSize(region, view.registration, previewSizes[panel.panelInstanceKey] ?? panel.dockSize, pageSize, pageMinSize)
    core.push({ panel, view, region, size, regionActive: layout?.activePanels[regionMode(region)] === panel.panelInstanceKey })
  }
  const occupantOf = <T extends { region: WorkspaceRegion; panel: WorkspacePanelSnapshot; regionActive: boolean }>(entries: readonly T[], region: WorkspaceRegion): T | undefined => entries.find((entry) => entry.region === region && entry.panel.open && entry.regionActive)

  // 区域级呈现：同一区域所有面板共享 occupant 推导出的呈现，杜绝「按面板推导 / 按区域决策轨道」的错配。
  const regionPresentations = { embedded: 'normal', right: 'normal', bottom: 'normal' } as Record<WorkspaceRegion, WorkspacePresentation>
  for (const region of WorkspaceNarrowPriority) {
    const occupant = occupantOf(core, region)
    if (occupant) regionPresentations[region] = derivePanelPresentation({ mode: occupant.panel.mode, contentWidth: pageSize.width, contentHeight: pageSize.height, pageMinSize, panelMinSize: occupant.view.registration.minSize }).presentation
  }

  // R6/R7：embedded 与 right 共享同一份宽度预算，页面始终保留 pageMinSize.width；只有真正占用 normal 轨道的面板产生请求。
  const applied = applyWidthBudget({
    panels: core.map((entry) => ({ region: entry.region, open: entry.panel.open, axisPresentation: regionPresentations[entry.region], minWidth: entry.view.registration.minSize.width, desiredSize: entry.size, occupying: entry.regionActive })),
    pageSize,
    pageMinSize
  })
  const resolved: Omit<HostedPanel, 'visible' | 'needsEntry'>[] = core.map((entry, index) => ({ ...entry, presentation: applied[index].presentation, size: applied[index].size }))

  // 窄屏被呈现区域：权威 occupant 决定面板，瞬时态只决定区域（见文件头状态模型）。
  const narrowRegions = WorkspaceNarrowPriority.filter((region) => (occupantOf(resolved, region)?.presentation ?? 'normal') !== 'normal')
  const presentedRegion = resolveNarrowRegion({ dismissed: narrow.dismissed, pinnedRegion: narrow.pinnedRegion, narrowRegions })
  const presentedNarrowKey = presentedRegion === null ? null : occupantOf(resolved, presentedRegion)?.panel.panelInstanceKey ?? null
  const hostedWithoutEntries: Omit<HostedPanel, 'needsEntry'>[] = resolved.map((entry) => {
    const narrowEntry = entry.presentation !== 'normal'
    const presented = narrowEntry && presentedNarrowKey === entry.panel.panelInstanceKey
    return { ...entry, visible: entry.panel.open && (narrowEntry ? presented : entry.regionActive) }
  })
  const regionHasVisible = (region: WorkspaceRegion) => hostedWithoutEntries.some((entry) => entry.region === region && entry.visible)
  // I5：不可见时权威 active 一定有入口；其余面板在本区域没有可见帧时也必须有入口。
  const hosted: HostedPanel[] = hostedWithoutEntries.map((entry) => ({
    ...entry,
    needsEntry: !entry.panel.open || (!entry.visible && (entry.regionActive || !regionHasVisible(entry.region)))
  }))

  const narrowRegionsKey = narrowRegions.join('|')
  useEffect(() => {
    setNarrow((previous) => {
      const keep = narrowRegionsKey.split('|').filter(Boolean)
      const pinnedRegion = previous.pinnedRegion !== null && keep.includes(previous.pinnedRegion) ? previous.pinnedRegion : null
      const dismissed = keep.length > 0 && previous.dismissed
      return pinnedRegion === previous.pinnedRegion && dismissed === previous.dismissed ? previous : { dismissed, pinnedRegion }
    })
  }, [narrowRegionsKey])

  useEffect(() => {
    const key = pendingFocus.current
    if (!key || !hostRef.current) return
    const node = Array.from(hostRef.current.querySelectorAll<HTMLButtonElement>('[data-entry-key]'))
      .find((element) => element.dataset.entryKey === key)
    if (!node) return
    pendingFocus.current = null
    node.focus()
  })

  const send = async (run: () => Promise<WorkspacePanelResult>): Promise<WorkspacePanelResult | null> => {
    try {
      const result = await run()
      props.onSnapshot(result.snapshot)
      if (result.status === 'rejected') {
        setNotice(labels.panelCommandRejected)
        return result
      }
      setNotice(null)
      return result
    } catch {
      setNotice(labels.panelCommandFailed)
      return null
    }
  }

  const updatePreview = (key: string, size: WorkspaceSize | null) => setPreviewSizes((previous) => {
    const current = previous[key]
    if (size === null) {
      if (current === undefined) return previous
      const next = { ...previous }
      delete next[key]
      return next
    }
    return current?.width === size.width && current.height === size.height ? previous : { ...previous, [key]: size }
  })

  const closePanel = async (entry: HostedPanel) => {
    let preparation: WorkspacePreparation = { status: 'ready' }
    try {
      preparation = await entry.view.adapter.prepare()
    } catch {
      setNotice(labels.panelCommandFailed)
      return
    }
    if (preparation.status !== 'ready') {
      setNotice(handoffNotice(preparation.reason, labels))
      return
    }
    const result = await send(() => props.port.close({ panelInstanceKey: entry.panel.panelInstanceKey }))
    if (result?.status === 'applied') pendingFocus.current = entry.panel.panelInstanceKey
  }

  const switchMode = (entry: HostedPanel, mode: PanelContainerMode) => {
    const detach = props.port.detach
    if (mode === 'detached' && detach) {
      void send(() => detach({ panelInstanceKey: entry.panel.panelInstanceKey }))
      return
    }
    void send(() => props.port.switchContainer({ panelInstanceKey: entry.panel.panelInstanceKey, mode }))
  }

  const returnToPage = (panelInstanceKey: string) => {
    // 「返回页面」是工作区级瞬时态（模型 C）：收起全部窄屏呈现，页面占满。
    setNarrow({ dismissed: true, pinnedRegion: null })
    pendingFocus.current = panelInstanceKey
  }

  // I4：入口只在面板不可见时渲染，点击后它必成为所在区域 occupant，因此在轨道或窄屏呈现中可见。
  const showPanel = (entry: PanelEntry) => {
    setNarrow({ dismissed: false, pinnedRegion: entry.region })
    if (entry.reopen) { void send(() => props.port.reopen({ panelInstanceKey: entry.panel.panelInstanceKey })); return }
    if (!entry.regionActive) void send(() => props.port.activate({ panelInstanceKey: entry.panel.panelInstanceKey }))
  }

  const tabsFor = (region: WorkspaceRegion): WorkspacePanelTab[] =>
    hosted
      .filter((entry) => entry.region === region && entry.panel.open)
      .map((entry) => ({ panelKey: entry.panel.panelInstanceKey, title: entry.view.title }))

  const dockedVisible = (region: 'right' | 'bottom') =>
    hosted.find((entry) => entry.region === region && entry.visible && entry.presentation === 'normal')
  const embeddedVisible = hosted.find((entry) => entry.region === 'embedded' && entry.visible && entry.presentation === 'normal')
  const tracks = buildWorkspaceGridTracks({
    embeddedWidth: embeddedVisible?.size.width ?? 0,
    rightWidth: dockedVisible('right')?.size.width ?? 0,
    bottomHeight: dockedVisible('bottom')?.size.height ?? 0
  })
  const pageHidden = hosted.some((entry) => entry.visible && entry.presentation === 'exclusive')
  const entries: PanelEntry[] = hosted.filter((entry) => entry.needsEntry).map((entry) => ({ panel: entry.panel, title: entry.view.title, region: entry.region, reopen: !entry.panel.open, regionActive: entry.regionActive }))
  const hostStyle = {
    gridTemplateColumns: tracks.columns,
    gridTemplateRows: tracks.rows,
    gridTemplateAreas: tracks.areas,
    '--workspace-title-height': `${WorkspaceUiPolicy.titleHeight}px`,
    '--workspace-splitter-size': `${WorkspaceUiPolicy.splitterSize}px`,
    '--workspace-splitter-hit-size': `${WorkspaceUiPolicy.splitterHitSize}px`
  } as React.CSSProperties

  return (
    <ShellLanguageProvider language={props.language}>
    <ShellTimeZoneProvider timeZone={props.timeZone}>
    <div ref={hostRef} className="workspace-panel-host" style={hostStyle}>
      <div className="workspace-page" style={{ gridArea: 'page' }} hidden={pageHidden}>
        {props.children}
      </div>
      {hosted.filter((entry) => entry.panel.open).map((entry) => (
        <WorkspacePanelFrame
          key={entry.panel.panelInstanceKey}
          panelKey={entry.panel.panelInstanceKey}
          mode={entry.panel.mode}
          region={entry.region}
          presentation={entry.presentation}
          gridArea={entry.presentation === 'normal' ? entry.region : 'page'}
          hidden={!entry.visible}
          title={entry.view.title}
          language={props.language}
          content={entry.view.content}
          size={entry.size}
          pageSize={props.pageSize}
          pageMinSize={props.pageMinSize}
          panelMinSize={entry.view.registration.minSize}
          supportedModes={entry.view.registration.supportedModes}
          detachAvailable={props.port.detach !== undefined}
          tabs={tabsFor(entry.region)}
          activePanelKey={layout?.activePanels[regionMode(entry.region)]}
          onActivate={(key) => { setNarrow({ dismissed: false, pinnedRegion: entry.region }); void send(() => props.port.activate({ panelInstanceKey: key })) }}
          onSwitchContainer={(mode) => switchMode(entry, mode)}
          onResetSize={() => void send(() => props.port.reset({ panelInstanceKey: entry.panel.panelInstanceKey }))}
          onClose={() => void closePanel(entry)}
          onPreviewSize={(size) => updatePreview(entry.panel.panelInstanceKey, size)}
          onResizeCommit={(size) => void send(() => props.port.resize({ panelInstanceKey: entry.panel.panelInstanceKey, size }))}
          onReturnToPage={() => returnToPage(entry.panel.panelInstanceKey)}
        />
      ))}
      {entries.length > 0 ? (
        <div className="workspace-panel-entries" style={{ gridArea: 'page' }}>
          {entries.map((entry) => (
            <button
              key={entry.panel.panelInstanceKey}
              type="button"
              className="workspace-panel-entry"
              data-entry-key={entry.panel.panelInstanceKey}
              aria-label={labels.panelShowPanel}
              onClick={() => showPanel(entry)}
            >
              {entry.title}
            </button>
          ))}
        </div>
      ) : null}
      {notice ? <div role="alert" className="workspace-panel-notice" style={{ gridArea: 'page' }}>{notice}</div> : null}
    </div>
    </ShellTimeZoneProvider>
    </ShellLanguageProvider>
  )
}

const handoffNotice = (reason: 'unsaved-content' | 'sensitive-draft' | 'unsupported-handoff', labels: (typeof platformText)['en-US']['workspace']): string =>
  reason === 'unsupported-handoff' ? labels.panelHandoffUnsupported : reason === 'sensitive-draft' ? labels.panelHandoffSensitive : labels.panelHandoffUnsaved
