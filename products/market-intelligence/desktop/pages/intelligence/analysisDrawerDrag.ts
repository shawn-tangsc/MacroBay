/**
 * 抽屉拖动的判据：**只算数，不碰 DOM**。
 *
 * 用户 2026-11-24 拍板 v4（`docs-private/05-desktop/ui-audit/2026-11-24-pad-edge-handle-v3.md`
 * 的后续稿）：从右缘往左推，跟手拉出 AI 分析与舆情。这里只回答三个问题——
 * 这一下按在哪个起点区、这一笔算不算拉抽屉、松手吸附还是回弹。
 *
 * 起点分三层（**不许合并**）：
 * - **A 起拖条**：舞台右缘 0–24px、全高。24 不是拍的：= 看板页内距 20 + 卡内距 4，压 0 个内容像素。
 *   左移 ≥ 4px 就跟手，不要求停留。
 * - **B 其余界面**：左移 > 8px **且** ≥ 1.5 × 竖直位移才算；竖直一旦 > 8px 且大于水平，
 *   整次手势交回滚动（中途不再抢；起拖后竖直变大也不交回）。
 * - **C 自管横向的控件**：今天 0 处。真出现时在这里加一条，别去 B 里打补丁。
 *
 * 窄档底部胶囊（外径 40、距底 12、水平居中）的命中矩形**不加余量**地从起拖条里刨掉：
 * 那块优先归胶囊（点它开聊天框），否则胶囊永远抢不到点击。
 *
 * 吸附线 = 抽屉宽 ÷ 3（并排 151.33、整幅 250），不看速度；跟手 1:1 无阻尼，拖动中 0ms。
 */

/** 底部胶囊的命中矩形（视口坐标）。 */
export type DrawerRect = Readonly<{ left: number; right: number; top: number; bottom: number }>

export type DrawerDragOrigin = 'button' | 'edge' | 'stage'

export type DrawerDragDecision = 'drag' | 'pending' | 'handoff'

export const ANALYSIS_DRAWER_DRAG = {
  /** A 起拖条宽：= 看板页内距 20 + 卡内距 4（压 0 个内容像素）。 */
  edgeWidth: 24,
  /** 窄档底部胶囊：外径 40 = 24 的钮 + 8px 命中区外扩，不加余量。 */
  capsuleHitSize: 40,
  /** 胶囊距视口底 12。 */
  capsuleInset: 12,
  /** A：左移 ≥ 4px 就跟手。 */
  edgeTravel: 4,
  /** B：左移 > 8px…… */
  stageTravel: 8,
  /** ……且 ≥ 1.5 × 竖直位移。 */
  verticalRatio: 1.5,
  /** 吸附线 = 抽屉宽 ÷ 3（并排 151.33、整幅 250）。 */
  snapRatio: 3,
  /** 吸附/回弹的过渡：160ms ease-out，两档同一条（拖动中 0ms，不加过渡）。 */
  settleMs: 160
} as const

