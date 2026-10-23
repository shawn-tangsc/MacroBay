export type MetricEventKind =
  | 'rate'
  | 'inflation'
  | 'employment'
  | 'growth'
  | 'liquidity'
  | 'treasury-yield'
  | 'dollar'
  | 'defi-tvl'
  | 'market-cap'
  | 'fear-greed'
  | 'spot-market'
  | 'funding-rate'
  | 'open-interest'
  | 'long-short-ratio'

export type MetricComparisonBasis =
  | 'actual-vs-forecast'
  | 'actual-vs-previous'
  | 'period-change'
  | 'threshold'
  | 'level'

export type MetricSurpriseDirection = 'above' | 'below' | 'inline' | 'up' | 'down' | 'unknown'

export type MetricIntelligenceEvent = {
  metricEventId: string
  itemId: string
  sourceId: string
  metricKey: string
  metricName: string
  metricKind: MetricEventKind
  actual: number
  forecast?: number
  previous?: number
  unit?: string
  period?: string
  releaseTime: string
  comparisonBasis: MetricComparisonBasis
  surpriseDirection: MetricSurpriseDirection
  surpriseMagnitude?: number
  rawValueJson?: string
  metricVersion: string
}

export type MetricIntelligenceEventDraft = Omit<
  MetricIntelligenceEvent,
  'metricEventId' | 'itemId' | 'metricVersion'
>
