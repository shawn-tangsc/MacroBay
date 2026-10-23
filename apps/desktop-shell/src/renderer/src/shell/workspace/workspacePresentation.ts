import type { PanelContainerMode, WorkspaceSize } from '@platform/workspace/contracts'

/**
 * Owner: apps/desktop-shell renderer / workspace 页面级 composition。
 * 权威：平台通用可拆分工作区 P1-03 纠偏（尺寸与窄屏策略裁决）。
 *
 * 尺寸唯一来源，仅允许下述三类：
 *  1. 注册表 WorkspacePanelRegistration.minSize / preferredSize；
 *  2. 宿主注入的 pageMinSize（本文件所有上限都由它推导）；
 *  3. 本文件的具名策略常量 WorkspaceUiPolicy。
 * 旧实现的匿名上限（maxPanelWidth/maxPanelHeight 960/720、写死的页面下限 640x480）
 * 已删除；CSS 不得复制这些数值，只能通过宿主下发的自定义属性消费。
 *
 * 回归：workspacePresentation.test.ts、WorkspacePanelHost.test.tsx、workspaceLayout.css。
 */
export const WorkspaceUiPolicy = Object.freeze({
  /** 面板标题栏高度（DIP）。CSS 通过 --workspace-title-height 消费同一数值。 */
  titleHeight: 32,
  /** 分隔条可见线宽（DIP）。 */
  splitterSize: 4,
  /** 分隔条命中区宽度（DIP）。CSS 通过 --workspace-splitter-hit-size 消费同一数值。 */
  splitterHitSize: 8,
  /** 键盘调整步长（DIP）。 */
  keyboardStep: 16
})

export type WorkspacePresentation = 'normal' | 'overlay' | 'exclusive'
/** 参与页面级网格停靠的区域；detached 不由本宿主承载。 */
export type WorkspaceRegion = 'embedded' | 'right' | 'bottom'
export type DockedMode = Exclude<PanelContainerMode, 'embedded' | 'detached'>
export type DockedRegion = Exclude<WorkspaceRegion, 'embedded'>

export function workspaceRegion(mode: PanelContainerMode): WorkspaceRegion | 'detached' {
  if (mode === 'docked-right') return 'right'
  if (mode === 'docked-bottom') return 'bottom'
  if (mode === 'embedded') return 'embedded'
  return 'detached'
}

/**
 * 反向映射：权威 snapshot 的 pageLayouts[].activePanels 以「模式」为键
 * （embedded / docked-right / docked-bottom），渲染区域名不能直接当作键使用。
 */
export function regionMode(region: WorkspaceRegion): Exclude<PanelContainerMode, 'detached'> {
  if (region === 'right') return 'docked-right'
  if (region === 'bottom') return 'docked-bottom'
  return 'embedded'
}

/**
 * 窄屏（overlay/exclusive）下同一时刻只呈现一个面板（设计 §4「单区域：同时只显示主内容或面板」）。
 * 按此顺序挑选被呈现的区域；其余面板通过本区域面板标签（同区域）或重开/切换入口（跨区域）保持可达。
 */
export const WorkspaceNarrowPriority = Object.freeze<readonly WorkspaceRegion[]>(['right', 'bottom', 'embedded'])

/**
 * 窄屏「被呈现区域」的唯一决策入口（I3：呈现 = 权威快照 + 具名瞬时状态，没有第二个面板选择权威）。
 * 失败/边界语义：
 *  - dismissed（返回页面）优先，直接不呈现任何窄屏区域；
 *  - pinnedRegion（区域级 pin）只在「当前确实窄屏」的区域集合内生效，越界即忽略（陈旧 pin 不会复活）；
 *  - 否则按 WorkspaceNarrowPriority 取第一个窄屏区域；集合为空返回 null（页面独占）。
 * 传入的 narrowRegions 必须已按优先级排序；区域内呈现哪个面板由权威 activePanels 决定，不在本函数内。
 */
