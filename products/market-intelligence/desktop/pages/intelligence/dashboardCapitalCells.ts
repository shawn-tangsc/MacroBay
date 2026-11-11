import type { DashboardCapitalCellAvailability, DashboardCapitalCellBlock } from '../../features/industry/capital-conditions/capitalCellBlock'
import { cellLabel, decideCellRead, type SourceStatusMap } from './dashboardCellEnabled'

/**
 * 资金面那两格「为什么没读数」的宿主侧判定。
 *
 * 判定仍只走 `decideCellRead` 一处（格关 / 源停 / 源状态未知），这里只把它的结论换成卡片能画的东西：
 * 格关闭的标签取**格名**，源状态的标签取**源名**；动作落点由宿主给（都是那一格，读者点进去能看见源）。
 *
 * 源停用与源没配凭据从 `hasCredential` 分开：前者读者去启用，后者读者去配置 Key。
 * `undefined` 状态（源表读不到）不猜成「没配」，卡片那一支只说「暂时读不到」并重读状态表。
 */
const CAPITAL_CELL_KEYS = ['stablecoin', 'etf'] as const

export function resolveCapitalCellAvailability(input: Readonly<{
  cells: Readonly<Record<string, boolean>>
  selections: Readonly<Record<string, string>>
  sources: SourceStatusMap | undefined
  /** 源名从产品注册表（`settings.intelligenceSources.sourceNames`）取，不在这里另列。 */
  sourceLabelOf: (sourceId: string) => string
  /** 这一格的落点：点进去落在 `capital:<cellKey>`。 */
  openCell: (cellKey: string) => () => void
  /** 源状态表本身读不到时的重读入口。 */
  retrySources: () => void
}>): DashboardCapitalCellAvailability {
  const blocks: { stablecoin?: DashboardCapitalCellBlock; etf?: DashboardCapitalCellBlock } = {}
  for (const cellKey of CAPITAL_CELL_KEYS) {
    const decision = decideCellRead({
      moduleId: 'capital',
      cellKey,
      cells: input.cells,
      selections: input.selections,
      sources: input.sources
    })
    if (decision.kind === 'read') continue
    if (decision.kind === 'not-enabled') {
      // 读者关掉的是**格**，不是源：标签必须是格名（ETF / 稳定币），句子与动作也走格级那一套。
      blocks[cellKey] = { kind: 'cell-off', label: cellLabel('capital', cellKey) ?? cellKey, onAction: input.openCell(cellKey) }
      continue
    }
    if (decision.kind === 'source-unknown') {
      blocks[cellKey] = { kind: 'source-unknown', label: input.sourceLabelOf(decision.sourceId), onAction: input.retrySources }
      continue
    }
    // 只有「这条源本来要钥匙、而钥匙没存」才是「还没配置」；免钥匙的源没有 Key 可配，
    // 它没开就是「来源没有启用」——把免钥匙的源说成缺 API Key 是一句读者没法执行的话。
    const unconfigured = decision.requiresCredential && !decision.hasCredential
    blocks[cellKey] = {
      kind: unconfigured ? 'source-unconfigured' : 'source-disabled',
      label: input.sourceLabelOf(decision.sourceId),
      onAction: input.openCell(cellKey)
    }
  }
  return blocks
}
