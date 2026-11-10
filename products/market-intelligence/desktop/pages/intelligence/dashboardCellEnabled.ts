import { useEffect, useRef, useState } from 'react'

import type { CrossAssetStatusId } from '../../features/industry/cross-asset/crossAssetStatusRegistry'
import type { DashboardFeedRow, DashboardFeedRowId } from './dashboardFeedStatusModel'
import { DASHBOARD_SOURCE_MODULES, cellIdOf } from '../../settings/intelligence-sources/dashboardSourceModules'

/**
 * 看板按「格级启用」读不读、画不画。
 *
 * 键与稳定 id 只有一处来源：`dashboardSourceModules.ts` 的 `CELL_SLUGS` / `cellIdOf`。这里**不拼
 * 字符串**，只按 `(moduleId, cellKey)` 去那张表里取——拼一个 `quotes:ndx` 出来就是第二份定义。
 *
 * 三条语义：
 * - **缺键 = 启用**：存储只回显式写过的键，没写过的格子照旧读（`isCellEnabled`）。
 * - **一格关掉 ≠ 源关掉**：同源的其它格照旧读、照旧采；只有这个格不画、不把它的读数交给卡片。
 * - **读失败 = 沿用上一次**：第一次读失败就是「全都启用」。关掉整屏比多读一格糟得多。
 */

export type CellEnabledIo = Readonly<{
  read: () => Promise<Record<string, boolean>>
  /** 每格选了哪个源；缺键 = 没选过（用默认主源）。 */
  readSelection?: () => Promise<Record<string, string>>
}>

/** 看板格 id：`(moduleId, cellKey)` 经唯一那张表换算，别处不许再拼。 */
export function dashboardCellId(moduleId: string, cellKey: string): string {
  const cell = DASHBOARD_SOURCE_MODULES.find((module) => module.id === moduleId)?.cells.find(
    (candidate) => candidate.cellKey === cellKey
  )
  if (cell === undefined) throw new Error(`Unknown dashboard cell: ${moduleId}:${cellKey}`)
  return cellIdOf(moduleId, cell)
}

/**
 * 市场状态表的行 → 它读的那一格。
 *
 * 一行可能有两个格：美元 / 黄金各有主源与备用源，两格同属一行——**任一启用**就算这行在读。
 * `realRate` 与 `10Y` 同读 FRED 那一份快照，所以共用 `quotes:ust10y`。
 */
export const QUOTES_STATUS_ROW_CELLS: Readonly<Record<CrossAssetStatusId, readonly string[]>> = Object.freeze({
  index: [dashboardCellId('quotes', 'ndx')],
  btc: [dashboardCellId('quotes', 'btc')],
  eth: [dashboardCellId('quotes', 'eth')],
  dxy: [dashboardCellId('quotes', 'usd'), dashboardCellId('quotes', 'usd-fallback')],
  gold: [dashboardCellId('quotes', 'gold'), dashboardCellId('quotes', 'gold-fallback')],
  us10y: [dashboardCellId('quotes', 'ust10y')],
  realRate: [dashboardCellId('quotes', 'ust10y')]
})

/**
 * 一格可以选哪些源：这一格的主源 + 紧跟其后的备用行（`fallback: true`）。
 * 源名仍从那一处表取，不在这里另列；配对靠表里的行结构，不靠格名里的「（备用）」后缀。
 */
export function cellSourceChoices(moduleId: string, cellKey: string): readonly string[] {
  const module = DASHBOARD_SOURCE_MODULES.find((candidate) => candidate.id === moduleId)
  const index = module?.cells.findIndex((candidate) => candidate.cellKey === cellKey) ?? -1
  const cell = index >= 0 ? module?.cells[index] : undefined
  if (module === undefined || cell === undefined) return []
  // 备用行紧跟在主行后面（`fallback: true`），这是表里的结构，不靠格名去猜「（备用）」。
  const sources = [cell.sourceId]
  for (const next of module.cells.slice(index + 1)) {
    if (next.fallback !== true) break
    sources.push(next.sourceId)
  }
  return sources
}

