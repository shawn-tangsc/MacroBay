import type { PanelContainerMode, WorkspaceBounds, WorkspaceSize } from '@platform/workspace/contracts'
import { WorkspaceDetachedWindowPolicy } from '@platform/workspace/policies'

/**
 * Owner: platform/desktop/main/workspace。权威：技术设计 §4/§6 与 P1-04。
 * 职责＝窗口安置策略：DIP/workArea bounds 校正 + 回退原因词汇 + 回停靠/故障回退链选择。
 *
 * 只做纯计算：调用方注入当前 `screen` 工作区（DIP），本模块不依赖 electron。
 * 失败语义（对应 WorkspaceFallbackReason 的 screen-unavailable / bounds-invalid）：
 *  - 没有任何可用显示器、或 workArea 退化（非有限/<=0） ⇒ screen-unavailable（不可校正，走回退链）；
 *  - 尺寸非有限或 <=0 ⇒ bounds-invalid（不可校正，走回退链）；
 *  - 显示器提示丢失、或窗口完全不在任何显示器上 ⇒ 可校正：夹回目标显示器，不算失败。
 * 显示器 ID 只作提示：提示命中优先，否则取与目标矩形交集最大者，再否则第一个（约定为主显示器）。
 */

export type WorkspaceDisplayInfo = {
  /** 平台显示器标识，仅作提示。 */
  id: string
  /** DIP 工作区（不含任务栏/菜单栏区域）。 */
  workArea: WorkspaceBounds
  scaleFactor?: number
}

export type DockMode = Exclude<PanelContainerMode, 'detached'>

/** 技术设计 §6 的安全回退链；跳过未注册模式。 */
export const WorkspaceDockFallbackChain = Object.freeze<readonly DockMode[]>(['docked-right', 'docked-bottom', 'embedded'])

/** 技术设计 §4 的回退原因词汇（platform/workspace/contracts.ts 尚未导出，见回交的契约缺口）。 */
export type WorkspaceFallbackReason =
  | 'unsupported' | 'window-create-failed' | 'window-load-failed' | 'window-crashed'
  | 'window-unresponsive' | 'screen-unavailable' | 'bounds-invalid' | 'main-window-closing'
  | 'narrow-screen' | 'registration-missing' | 'binding-unavailable' | 'restore-invalid' | 'content-error'

/** bounds 自己只能产出这两个原因（回退词汇的子集）。 */
export type WorkspaceBoundsFailure = Extract<WorkspaceFallbackReason, 'screen-unavailable' | 'bounds-invalid'>

/**
 * 错误/超时路径（技术设计 §6:230、§8:288）：创建/加载/崩溃等故障**直接**走安全回退链
 * right→bottom→embedded，跳过未注册模式——**不看** lastValidDock（那是用户意图，不是安全回退）。
 */
export function resolveFailureFallbackMode(supportedModes: readonly PanelContainerMode[]): DockMode | undefined {
  return WorkspaceDockFallbackChain.find((mode) => supportedModes.includes(mode))
}

/** 用户主动回停靠 / 原生窗口 X：先尝试 lastValidDock，不可用再按安全回退链。 */
export function resolveUserDockMode(input: {
  lastValidDock: DockMode
  supportedModes: readonly PanelContainerMode[]
}): DockMode | undefined {
  return [input.lastValidDock, ...WorkspaceDockFallbackChain].find((mode) => input.supportedModes.includes(mode))
}

export type WorkspaceBoundsOutcome =
  | { status: 'ok'; bounds: WorkspaceBounds }
  | { status: 'failed'; reason: WorkspaceBoundsFailure }

/**
 * P2-14：**没有用户 bounds 时**才生效的尺寸约束（来源＝`WorkspaceDetachedWindowPolicy`）。
 * 只约束「新窗的候选尺寸」；用户已持久化的 bounds 一律原样沿用（只做工作区内夹紧），
 * 因此本约束绝不可能覆盖用户手动调整过的尺寸。
 */
export type DetachedWindowSizeConstraint = {
  minSize: WorkspaceSize
  maxWorkAreaRatio: number
  workAreaMargin: number
}

/** 页面窗（`detached-tab`）的尺寸约束：具名策略的唯一消费点，调用方不得再写匿名数字。 */
export function detachedWindowSizeConstraint(): DetachedWindowSizeConstraint {
  return {
    minSize: WorkspaceDetachedWindowPolicy.minSize,
    maxWorkAreaRatio: WorkspaceDetachedWindowPolicy.maxWorkAreaRatio,
    workAreaMargin: WorkspaceDetachedWindowPolicy.workAreaMargin
  }
}

/**
 * 候选尺寸（下发窗口工厂之前的「想要多大」）：
 *  - 有源区域信息 ⇒ 源区域 × `sourceAreaScale`（独立页面窗必须比源页面区域更大才有意义）；
 *  - 无源区域信息 / 源区域畸形 ⇒ `defaultSize`（**不再**复用面板注册的 preferredSize）。
 * 夹紧（minSize / 工作区占比 / 边距）由 `normalizeDetachedBounds` 在**拿到工作区之后**完成。
 */
