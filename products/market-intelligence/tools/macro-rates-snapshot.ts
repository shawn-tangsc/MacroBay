/**
 * FRED's daily rate block, offered to the agent as its own read-only tool.
 *
 * Official trading-day closes for the 10-year, the 10-year real rate, the 2-year and the 10-year
 * breakeven. Daily granularity is the whole point of the description the manifest carries: the tool
 * exists so a model can read a *level* without mistaking the last close for an intraday figure.
 */
export const macroRatesSnapshotTool = Object.freeze({
  id: 'get_macro_rates_snapshot',
  readOnly: true,
  requiresTemporalBoundary: false,
  handlerId: 'market-intelligence.get-macro-rates-snapshot'
})