/**
 * 美元格选了哪个源（没选 / 选了不在这格范围内的源 → undefined，走默认规则）。
 *
 * 格 id 随卡片合并不是固定的：`490231e` 把「跨资产」并入「行情卡」之后，美元格只剩
 * `quotes:usd`（旧的 `cross-asset:usd` 已不存在）。所以这里仍经 `dashboardCellId` 查表，
 * 别处不会拿着一个已经消失的键去读。
 */
export function selectedDollarSourceId(
  selections: Readonly<Record<string, string>>
): string | undefined {
  const cellId = dashboardCellId('quotes', 'usd')
  const chosen = selections[cellId]
  if (chosen === undefined) return undefined
  const allowed = new Set(cellSourceChoices('quotes', 'usd'))
  return allowed.has(chosen) ? chosen : undefined
}

/** 源级启用表：`sourceId → enabled`；整表读不到时是 undefined（未知），不许当成「全都启用」。 */
export type SourceEnabledMap = Readonly<Record<string, boolean>>

/**
 * 一处读点的决定，只有四种。三种显示句子与它一一对应，不许混：
 * - `read`：这一格选中的源启用了，去读（`sourceId` 就是读哪一个；`explicit` 表示读者显式选过）；
 * - `not-enabled`：这一格没选中（`cells === false`）或没有可选的源 → **数据未被启用**；
 * - `source-disabled`：选中的源被停用 → **数据未被启用**；
 * - `source-unknown`：源状态读不到 → **暂时读不到**（不许默认成启用）。
 */
export type CellReadDecision =
  | Readonly<{ kind: 'read'; sourceId: string; explicit: boolean }>
  | Readonly<{ kind: 'not-enabled' }>
  | Readonly<{ kind: 'source-disabled'; sourceId: string }>
  | Readonly<{ kind: 'source-unknown'; sourceId: string }>

export function decideCellRead(input: Readonly<{
  moduleId: string
  cellKey: string
  cells: Readonly<Record<string, boolean>>
  selections: Readonly<Record<string, string>>
  /** 源级启用表；`undefined` = 这一份还没读到/读不到 → 未知。 */
  sources: SourceEnabledMap | undefined
}>): CellReadDecision {
  const cellId = dashboardCellId(input.moduleId, input.cellKey)
  if (!isCellEnabled(input.cells, cellId)) return { kind: 'not-enabled' }
  const choices = cellSourceChoices(input.moduleId, input.cellKey)
  const explicit = input.selections[cellId]
  const chosen = explicit !== undefined && choices.includes(explicit) ? explicit : choices[0]
  if (chosen === undefined) return { kind: 'not-enabled' }
  if (input.sources === undefined) return { kind: 'source-unknown', sourceId: chosen }
  const enabled = input.sources[chosen]
  if (enabled === undefined) return { kind: 'source-unknown', sourceId: chosen }
  return enabled
    ? { kind: 'read', sourceId: chosen, explicit: explicit !== undefined && explicit === chosen }
    : { kind: 'source-disabled', sourceId: chosen }
}

export function isCellEnabled(cells: Readonly<Record<string, boolean>>, cellId: string): boolean {
  return cells[cellId] ?? true
}

export function isAnyCellEnabled(cells: Readonly<Record<string, boolean>>, cellIds: readonly string[]): boolean {
  return cellIds.some((cellId) => isCellEnabled(cells, cellId))
}

/** 来源状态条的每一行也读某一格：关掉那一格，这行不再出现（不是写「不可用」）。 */
export const FEED_ROW_CELLS: Readonly<Record<DashboardFeedRowId, readonly string[]>> = Object.freeze({
  dollar: QUOTES_STATUS_ROW_CELLS.dxy,
  gold: QUOTES_STATUS_ROW_CELLS.gold,
  rates: QUOTES_STATUS_ROW_CELLS.us10y,
  index: QUOTES_STATUS_ROW_CELLS.index
})

