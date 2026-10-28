import { expect, it } from 'vitest'

import type { AgentEvidenceRef, AgentFact, EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisMessages } from './analysisModelPrompt'

/**
 * 结论生成读到的输入（设计 158 §3.2/§3.3）。
 *
 * The fact arrives as 「预期差（实际−预期）」 with its presentation unit already rendered, so the model
 * neither subtracts two display strings nor guesses whether `0.3` means percentage points or a
 * relative percentage.
 */
const asOf = '2026-10-15T12:00:00.000Z'

function snapshot(facts: readonly AgentFact[]): EvidenceSnapshot {
  const evidenceRefs: AgentEvidenceRef[] = [{
    evidenceRefId: 'macro-calendar:macro-calendar-0xrouter-economic-data:event-1', sourceId: 'macro-calendar-0xrouter-economic-data',
    sourceLabel: '0xRouter', itemId: 'event-1', occurredAt: asOf, publishedAt: asOf, detectedAt: asOf,
    computedAt: asOf, visibleAt: asOf, excerptHash: 'hash'
  }]
  return {
    id: 'snapshot', schemaVersion: 1, eventGroupId: 'group', asOf, dataCutoff: asOf, snapshotHash: 'hash',
    profileId: 'crypto-market-analysis-v1', facts, missingDomains: [], caveats: [], evidenceRefs,
    sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
  }
}

function surpriseFact(): AgentFact {
  return {
    factId: 'mi-fact-macro-surprise', domain: 'macro', subject: 'economic-indicator',
    subjectLabel: '9月消费者物价指数(年率)', metric: 'surprise', value: 0.2999999999999998, unit: 'pp',
    sourceId: 'macro-calendar-0xrouter-economic-data', sourceLabel: '0xRouter', observedAt: asOf, asOf,
    freshness: 'fresh', confidence: 0.8, comparability: 'comparable',
    evidenceRefId: 'macro-calendar:macro-calendar-0xrouter-economic-data:event-1'
  }
}

it('hands the model the derived surprise with a readable unit', () => {
  const messages = buildAnalysisMessages(snapshot([surpriseFact()]))
  const user = JSON.parse(String(messages[1]!.content)) as { facts: Array<Record<string, unknown>> }

  expect(user.facts).toHaveLength(1)
  expect(user.facts[0]).toMatchObject({
    metric: '预期差（实际−预期）',
    value: '+0.3 个百分点',
    subject: '经济指标',
    evidenceRef: expect.stringMatching(/^e\d+$/)
  })
})
