import type { BindingPolicy, PanelContainerMode, WorkspaceLifecycleEventType, WorkspaceSize } from './contracts'

/**
 * Owner: platform/workspace/registry。权威：技术设计 §3 / §8。
 * 仅平台产品/架构评审可修改；非法静态声明拒绝，不推测能力或加载路径。
 * 回归：panelRegistry.test.ts、workspaceContributions.test.ts。
 */
export const WorkspaceRegistrationPolicy = Object.freeze({
  stableIdPattern: /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/,
  localIdPattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  modes: Object.freeze<readonly PanelContainerMode[]>(['embedded', 'docked-right', 'docked-bottom', 'detached']),
  fallbackMode: 'embedded' as const,
  bindingPersistence: Object.freeze<readonly BindingPolicy['persistence'][]>(['none', 'session', 'durable']),
  maxBindingKeyBytes: 256,
  minSize: Object.freeze({ width: 320, height: 240 }),
  preferredSize: Object.freeze({ width: 480, height: 360 }),
  lifecycleEvents: Object.freeze<readonly WorkspaceLifecycleEventType[]>([
    'open', 'close', 'restore', 'host-attach', 'host-detach', 'host-reparent',
    'container-change-requested', 'container-changing', 'container-changed', 'fallback'
  ]),
  panelFields: Object.freeze([
    'panelId', 'title', 'icon', 'module', 'pageIds', 'supportedModes', 'defaultMode',
    'allowMultipleInstances', 'minSize', 'preferredSize', 'binding', 'lifecycleEvents'
  ])
})

export const WorkspaceOwnershipPolicy = Object.freeze({
  initialWindowInstanceId: 'main',
  initialHostEpoch: 1,
  requestHistoryLimit: 128
})

export const WorkspaceCommandQueuePolicy = Object.freeze({ maxPendingCommands: 64 })

export const WorkspaceTransferPolicy = Object.freeze({
  maxDetachedHosts: 8,
  prepareTargetTimeoutMs: 10_000,
  releaseTimeoutMs: 2_000,
  preparationPhase: Object.freeze({ sourcePrepared: 'awaiting-source-prepared' as const, targetReady: 'awaiting-target-ready' as const, sourceRelease: 'awaiting-source-release' as const })
})

/**
 * Owner: platform/workspace/registry（P2-01）。权威：技术设计 §3.3 / §3.4 / §8。
 * 一级菜单页统一注册：内置三项 + 全部产品菜单页；Settings 内部二级面板不得注册为顶层页。
 * 旧菜单缺扩展字段时按这里的默认值补齐（可分离、单实例、无绑定），既不隐藏也不报错。
 */
