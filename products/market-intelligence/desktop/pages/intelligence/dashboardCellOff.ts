import type { CellReadDecision } from './dashboardCellEnabled'

/**
 * 一格不能读时的那句话素材：**先看判定 kind，不压成布尔**（2026-11-12 用户现场：ETF 那格开着、
 * 0xRouter 这个源关着，卡片只画红边，从不说缺的是哪个源）。
 *
 * - `not-enabled` → 说**这一格**（格名）；
 * - `source-disabled` → 说**那个源**（源显示名）；
 * - `read` / `source-unknown` → 不给这句（读不到由卡片自己的「读不到」承担）。
 *
 * 返回 `undefined` 表示「这一格不需要说没启用」，落点动作由宿主补（它才知道抽屉怎么开）。
 */
export function cellOffLabel(input: Readonly<{
  decision: CellReadDecision
  cellLabel: string | undefined
  sourceName: (sourceId: string) => string
}>): string | undefined {
  if (input.decision.kind === 'not-enabled') return input.cellLabel ?? ''
  if (input.decision.kind === 'source-disabled') return input.sourceName(input.decision.sourceId)
  return undefined
}
