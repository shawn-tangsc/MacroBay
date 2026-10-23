import { expect, it } from 'vitest'
import type { EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisMessages } from './analysisModelPrompt'
import type { SignificanceSignal } from './significanceChangeMatcher'

const snapshot = {
  id: 'mi-es-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', asOf: '2026-10-09T12:00:00.000Z', dataCutoff: '2026-10-09T12:00:00.000Z',
  snapshotHash: 'hash', profileId: 'crypto-market-analysis-v1', facts: [], missingDomains: [], caveats: [], evidenceRefs: [],
  sourceHealth: [], createdAt: '2026-10-09T12:00:00.000Z', policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
} as unknown as EvidenceSnapshot

const signal: SignificanceSignal = {
  kind: 'actual-changed', eventKey: 'US.CPI.RELEASE.2026-M09', titleKey: 'cpi', metric: 'actual', importance: 'high',
  previousValue: '3.1%', value: '3.2%'
}

const parts = (messages: readonly { role: string; content: string }[]) => ({
  system: messages.find(message => message.role === 'system')!.content,
  user: JSON.parse(messages.find(message => message.role === 'user')!.content) as Record<string, unknown>
})

it('tells the model why it was woken, and demands the change be explained', () => {
  const { system, user } = parts(buildAnalysisMessages(snapshot, [signal]))
  expect(user.triggers).toEqual([expect.stringContaining('消费者物价指数（CPI）')])
  expect(system).toContain('逐条解读这些触发变化')
  expect(system).toContain('禁止用资金面、情绪等其他事实替代对触发变化的解读')
})

it('omits the segment entirely when there is nothing to explain', () => {
  const { system, user } = parts(buildAnalysisMessages(snapshot))
  expect(user).not.toHaveProperty('triggers')
  expect(system).not.toContain('逐条解读这些触发变化')
  // The pre-existing contract is untouched.
  expect(user.change).toBeDefined()
  expect(system).toContain('conclusion.change')
})
