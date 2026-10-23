export type IntelligenceAssessmentType = 'rule' | 'ai'

export type IntelligenceAssessment = {
  assessmentId: string
  itemId: string
  clusterId?: string
  assessmentType: IntelligenceAssessmentType
  matchedExposureJson?: string
  matchedWatchlistJson?: string
  direction?: 'bullish' | 'bearish' | 'neutral' | 'mixed'
  strength?: number
  confidence?: number
  horizon?: 'minutes' | 'intraday' | 'swing' | 'long-term'
  sentimentScore?: number
  sentimentLabel?: 'positive' | 'negative' | 'neutral' | 'mixed'
  reasoningJson?: string
  riskNotesJson?: string
  alertDecision: 'notify' | 'timeline-only' | 'suppress'
  riskProfileVersion?: string
  watchlistVersion?: string
  portfolioSnapshotVersion?: string
  policyVersion?: string
  effectiveRevisionId?: string
  engineVersion: string
  createdAt: string
}
