/**
 * The 市场状态 block's dollar and gold row, offered to the agent as its own read-only tool.
 *
 * It is the same snapshot the panel renders (`createMacroMarketSnapshotQuery`), not a second read
 * path: the dollar row is the licensed `dxy-real` while that feed is fresh and the labelled
 * `dxy-synthetic` otherwise, and gold's level is the stored bar with the live tick beside it.
 * No temporal boundary is declared because the store answers with "now" — there is no historical
 * read to bound — and the tool cannot start an analysis.
 */
export const macroMarketSnapshotTool = Object.freeze({
  id: 'get_macro_market_snapshot',
  readOnly: true,
  requiresTemporalBoundary: false,
  handlerId: 'market-intelligence.get-macro-market-snapshot'
})
