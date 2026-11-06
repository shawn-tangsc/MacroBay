import { describe, expect, it } from 'vitest'

import { missingTriggerFocus, resolveTriggerFocus } from './analysisTriggerFocus'

const frozen = [{ factId: 'fact-1', evidenceRefId: 'ev-1', subject: '希腊对加密收益征税' }]
const change = (overrides: Record<string, unknown> = {}) => ({
  sequence: 2, previousSnapshotHash: 'h1',
  facts: [{ factId: 'fact-1', domain: 'macro' as const, metric: 'news', kind: 'added' as const, ...overrides }],
  missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: [], caveatsRemoved: [],
  evidenceRefsAdded: [], evidenceRefsRemoved: []
})

const output = (overrides: {
  cited?: string[]
  change?: string
  causalChain?: string
} = {}) => ({
  conclusion: {
    change: overrides.change ?? '希腊对加密收益征税的消息出现。',
    causalChain: overrides.causalChain ?? '征税 → 交易成本上升 → 风险资产承压。'
  },
  supportingEvidence: (overrides.cited ?? ['ev-1']).map(evidenceRefId => ({ statement: 's', evidenceRefId })),
  marketReaction: [],
  directions: []
}) as never

describe('trigger focus mode', () => {
  it('does not run when the snapshot has no change record', () => {
    expect(resolveTriggerFocus({ facts: frozen })).toEqual({ mode: 'not-applicable:no-change', triggers: [] })
  })

  it('does not run when a change fact was cut before freezing', () => {
    const focus = resolveTriggerFocus({ facts: [], change: change() })
    expect(focus.mode).toBe('not-applicable:truncated')
    expect(focus.triggers).toEqual([])
  })

  it('does not run when the change fact kept no evidence reference', () => {
    const focus = resolveTriggerFocus({
      facts: [{ factId: 'fact-1', evidenceRefId: null, subject: 'x' }],
      change: change()
    })
    expect(focus.mode).toBe('not-applicable:truncated')
  })

  it('is strict when every trigger carries its display name', () => {
    expect(resolveTriggerFocus({ facts: frozen, change: change() }).mode).toBe('strict')
  })

  it('degrades to reference-only on an old snapshot whose display name is missing', () => {
    const focus = resolveTriggerFocus({
      facts: [{ factId: 'fact-1', evidenceRefId: 'ev-1' }],
      change: change({ subject: undefined })
    })
    expect(focus.mode).toBe('reference-only')
    expect(focus.triggers).toEqual([{ factId: 'fact-1', evidenceRefId: 'ev-1' }])
  })

  it('takes the change record name first and falls back to the fact name', () => {
    expect(resolveTriggerFocus({ facts: frozen, change: change({ subject: 'Greek tax bill' }) }).triggers[0]!.subject)
      .toBe('Greek tax bill')
  })
})

describe('missing trigger focus', () => {
  const strict = resolveTriggerFocus({ facts: frozen, change: change() })
  const referenceOnly = resolveTriggerFocus({ facts: [{ factId: 'fact-1', evidenceRefId: 'ev-1' }], change: change() })

  it('passes when the answer cites the trigger and names it', () => {
    expect(missingTriggerFocus(output(), strict)).toBe(false)
  })

  it('fails when the answer cites something else', () => {
    expect(missingTriggerFocus(output({ cited: ['ev-2'] }), strict)).toBe(true)
  })

  it('fails when the answer cites the trigger but talks about the backdrop', () => {
    expect(missingTriggerFocus(output({ change: '美元走弱，资金费率回升。', causalChain: '风险偏好回升。' }), strict)).toBe(true)
  })

  it('accepts either half alone on the degraded criterion', () => {
    expect(missingTriggerFocus(output({ change: '美元走弱。', causalChain: '风险偏好回升。' }), referenceOnly)).toBe(false)
    expect(missingTriggerFocus(output({ cited: ['ev-2'] }), referenceOnly)).toBe(true)
  })

  it('passes any run whose rule never applied', () => {
    const notApplicable = resolveTriggerFocus({ facts: frozen })
    expect(missingTriggerFocus(output({ cited: [], change: 'x', causalChain: 'y' }), notApplicable)).toBe(false)
  })
})