export function resolveDetachedWindowRequestedSize(input: { sourceAreaSize?: WorkspaceSize } = {}): WorkspaceSize {
  const source = input.sourceAreaSize
  if (source === undefined || !isUsableBounds(source)) {
    return { width: WorkspaceDetachedWindowPolicy.defaultSize.width, height: WorkspaceDetachedWindowPolicy.defaultSize.height }
  }
  return {
    width: Math.round(source.width * WorkspaceDetachedWindowPolicy.sourceAreaScale),
    height: Math.round(source.height * WorkspaceDetachedWindowPolicy.sourceAreaScale)
  }
}

export function normalizeDetachedBounds(input: {
  bounds: WorkspaceBounds | undefined
  displays: readonly WorkspaceDisplayInfo[]
  /** 仅作提示；丢失时自动校正到交集最大的显示器。 */
  displayHintId?: string | null
  /** 没有可用 bounds 时的尺寸来源（注册 preferredSize）。 */
  fallbackSize: WorkspaceSize
  /**
   * P2-14：仅当**没有用户 bounds** 时对 `fallbackSize` 生效的尺寸约束（页面窗策略）。
   * 缺省 ⇒ 逐字保持 P1-04 行为：`min(fallbackSize, workArea)`。
   */
  fallbackConstraint?: DetachedWindowSizeConstraint
}): WorkspaceBoundsOutcome {
  const displays = input.displays.filter((display) => isUsableBounds(display.workArea))
  if (displays.length === 0) return { status: 'failed', reason: 'screen-unavailable' }
  const wanted = input.bounds === undefined
    ? { width: input.fallbackSize.width, height: input.fallbackSize.height }
    : { width: input.bounds.width, height: input.bounds.height }
  if (!isUsableBounds(wanted)) return { status: 'failed', reason: 'bounds-invalid' }

  const workArea = pickDisplay(displays, input).workArea
  const size = input.bounds === undefined && input.fallbackConstraint !== undefined
    ? constrainSize(wanted, input.fallbackConstraint, workArea)
    : {
        width: Math.min(Math.round(wanted.width), Math.round(workArea.width)),
        height: Math.min(Math.round(wanted.height), Math.round(workArea.height))
      }
  const width = size.width
  const height = size.height
  // 位置无效（缺失或非有限）⇒ 视为「没有有效位置」并居中校正，绝不把 NaN/Infinity 透传给工厂
  const position = input.bounds !== undefined && Number.isFinite(input.bounds.x) && Number.isFinite(input.bounds.y)
    ? { x: Math.round(input.bounds.x), y: Math.round(input.bounds.y) }
    : null
  const requestedX = position === null ? workArea.x + Math.round((workArea.width - width) / 2) : position.x
  const requestedY = position === null ? workArea.y + Math.round((workArea.height - height) / 2) : position.y
  return {
    status: 'ok',
    bounds: {
      x: clamp(requestedX, workArea.x, workArea.x + Math.round(workArea.width) - width),
      y: clamp(requestedY, workArea.y, workArea.y + Math.round(workArea.height) - height),
      width,
      height
    }
  }
}

/**
 * P2-14 尺寸夹紧：`clamp(候选, minSize, 工作区上界)`，上界 = `min(工作区 × maxWorkAreaRatio, 工作区 − 2×margin)`。
 * 语义优先级（两条都必须在真机上成立）：
 *  - `minSize` 是**默认尺寸下界**：极小工作区时它让位于工作区上界，否则会造出超出屏幕、标题栏抓不到的窗口；
 *  - 工作区是**硬上界**：结果绝不大于工作区（连 `maxWorkAreaRatio` 与 margin 一起夹到 `[1, 工作区]`，
 *    避免退化工作区把窗口夹成 0 或负数）。
 */
function constrainSize(size: WorkspaceSize, constraint: DetachedWindowSizeConstraint, workArea: WorkspaceBounds): WorkspaceSize {
  return {
    width: constrainExtent(size.width, workArea.width, constraint.minSize.width, constraint),
    height: constrainExtent(size.height, workArea.height, constraint.minSize.height, constraint)
  }
}

function constrainExtent(extent: number, workAreaExtent: number, minExtent: number, constraint: DetachedWindowSizeConstraint): number {
  const workAreaRounded = Math.round(workAreaExtent)
  const margin = Math.max(0, Math.round(constraint.workAreaMargin))
  const ratioBound = Math.round(workAreaExtent * constraint.maxWorkAreaRatio)
  const upper = Math.max(1, Math.min(ratioBound, workAreaRounded - 2 * margin, workAreaRounded))
  const lower = Math.max(0, Math.round(minExtent))
  return Math.min(Math.max(Math.round(extent), Math.min(lower, upper)), upper)
}

function pickDisplay(
  displays: readonly WorkspaceDisplayInfo[],
  input: { bounds: WorkspaceBounds | undefined; displayHintId?: string | null }
): WorkspaceDisplayInfo {
  const hinted = input.displayHintId == null ? undefined : displays.find((display) => display.id === input.displayHintId)
  if (hinted) return hinted
  if (input.bounds === undefined) return displays[0]
  let best = displays[0]
  let bestArea = -1
  for (const display of displays) {
    const area = intersectionArea(input.bounds, display.workArea)
    if (area > bestArea) { best = display; bestArea = area }
  }
  return best
}

function intersectionArea(a: WorkspaceBounds, b: WorkspaceBounds): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

function isUsableBounds(value: { width: number; height: number }): boolean {
  return Number.isFinite(value.width) && Number.isFinite(value.height) && value.width > 0 && value.height > 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}