export function resolveNarrowRegion(input: {
  dismissed: boolean
  pinnedRegion: WorkspaceRegion | null
  narrowRegions: readonly WorkspaceRegion[]
}): WorkspaceRegion | null {
  if (input.dismissed) return null
  if (input.pinnedRegion !== null && input.narrowRegions.includes(input.pinnedRegion)) return input.pinnedRegion
  return input.narrowRegions[0] ?? null
}

export type PanelPresentationInput = {
  mode: PanelContainerMode
  contentWidth: number
  contentHeight: number
  pageMinSize: WorkspaceSize
  panelMinSize: WorkspaceSize
}

/**
 * 窄屏判定只比较页面最小尺寸、分隔条与面板注册最小尺寸（embedded 与 right 共用宽度轴）：
 *  - 内容轴 < pageMin            → exclusive（面板独占页面）
 *  - 内容轴 < pageMin + 分隔 + 面板最小 → overlay（面板浮在页面上方）
 *  - 其余                        → normal（真实网格停靠，页面不被压到 pageMin 以下）
 */
export function derivePanelPresentation(input: PanelPresentationInput): { mode: PanelContainerMode; presentation: WorkspacePresentation } {
  const region = workspaceRegion(input.mode)
  if (region === 'detached') return { mode: input.mode, presentation: 'normal' }
  const widthAxis = region !== 'bottom'
  const content = widthAxis ? input.contentWidth : input.contentHeight
  const pageMin = widthAxis ? input.pageMinSize.width : input.pageMinSize.height
  const panelMin = widthAxis ? input.panelMinSize.width : input.panelMinSize.height
  if (content < pageMin) return { mode: input.mode, presentation: 'exclusive' }
  if (content < pageMin + WorkspaceUiPolicy.splitterSize + panelMin) return { mode: input.mode, presentation: 'overlay' }
  return { mode: input.mode, presentation: 'normal' }
}

export type PanelSizeBounds = { min: WorkspaceSize; max: WorkspaceSize }

/**
 * 区域轴的最小/最大尺寸：最大值 = 页面尺寸 - pageMinSize - 分隔条，不再有匿名上限。
 * right 与 embedded 共用宽度轴，因此 embedded 也不可能把页面压到注入的 pageMinSize 以下。
 */
export function panelSizeBounds(region: WorkspaceRegion, pageSize: WorkspaceSize, pageMinSize: WorkspaceSize, panelMinSize: WorkspaceSize): PanelSizeBounds {
  if (region === 'bottom') {
    const max = pageSize.height - pageMinSize.height - WorkspaceUiPolicy.splitterSize
    return {
      min: { width: pageSize.width, height: panelMinSize.height },
      max: { width: pageSize.width, height: Math.max(panelMinSize.height, max) }
    }
  }
  const max = pageSize.width - pageMinSize.width - WorkspaceUiPolicy.splitterSize
  return {
    min: { width: panelMinSize.width, height: pageSize.height },
    max: { width: Math.max(panelMinSize.width, max), height: pageSize.height }
  }
}

export function clampPanelSize(
  mode: DockedMode,
  size: WorkspaceSize,
  pageSize: WorkspaceSize,
  panelMinSize: WorkspaceSize,
  pageMinSize: WorkspaceSize
): WorkspaceSize {
  const region: DockedRegion = mode === 'docked-right' ? 'right' : 'bottom'
  const bounds = panelSizeBounds(region, pageSize, pageMinSize, panelMinSize)
  if (region === 'right') {
    return { width: clamp(size.width, bounds.min.width, bounds.max.width), height: pageSize.height }
  }
  return { width: pageSize.width, height: clamp(size.height, bounds.min.height, bounds.max.height) }
}

/**
 * embedded 尺寸不是用户可调尺寸，只允许由「页面边界 + 注册 minSize/preferredSize」受约束推导；
 * 不接受 dockSize，避免把其它区域的提交尺寸带进嵌入列。
 */
