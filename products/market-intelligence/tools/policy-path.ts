/**
 * The Fed policy reading, offered to the agent as its own read-only tool.
 *
 * It answers one question the other tools cannot: what the next meeting is priced at, and what the
 * committee's own projections expect. The odds are a market price and the projections belong to the
 * latest meeting that published them, so the tool carries a time boundary and says both.
 */
export const policyPathTool = Object.freeze({
  id: 'get_policy_path',
  readOnly: true,
  requiresTemporalBoundary: true,
  handlerId: 'market-intelligence.get-policy-path'
})
