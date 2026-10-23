export type IntelligenceReevaluationTrigger =
  | 'watchlist'
  | 'portfolio'
  | 'risk-profile'
  | 'cluster-membership'

export type IntelligenceReevaluationPlan = {
  jobs: Array<{
    jobId: string
    payload: Record<string, unknown>
  }>
}

const MAX_BOUNDED_JOBS = 10

export function planIntelligenceReevaluation(input: {
  trigger: IntelligenceReevaluationTrigger
  changedSymbols?: string[]
  changedScopeKeys?: string[]
  clusterIds?: string[]
  itemIds?: string[]
}): IntelligenceReevaluationPlan {
  switch (input.trigger) {
    case 'watchlist':
      return {
        jobs: (input.changedSymbols ?? [])
          .slice(0, MAX_BOUNDED_JOBS)
          .map((scopeKey) => ({
            jobId: 'market-intelligence.reevaluateClusters',
            payload: { scopeType: 'watchlist', scopeKey }
          }))
      }
    case 'portfolio':
      return {
        jobs: (input.changedSymbols ?? [])
          .slice(0, MAX_BOUNDED_JOBS)
          .map((scopeKey) => ({
            jobId: 'market-intelligence.reevaluateClusters',
            payload: { scopeType: 'active-position', scopeKey }
          }))
      }
    case 'risk-profile':
      return {
        jobs: [
          {
            jobId: 'market-intelligence.reevaluateSentimentScopes',
            payload: { scopeType: 'market-wide', scopeKey: 'global' }
          }
        ]
      }
    case 'cluster-membership':
      return {
        jobs: (input.clusterIds ?? []).slice(0, MAX_BOUNDED_JOBS).map((clusterId) => ({
          jobId: 'market-intelligence.reevaluateClusters',
          payload: {
            clusterId,
            itemIds: input.itemIds ?? []
          }
        }))
      }
    default:
      return { jobs: [] }
  }
}