export function resolveEmbeddedSize(
  registration: { minSize: WorkspaceSize; preferredSize: WorkspaceSize },
  pageSize: WorkspaceSize,
  pageMinSize: WorkspaceSize
): WorkspaceSize {
  const bounds = panelSizeBounds('embedded', pageSize, pageMinSize, registration.minSize)
  return { width: clamp(registration.preferredSize.width, bounds.min.width, bounds.max.width), height: pageSize.height }
}

/**
 * 权威尺寸解析：提交尺寸优先，其次注册 preferredSize。
 * 交叉轴始终铺满页面，避免出现第二份尺寸来源。
 */
export function resolveDockSize(region: DockedRegion, committed: WorkspaceSize | undefined, preferred: WorkspaceSize, pageSize: WorkspaceSize): WorkspaceSize {
  if (region === 'right') return { width: committed?.width ?? preferred.width, height: pageSize.height }
  return { width: pageSize.width, height: committed?.height ?? preferred.height }
}

/** 单个区域在「无联合预算约束」下的期望尺寸；这是尺寸的唯一推导入口（embedded/right 走宽度轴，bottom 走高度轴）。 */
export function resolveRegionSize(
  region: WorkspaceRegion,
  registration: { minSize: WorkspaceSize; preferredSize: WorkspaceSize },
  committed: WorkspaceSize | undefined,
  pageSize: WorkspaceSize,
  pageMinSize: WorkspaceSize
): WorkspaceSize {
  if (region === 'embedded') return resolveEmbeddedSize(registration, pageSize, pageMinSize)
  const mode: DockedMode = region === 'right' ? 'docked-right' : 'docked-bottom'
  return clampPanelSize(mode, resolveDockSize(region, committed, registration.preferredSize, pageSize), pageSize, registration.minSize, pageMinSize)
}

export type WidthAxisRegion = 'embedded' | 'right'

/**
 * Owner: apps/desktop-shell renderer / workspace 宽度轴联合预算策略。
 * 权威：P1-03 纠偏 R6（设计 §3.4「空间不足时降级为覆盖层或单区域」、§5.3.1「每个位置一个面板区域」）。
 *
 * 优先级（先 = 高）：embedded 是页面自身预留区域（product-design.md:81「页面预留区域」），
 * 先于右侧停靠获得预算——预算不足时让显式停靠先转覆盖层仍然完全可用；这是单点策略，若产品反馈相反只需调换顺序。
 * 请求资格：只有「open 且该区域轴呈现 normal 且是该区域当前 active（即真正占用 normal 轨道的那个面板）」
 * 才产生请求；已关闭或不可见的面板不占预算、不影响其它区域。
 * 失败语义（确定性、无溢出、无负轨道）：
 *  1. 联合预算 = pageSize.width - pageMinSize.width，所有宽度轴区域共享这一份，
 *     因此页面轨道恒 ≥ pageMinSize.width（分隔条在帧内轨道里，不占宿主网格宽度）；
 *  2. 各区域先取自己的注册 minSize；剩余额度按优先级顺序补到各自期望尺寸；
 *  3. 若连现存的 minSize 之和都超过预算，则从最低优先级起逐个降级（degraded），
 *     降级区域轨道为 0，宿主按既有 overlay 语义呈现，且不得修改 mode/open。
 * 高度轴只有一个区域（bottom），同一不变式由 panelSizeBounds('bottom') + derivePanelPresentation
 * 的 overlay 阈值保证（见 workspacePresentation.test.ts 与 R6 高度用例）。
 */
export const WorkspaceWidthBudgetPriority = Object.freeze<readonly WidthAxisRegion[]>(['embedded', 'right'])

export type WidthBudgetRequest = { region: WidthAxisRegion; minWidth: number; desiredWidth: number }
export type WidthBudgetAllocation = {
  /** 分到 normal 轨道的宽度；键不存在 = 该区域未获得预算。 */
  widths: Partial<Record<WidthAxisRegion, number>>
  /** 预算连 minSize 都放不下、必须降级为 overlay 的区域。 */
  degraded: readonly WidthAxisRegion[]
}

