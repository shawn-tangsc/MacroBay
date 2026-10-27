export type MarketIntelligenceAgentId = 'crypto' | 'stocks' | 'futures'
export type AgentActivationState = 'available' | 'coming-soon'

export type MarketIntelligenceAgent = {
  id: MarketIntelligenceAgentId
  activation: AgentActivationState
  icon: 'bitcoin' | 'chart-line' | 'candlestick'
  portraitAsset: 'mi-crypto-analyst.jpg' | 'mi-equities-analyst.jpg' | 'mi-futures-analyst.jpg'
}

export const marketIntelligenceAgents: MarketIntelligenceAgent[] = [
  { id: 'crypto', activation: 'available', icon: 'bitcoin', portraitAsset: 'mi-crypto-analyst.jpg' },
  { id: 'stocks', activation: 'coming-soon', icon: 'chart-line', portraitAsset: 'mi-equities-analyst.jpg' },
  { id: 'futures', activation: 'coming-soon', icon: 'candlestick', portraitAsset: 'mi-futures-analyst.jpg' }
]