function inside(x: number, y: number, rect: DrawerRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

/**
 * 这一下按在哪儿。
 *
 * 圆钮矩形先判——它嵌在起拖条里，先判条就会被条吃掉，圆钮永远抢不到点击。
 */
export function dragOriginAt(input: Readonly<{
  x: number
  y: number
  /** 舞台（页内容区）的矩形。 */
  stage: DrawerRect
  /** 抽屉靠的那一边。 */
  edge: 'left' | 'right'
  /** 底部胶囊命中矩形；没渲染时传 `undefined`。 */
  button?: DrawerRect | undefined
}>): DrawerDragOrigin {
  if (input.button && inside(input.x, input.y, input.button)) return 'button'
  const distance = input.edge === 'right' ? input.stage.right - input.x : input.x - input.stage.left
  return distance >= 0 && distance <= ANALYSIS_DRAWER_DRAG.edgeWidth ? 'edge' : 'stage'
}

/**
 * 这一笔算不算拉抽屉。
 *
 * `pending` = 还没轮到我们判（继续等），`handoff` = 竖直占优，整次手势交回滚动。
 * 交回之后调用方必须**丢掉**这次手势：中途不再抢。
 */
export function dragDecision(input: Readonly<{
  origin: Exclude<DrawerDragOrigin, 'button'>
  /** 向抽屉方向为正的横向位移（右缘＝往左为正）。 */
  dx: number
  /** 竖直位移的绝对值。 */
  dy: number
}>): DrawerDragDecision {
  if (input.dx <= 0) return 'pending'
  if (input.origin === 'edge') return input.dx >= ANALYSIS_DRAWER_DRAG.edgeTravel ? 'drag' : 'pending'
  if (input.dx > ANALYSIS_DRAWER_DRAG.stageTravel && input.dx >= input.dy * ANALYSIS_DRAWER_DRAG.verticalRatio) return 'drag'
  if (input.dy > ANALYSIS_DRAWER_DRAG.stageTravel && input.dy > input.dx) return 'handoff'
  return 'pending'
}

/** 跟手位移：`min(水平位移, 抽屉宽)`，1:1 无阻尼，也不会倒着走。 */
export function dragOffsetFor(dx: number, width: number): number {
  return Math.min(Math.max(dx, 0), Math.max(width, 0))
}

/** 松手：过吸附线（抽屉宽 ÷ 3）展开，否则回弹。 */
export function snapsOpen(offset: number, width: number): boolean {
  return width > 0 && offset >= width / ANALYSIS_DRAWER_DRAG.snapRatio
}

/**
 * 抽屉宽：并排档 **max(50%, 420px)**（用户 2026-11-24 真机：340 太窄，至少半屏），
 * 整幅档就是页宽。仍然是覆盖，不是挤压——看板不重排。
 *
 * 跟手 1:1 与吸附线（宽 ÷ 3）都按这个宽度算，所以它必须与样式里那条 `width` 同源。
 */
export const ANALYSIS_DRAWER_SIZE = { minimum: 420, ratio: 0.5 } as const

export function drawerWidthFor(input: Readonly<{ tier: 'side' | 'full'; stageWidth: number }>): number {
  const stage = Math.max(input.stageWidth, 0)
  return input.tier === 'full' ? stage : Math.max(stage * ANALYSIS_DRAWER_SIZE.ratio, ANALYSIS_DRAWER_SIZE.minimum)
}

/**
 * 两指横向滑（Mac 触摸板）：一段手势的累计与方向。
 *
 * **按手指方向，不按 deltaX 正负写死**：系统「自然滚动」关掉时正负是反的，所以这里只记
 * 「第一次的符号」，同一段手势内保持；开/关由调用方按这个符号决定。
 */
export const ANALYSIS_DRAWER_WHEEL = {
  /** 只认横向为主：`|deltaX| > |deltaY| × 1.5`（竖直为主那是滚页面）。 */
  horizontalRatio: 1.5,
  /** 累计 40px 开/关：触控板一次轻滑只有几 px，单次事件不够。 */
  travel: 40,
  /** 间隔 < 200ms 算同一段手势，超时清零。 */
  sessionMs: 200
} as const

export type WheelSession = Readonly<{ direction: -1 | 1; total: number; at: number }>

/**
 * 这一下 wheel 算不算「滑到阈值」。
 *
 * 返回的 `session` 由调用方原样带进下一次；`fired` 为真时那一发才 `preventDefault()`
 * （没到阈值之前不要拦，页面照常滚）。竖直为主不累计；同一段手势中途翻向不重算。
 */
export function wheelGesture(
  session: WheelSession | undefined,
  input: Readonly<{ deltaX: number; deltaY: number; now: number }>
): Readonly<{ session?: WheelSession; fired: boolean }> {
  const fresh = session === undefined || input.now - session.at >= ANALYSIS_DRAWER_WHEEL.sessionMs
  if (!fresh && session === undefined) return { fired: false }
  if (Math.abs(input.deltaX) <= Math.abs(input.deltaY) * ANALYSIS_DRAWER_WHEEL.horizontalRatio) {
    // 竖直为主：不抢（页面照常滚）。同一段手势里已开始的累计保持，但不再增长。
    return fresh ? { fired: false } : { session, fired: false }
  }
  const direction: -1 | 1 = input.deltaX < 0 ? -1 : 1
  const base = fresh || session === undefined ? { direction, total: 0 } : session
  if (base.direction !== direction) return { session: { ...base, at: input.now }, fired: false }
  const total = base.total + Math.abs(input.deltaX)
  return { session: { direction, total, at: input.now }, fired: total >= ANALYSIS_DRAWER_WHEEL.travel }
}

/**
 * 抽屉相对**自己宽度**的位移（百分比）：`100` = 完全在右缘外（合上），`0` = 完全进来（开着）。
 *
 * 方向语义写在这里，组件只负责把它变成一条 CSS：
 * - 合上 → `100`（右边漏不出看板）；拉开 `offset` → `(宽 − offset) / 宽 × 100`（跟手 1:1）；
 * - 开着 → `0`；回弹 → 回到 `100` 再 `display: none`。
 *
 * 靠左那一边符号取反。**别在组件里写 `translateX(-offset)`**：那是「从静止位往左跑」，
 * 抽屉会停到看板左半边、右边漏一条——2026-11-24 真机就是这个。
 */
export function drawerSlidePercent(input: Readonly<{ offset: number; width: number; edge: 'left' | 'right'; open: boolean }>): number {
  const width = Math.max(input.width, 1)
  const remaining = input.open ? 0 : Math.max(width - Math.max(input.offset, 0), 0)
  const percent = (remaining / width) * 100
  return input.edge === 'right' ? percent : -percent
}
