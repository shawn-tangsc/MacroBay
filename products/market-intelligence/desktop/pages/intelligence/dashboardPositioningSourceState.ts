/**
 * 持仓卡两格（「持仓名义额」与「资金费率」）的源可用性。
 *
 * 规范：`docs-private/05-desktop/ui-audit/2026-11-11-source-availability-styles.md` —— 判定顺序固定为
 * **未配置 → 未启用 → 读不到**，三种说法互不冒充。这里只做判定，不碰渲染；渲染用共享的
 * `.mi-source-*` 类（`desktop/shared/styles/sourceAvailability.css`）。
 *
 * 两格同源（都读 `binance-futures-positioning`），但**启用是逐格的**：只关掉一格时另一格照旧显示，
 * 两格都不可用才整卡一句。
 */
import type { CellReadDecision } from './dashboardCellEnabled'
import type { DashboardFundingRateHistoryState } from './dashboardFundingRateHistoryModel'
import type { DashboardPositioningUnavailableCause, DashboardPositioningViewState } from './dashboardOpenInterestModel'

export type PositioningCellState = 'available' | 'missing' | 'disabled' | 'unreadable'

/** 读不到时 ⓘ 里那句原因；未配置/未启用没有原因可讲（它们本身已经说明了下一步）。 */
export type PositioningCellReason = DashboardPositioningUnavailableCause

export type PositioningCells = Readonly<{
  oi: PositioningCellState
  funding: PositioningCellState
  reasons: Readonly<{ oi?: PositioningCellReason; funding?: PositioningCellReason }>
  /**
   * 「这一格没启用」时是**哪个源**没启用（`source-disabled` 才带）。卡片因此能说「Binance 没有启用」，
   * 而不是一句放之四海皆准的「未启用」——2026-11-11 用户现场：两格开着、源关着，卡永远转圈。
   */
  sources?: Readonly<{ oi?: string; funding?: string }>
}>

/**
 * 一格的状态。`configured` 来自源注册表（这一格有没有源与它关联），不是页面现算；`enabled` 来自
 * 格级启用表；两者都成立之后才看这次读到没有。
 */
export function projectPositioningCell(input: Readonly<{
  configured: boolean
  enabled: boolean
  read: 'loading' | 'available' | 'partial' | 'empty' | 'unavailable'
}>): PositioningCellState {
  if (!input.configured) return 'missing'
  if (!input.enabled) return 'disabled'
  // 「空」是读到了、确实没有数据，不是这三种状态。
  if (input.read === 'unavailable') return 'unreadable'
  return 'available'
}

export function projectPositioningCells(input: Readonly<{
  configured: boolean
  /**
   * 每格**自己的判定**（`decideCellRead` 的结果），不压成布尔：压成 `false` 就把
   * 「格关了」「源关了」「源状态读不到」三种原因混成一种，卡片只能一直说「读不到」。
   */
  decisions: Readonly<{ oi: CellReadDecision; funding: CellReadDecision }>
  positioning: DashboardPositioningViewState
  funding: DashboardFundingRateHistoryState
}>): PositioningCells {
  const oi = projectDecidedCell(input, input.decisions.oi, input.positioning.state)
  const funding = projectDecidedCell(input, input.decisions.funding, input.funding.state)
  return Object.freeze({
    oi,
    funding,
    reasons: Object.freeze({
      ...(oi === 'unreadable' && input.positioning.state === 'unavailable' ? { oi: input.positioning.cause } : {}),
      ...(funding === 'unreadable' ? { funding: 'query-failed' as const } : {})
    }),
    sources: Object.freeze({
      ...(input.decisions.oi.kind === 'source-disabled' ? { oi: input.decisions.oi.sourceId } : {}),
      ...(input.decisions.funding.kind === 'source-disabled' ? { funding: input.decisions.funding.sourceId } : {})
    })
  })
}

/**
 * 判定 → 卡的闭集状态：格关了/源关了都落 `disabled`（没启用，不是「读失败」），
 * 源状态读不到落 `unreadable`；只有真的去读的那一格才看这一次读到没有。
 */
function projectDecidedCell(
  input: Readonly<{ configured: boolean }>,
  decision: CellReadDecision,
  read: 'loading' | 'available' | 'partial' | 'empty' | 'unavailable'
): PositioningCellState {
  if (decision.kind === 'not-enabled' || decision.kind === 'source-disabled') return 'disabled'
  if (decision.kind === 'source-unknown') return 'unreadable'
  return projectPositioningCell({ configured: input.configured, enabled: true, read })
}

/**
 * 整卡状态：两格都不可用时只说一句。
 *
 * 顺序就是判定顺序（未配置 → 未启用 → 读不到）：两格原因不同时，读者先要知道「有没有这个东西」，
 * 其次「有没有打开」，最后才是「这次为什么没读到」。
 */
export function projectPositioningCardState(cells: PositioningCells): 'missing' | 'disabled' | 'unreadable' | undefined {
  if (cells.oi === 'available' || cells.funding === 'available') return undefined
  if (cells.oi === 'missing' || cells.funding === 'missing') return 'missing'
  if (cells.oi === 'disabled' || cells.funding === 'disabled') return 'disabled'
  return 'unreadable'
}
