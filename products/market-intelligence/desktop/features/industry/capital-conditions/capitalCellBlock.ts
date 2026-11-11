/**
 * 资金面一格**为什么没有读数**：四种原因，四种句子与动作。
 *
 * 这张卡只允许这四种；「读到了但没读成」不在里面——那由读数自己说（`temporarilyUnavailable`），
 * 和「源状态读不到」共用一句，但动作不同：前者重读，后者重读的是源状态表。
 *
 * 句子与动作只在 `capitalCellBlockSentence` / `capitalCellBlockActionLabel` 各写一次：
 * 表格里的行内状态词、图表块里的词、标题行那颗动作，三处读同一份，不许各拼一套。
 */
export const DASHBOARD_CAPITAL_CELL_BLOCK_KINDS = [
  'cell-off',
  'source-disabled',
  'source-unconfigured',
  'source-unknown'
] as const

export type DashboardCapitalCellBlockKind = typeof DASHBOARD_CAPITAL_CELL_BLOCK_KINDS[number]

export type DashboardCapitalCellBlock = Readonly<{
  kind: DashboardCapitalCellBlockKind
  /** 格关掉时是格名（`ETF`）；源状态时是源名（`0xRouter 聚合行情`）。 */
  label: string
  onAction: () => void
}>

/** 两格各一份；缺键 = 这一格没问题，照旧画读数。 */
export type DashboardCapitalCellAvailability = Readonly<{
  stablecoin?: DashboardCapitalCellBlock
  etf?: DashboardCapitalCellBlock
}>

/**
 * 卡片能拿到的词就这八个，全部现成（`productText` 的共享组 + 设置页那句缺 Key）。
 * 不在这里备第二套默认值：缺串时宁可空着，也不要编一句读者没见过的。
 */
export type CapitalCellBlockText = Readonly<{
  cellNotEnabled: string
  sourceNotEnabled: string
  sourceMissingApiKey: string
  temporarilyUnavailable: string
  enableData: string
  enableSources: string
  configureSources: string
  retry: string
}>

/** 八个键在一处取：卡片标题行与两张表里的行内词读同一份，不在两个文件各拼一套。 */
export function capitalCellBlockText(resolveText: (key: string) => string): CapitalCellBlockText {
  return {
    cellNotEnabled: resolveText('pages.intelligence.portal.dashboard.cellState.notEnabled'),
    sourceNotEnabled: resolveText('pages.intelligence.portal.data.sourcesNotEnabled'),
    sourceMissingApiKey: resolveText('pages.intelligence.portal.data.sourceMissingApiKey'),
    temporarilyUnavailable: resolveText('pages.intelligence.portal.data.temporarilyUnavailable'),
    enableData: resolveText('pages.intelligence.portal.dashboard.crossAsset.enableData'),
    enableSources: resolveText('pages.intelligence.portal.data.enableSources'),
    configureSources: resolveText('pages.intelligence.portal.data.configureSources'),
    retry: resolveText('pages.intelligence.portal.data.retry')
  }
}

export function capitalCellBlockSentence(block: DashboardCapitalCellBlock, text: CapitalCellBlockText): string {
  switch (block.kind) {
    case 'cell-off':
      return `${text.cellNotEnabled}（${block.label}）`
    case 'source-disabled':
      return `${text.sourceNotEnabled}（${block.label}）`
    case 'source-unconfigured':
      // 设置页原句是「还没有配置 API Key」；源名由这张卡拼在前面，词一个字不改。
      return text.sourceMissingApiKey.replace('{source}', block.label)
    case 'source-unknown':
      return text.temporarilyUnavailable
  }
}

export function capitalCellBlockActionLabel(block: DashboardCapitalCellBlock, text: CapitalCellBlockText): string {
  switch (block.kind) {
    case 'cell-off':
      return text.enableData
    case 'source-disabled':
      return text.enableSources
    case 'source-unconfigured':
      return text.configureSources
    case 'source-unknown':
      return text.retry
  }
}