export function filterFeedRowsByCells(
  rows: readonly DashboardFeedRow[],
  cells: Readonly<Record<string, boolean>>
): readonly DashboardFeedRow[] {
  return rows.filter((row) => isAnyCellEnabled(cells, FEED_ROW_CELLS[row.id]))
}

export type DashboardReadGates = Readonly<{
  /** 不画的行（不是画 0、不是占位）：交给市场状态表按 id 过滤。 */
  hiddenStatusRows: readonly CrossAssetStatusId[]
  /** 这一路读还有没有任何一格要看；没有就不发请求。 */
  crossAsset: boolean
  macroMarket: boolean
  macroRates: boolean
  fearGreed: boolean
  capital: boolean
  positioning: boolean
  policyPath: boolean
}>

export function resolveDashboardReadGates(cells: Readonly<Record<string, boolean>>): DashboardReadGates {
  const rowEnabled = (row: CrossAssetStatusId): boolean => isAnyCellEnabled(cells, QUOTES_STATUS_ROW_CELLS[row])
  const rows = Object.keys(QUOTES_STATUS_ROW_CELLS) as CrossAssetStatusId[]
  return {
    hiddenStatusRows: rows.filter((row) => !rowEnabled(row)),
    // 图表与三行同读一份跨资产快照：三格都关掉才停这一路。
    crossAsset: rowEnabled('index') || rowEnabled('btc') || rowEnabled('eth'),
    macroMarket: rowEnabled('dxy') || rowEnabled('gold'),
    macroRates: rowEnabled('us10y'),
    fearGreed: isCellEnabled(cells, dashboardCellId('fear-greed', 'index')),
    capital: isAnyCellEnabled(cells, [dashboardCellId('capital', 'stablecoin'), dashboardCellId('capital', 'etf')]),
    positioning: isAnyCellEnabled(cells, [dashboardCellId('positioning', 'oi'), dashboardCellId('positioning', 'funding')]),
    policyPath: isCellEnabled(cells, dashboardCellId('policy-path', 'probability'))
  }
}

/**
 * 读一次格级启用表。**没有注入读口时按「全都启用」**（与缺键同义）；读失败沿用上一次——
 * 一次读失败不许把整屏关掉。
 */
export type DashboardCellEnabledState = Readonly<{
  /** 启用表读完了没有。没读完之前一处都不读——否则「关掉的格」在首帧仍会发一次请求。 */
  ready: boolean
  cells: Readonly<Record<string, boolean>>
  /** 每格选的源；缺键 = 没选过。 */
  selections: Readonly<Record<string, string>>
}>

export function useDashboardCellEnabled(input: { io?: CellEnabledIo }): DashboardCellEnabledState {
  const [state, setState] = useState<DashboardCellEnabledState>({ ready: input.io === undefined, cells: {}, selections: {} })
  const lastKnown = useRef<Readonly<Record<string, boolean>>>({})
  const lastSelection = useRef<Readonly<Record<string, string>>>({})
  useEffect(() => {
    const io = input.io
    if (io === undefined) {
      // 没有读口 = 全都启用，并且立刻可以开始读。
      setState({ ready: true, cells: lastKnown.current, selections: lastSelection.current })
      return
    }
    let active = true
    // 启用与选源是同一份文档的两块：一起读，一起就绪；任一读失败沿用上一次（第一次失败 = 全启用 + 全默认源）。
    void Promise.all([
      io.read(),
      io.readSelection === undefined ? Promise.resolve(lastSelection.current) : io.readSelection()
    ]).then(([saved, selections]) => {
      if (!active) return
      lastKnown.current = saved
      lastSelection.current = selections
      setState({ ready: true, cells: saved, selections })
    }).catch(() => {
      if (!active) return
      setState({ ready: true, cells: lastKnown.current, selections: lastSelection.current })
    })
    return () => { active = false }
  }, [input.io])
  return state
}