export const WorkspacePageRegistrationPolicy = Object.freeze({
  pageFields: Object.freeze([
    'pageId', 'menuKey', 'title', 'titleKey', 'icon', 'module', 'productId',
    'supportsDetached', 'allowMultipleInstances', 'binding'
  ]),
  menuKeyPattern: /^(?:\/)?[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/,
  maxMenuKeyLength: 200,
  /** §3.3：Phase 2 每个一级菜单都 supportsDetached；§3.4：内置页固定单实例。 */
  defaultSupportsDetached: true as const,
  defaultAllowMultipleInstances: false as const,
  /** §3.4：旧菜单默认「无绑定」，绑定由内容 owner 经 bindPage/bindPanel 补。 */
  defaultBindingPersistence: 'none' as const
})

/**
 * Owner: platform/workspace/registry（P2-14）。权威：技术设计 §4「窗口安置策略」/ §6 与 P2-14 真机缺陷
 * 「独立页面窗默认太小、正文只有左上角一小块」。
 *
 * P2-14 之前，页面窗（`detached-tab`）**借用面板注册的** `WorkspaceRegistrationPolicy.preferredSize`
 * （480×360）当默认尺寸，因此新开的页面窗只有面板大小；真机上用户看到的「太小」正是这个 480×360。
 * PLAT-06（2026-10-06）：再把两个上界旋钮**调小一档**（1.25→1.10、0.9→0.80）以消除「贴着满屏」的观感。
 *
 * 语义（按优先级，缺一不可）：
 *  1) **用户已调整过的 bounds**（P2-04 v2 文档 / `panel.detachedBounds`）优先：策略绝不覆盖用户尺寸，
 *     只做工作区内的夹紧（见 `normalizeDetachedBounds`）；
 *  2) 没有用户 bounds 时，候选尺寸 = 源区域 × `sourceAreaScale`（推荐语义：比源区域更大才叫「独立窗口」；
 *     真机上源区域取主窗**内容区**尺寸，由 Main 从 IPC sender 的真实窗口测量，见 `workspaceSourceArea.ts`）；
 *     源区域信息不可用时用 `defaultSize`（不再复用面板 preferredSize）；
 *  3) 候选尺寸再被 `minSize`（下界）、`maxWorkAreaRatio`（相对显示器工作区的最大占比）与
 *     `workAreaMargin`（与工作区边缘的最小可见留白）夹紧；**工作区是不可越过的硬上界**：
 *     极小工作区时上界胜出，绝不产生超出工作区的窗口（那会让标题栏不可抓取）。
 */
export const WorkspaceDetachedWindowPolicy = Object.freeze({
  /** 页面窗默认尺寸的下界（DIP）：低于 960×600 的独立页面窗在真机上不可用（正文只有一块）。 */
  minSize: Object.freeze<WorkspaceSize>({ width: 960, height: 600 }),
  /** 无源区域信息时的兜底默认尺寸（DIP）：只作候选，仍受 minSize / 工作区上界夹紧。 */
  defaultSize: Object.freeze<WorkspaceSize>({ width: 1280, height: 800 }),
  /**
   * 有源区域信息时的放大比例：源区域 × 1.10。
   * PLAT-06（PM 裁决「调小一档」，2026-10-06）：旧值 1.25 让默认页窗贴着工作区上界（真机实测 1555×923，
   * 观感接近满屏）。调为 1.10 ⇒ 默认尺寸回到「比主窗源区域略大的舒适尺寸」，仍严格大于源区域。
   */
  sourceAreaScale: 1.1,
  /**
   * 相对显示器工作区（含菜单栏/Dock 扣除后的区域）的最大占比。
   * PLAT-06：旧值 0.9 让上界成为多数场景的实际尺寸（1728×1026 工作区 ⇒ 1555×923）。调为 0.80
   * ⇒ 上界 1382×821，只在真正需要时才夹紧；`minSize` 与「工作区是硬上界」的判据均不放宽。
   */
  maxWorkAreaRatio: 0.8,
  /** 与工作区边缘的最小可见留白（DIP）：标题栏/边框永远可抓取，绝不贴死屏幕边缘。 */
  workAreaMargin: 8
})

/**
 * Owner: platform/workspace（**PLAT-39 ①：分离窗顶栏与主窗同款**）。
 *
 * 命名高度策略：分离窗（页窗与面板窗）的自绘顶栏高度必须与**主窗顶栏**逐字一致。
 * 主窗顶栏高度由全局 token `--topbar-height`（`styles.css` 的 `:root`）定义 = 42px；
 * 这里把同一数值具名，供渲染侧的**几何判据**（P2-14：内容区 = 窗高 − 顶栏高）与真机复核共用，
 * 调用点因此不出现匿名数字。改任一处必须同时改 `styles.css` 的 `--topbar-height`（同一策略）。
 */
export const WorkspaceWindowChromePolicy = Object.freeze({
  /** 与主窗 `.topbar` 同高（px）。 */
  topBarHeight: 42,
  /** 顶栏左侧为 macOS 红绿灯让位的宽度（px），与 `--traffic-light-width` 同源。 */
  trafficLightWidth: 78,
  /** 与 `styles.css` 的 `--topbar-height` 逐字对应的 CSS 变量名（渲染侧写高度时用它，不写匿名数字）。 */
  topBarHeightVar: '--topbar-height'
})

/**
 * Owner: platform/workspace/runtime（P2-01）。权威：技术设计 §5.4 / §8。
 * Tab runtime 的全部容量/上界在此具名；调用点不得出现匿名数字。
 */
export const WorkspaceTabPolicy = Object.freeze({
  /** §8：最坏 32 页面；达到上限拒绝新开，绝不逐出已打开实例。 */
  maxOpenTabs: 32,
  /** §5.4：最近关闭只保留会话内存 10 条，重启不自动重开。 */
  maxRecentlyClosed: 10,
  /** 与 Main 侧请求字段上界同量级，用于 Tab 视图字段的形状护栏。 */
  maxTabKeyLength: 200
})