export function allocateWidthBudget(input: {
  requests: readonly WidthBudgetRequest[]
  pageSize: WorkspaceSize
  pageMinSize: WorkspaceSize
}): WidthBudgetAllocation {
  const available = Math.max(0, input.pageSize.width - input.pageMinSize.width)
  const ordered = WorkspaceWidthBudgetPriority
    .map((region) => input.requests.find((request) => request.region === region))
    .filter((request): request is WidthBudgetRequest => request !== undefined)
  const active = [...ordered]
  while (active.length > 0 && active.reduce((sum, request) => sum + request.minWidth, 0) > available) active.pop()
  const degraded = ordered.filter((request) => !active.includes(request)).map((request) => request.region)
  const widths: Partial<Record<WidthAxisRegion, number>> = {}
  let remaining = available
  for (const request of active) {
    widths[request.region] = request.minWidth
    remaining -= request.minWidth
  }
  for (const request of active) {
    const extra = Math.max(0, Math.min(request.desiredWidth - request.minWidth, remaining))
    widths[request.region] = (widths[request.region] ?? request.minWidth) + extra
    remaining -= extra
  }
  return { widths, degraded: Object.freeze(degraded) }
}

export type WidthBudgetPanel = {
  region: WorkspaceRegion
  /** 面板是否打开；关闭的面板不占用轨道，因此不参与预算。 */
  open: boolean
  axisPresentation: WorkspacePresentation
  /** 该区域注册 minSize.width。 */
  minWidth: number
  /** 该区域无预算约束时的期望尺寸。 */
  desiredSize: WorkspaceSize
  /** 是否由本区域当前 active 的面板占用轨道（决定用谁的注册尺寸参与预算）。 */
  occupying: boolean
}
export type WidthBudgetPanelResult = { presentation: WorkspacePresentation; size: WorkspaceSize }

/**
 * 把宽度轴联合预算落到每个面板上（宿主只做投影，不复制策略）：
 *  - 轴呈现已非 normal 的面板保持原呈现；
 *  - 轴呈现 normal 但所在区域被预算降级 → overlay（页面保持可见，未被隐藏）；
 *  - 获得预算的宽度轴区域使用分配宽度，其余区域沿用各自推导尺寸。
 */
export function applyWidthBudget(input: {
  panels: readonly WidthBudgetPanel[]
  pageSize: WorkspaceSize
  pageMinSize: WorkspaceSize
}): WidthBudgetPanelResult[] {
  const requests: WidthBudgetRequest[] = []
  for (const region of WorkspaceWidthBudgetPriority) {
    // 与宿主渲染正常轨道的判据完全一致：open + 轴 normal + 区域 active（occupying）；无 fallback。
    const occupying = input.panels.find((panel) => panel.region === region && panel.open && panel.axisPresentation === 'normal' && panel.occupying)
    if (occupying) requests.push({ region, minWidth: occupying.minWidth, desiredWidth: occupying.desiredSize.width })
  }
  const allocation = allocateWidthBudget({ requests, pageSize: input.pageSize, pageMinSize: input.pageMinSize })
  return input.panels.map((panel) => {
    const allocated = panel.region === 'embedded' ? allocation.widths.embedded : panel.region === 'right' ? allocation.widths.right : undefined
    const degraded = allocation.degraded.some((region) => region === panel.region)
    return {
      presentation: degraded ? 'overlay' : panel.axisPresentation,
      size: allocated === undefined ? panel.desiredSize : { width: allocated, height: panel.desiredSize.height }
    }
  })
}

export type WorkspaceGridTracks = { columns: string; rows: string; areas: string }

/**
 * 页面级网格模板：page/embedded/right/bottom 四个具名区域。
 * 右停靠与底停靠可同时存在；缺失区域退化为 0px 轨道。
 */
export function buildWorkspaceGridTracks(input: { embeddedWidth: number; rightWidth: number; bottomHeight: number }): WorkspaceGridTracks {
  return {
    columns: `${input.embeddedWidth}px minmax(0, 1fr) ${input.rightWidth}px`,
    rows: `minmax(0, 1fr) ${input.bottomHeight}px`,
    areas: '"embedded page right" "embedded bottom right"'
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}
