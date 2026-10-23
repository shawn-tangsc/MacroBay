import { describe, expect, it } from 'vitest'

import { classifyStatusIncident } from './statusIncidentClassifier'

describe('statusIncidentClassifier', () => {
  it('classifies active trading outage as full intelligence', () => {
    const result = classifyStatusIncident({
      sourceId: 'coinbase-status',
      title: 'Trading degraded',
      summary: 'Spot trading errors elevated',
      incidentStatus: 'investigating'
    })
    expect(result.outcome).toBe('full-intelligence')
    expect(result.eventSubtype).toBe('status-trading-outage')
  })

  it('classifies API degradation', () => {
    const result = classifyStatusIncident({
      sourceId: 'kraken-status',
      title: 'API latency elevated',
      summary: 'REST API response times degraded',
      incidentStatus: 'identified'
    })
    expect(result.eventSubtype).toBe('status-api-degradation')
  })

  it('classifies resolved updates as context-only', () => {
    const result = classifyStatusIncident({
      sourceId: 'coinbase-status',
      title: 'Trading incident resolved',
      incidentStatus: 'resolved'
    })
    expect(result.outcome).toBe('context-only')
    expect(result.eventSubtype).toBe('status-incident-resolved')
    expect(result.sentimentEligible).toBe(false)
  })

  it('classifies Solana chain outage', () => {
    const result = classifyStatusIncident({
      sourceId: 'solana-status',
      title: 'Block production degraded',
      summary: 'Validator network halt under investigation',
      incidentStatus: 'investigating'
    })
    expect(result.eventSubtype).toBe('status-chain-outage')
  })

  it('ignores minor website incidents', () => {
    const result = classifyStatusIncident({
      sourceId: 'coinbase-status',
      title: 'Marketing website layout issue',
      incidentStatus: 'investigating'
    })
    expect(result.outcome).toBe('ignore')
    expect(result.ignoredReasonCode).toBe('noise-policy-filtered')
  })
})
