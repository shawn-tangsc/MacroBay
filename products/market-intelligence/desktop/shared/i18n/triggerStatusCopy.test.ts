import { expect, it } from 'vitest'
import { triggerStatusPolicy } from '../../../service/intelligence/analysis/triggerStatusProjection'
import { explainableTriggerReasonCodes } from '../ipc/marketAnalysisTimelineClient'
import { oneOffTriggerReasons } from '../../pages/intelligence/analysisTriggerStatusPresentation'
import { productText } from './productText'

const reasons = (locale: 'zh-CN' | 'en-US') => productText[locale].pages.intelligence.portal.analysisTimeline.triggerStatus.reasons as Record<string, string>

it('has copy for every decision the panel can show, in both locales', () => {
  const codes = Object.values(triggerStatusPolicy.explainableReasonCodes)
  for (const code of codes) {
    expect(reasons('zh-CN')[code], `zh-CN missing ${code}`).toBeTruthy()
    expect(reasons('en-US')[code], `en-US missing ${code}`).toBeTruthy()
  }
})

it('keeps the two locales in step, with no extra or missing code', () => {
  expect(Object.keys(reasons('zh-CN')).sort()).toEqual(Object.keys(reasons('en-US')).sort())
  expect(Object.keys(reasons('zh-CN')).sort()).toEqual(Object.values(triggerStatusPolicy.explainableReasonCodes).sort())
})

it('never shows a raw token as the user-facing wording', () => {
  for (const [code, text] of Object.entries(reasons('zh-CN'))) expect(text).not.toBe(code)
  for (const [code, text] of Object.entries(reasons('en-US'))) expect(text).not.toBe(code)
})

it('names the label and the since-wording in both locales', () => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    expect(productText[locale].pages.intelligence.portal.analysisTimeline.triggerStatus.label).toBeTruthy()
    expect(productText[locale].pages.intelligence.portal.analysisTimeline.triggerStatus.since).toBeTruthy()
  }
})

it('keeps the service policy, the renderer allow-list and the copy in step', () => {
  // Three copies of one token list, because the renderer may not import the service policy. A
  // token added to only some of them is silently dropped by the client, which is how a
  // reader-triggered row lost its explanation.
  const policy = Object.values(triggerStatusPolicy.explainableReasonCodes).sort()
  expect([...explainableTriggerReasonCodes].sort()).toEqual(policy)
  expect(Object.keys(reasons('zh-CN')).sort()).toEqual(policy)
})

it('keeps the one-off wording list in step with the service policy', () => {
  // A reason in one list but not the other renders "（时间 起）" for a click, or a moment for a
  // condition — either way the panel says something the decision did not.
  expect([...oneOffTriggerReasons].sort()).toEqual([...triggerStatusPolicy.oneOffReasonCodes].sort())
  for (const code of oneOffTriggerReasons) expect(Object.values(triggerStatusPolicy.explainableReasonCodes)).toContain(code)
})

it('keeps the signal reasons free of scheduling vocabulary and severity tiers', () => {
  const zh = reasons('zh-CN')
  const en = reasons('en-US')
  const signalCodes = ['signal-high-triggered', 'signal-medium-triggered', 'signal-cooldown-active',
    'signal-low-marker-only', 'signal-calendar-owned', 'signal-freeze-unavailable']
  // Severity never reaches the interface: the two codes differ so the ledger can be reconciled, the
  // sentence must not — writing "高频档" back into the copy puts the tier on the reader's screen.
  expect(zh['signal-high-triggered']).toBe(zh['signal-medium-triggered'])
  expect(en['signal-high-triggered']).toBe(en['signal-medium-triggered'])
  for (const code of signalCodes) {
    for (const word of ['档', '冷却', '牌子', '那条线', '额度']) expect(zh[code]!, `${code} leaks ${word}`).not.toContain(word)
    for (const word of ['severity', 'high-severity', 'mid-severity', 'low-severity', 'cooldown', 'budget']) {
      expect(en[code]!.toLowerCase(), `${code} leaks ${word}`).not.toContain(word)
    }
  }
  // "Did not run" and "ran and failed" are different facts; this code may only claim the first, or
  // the reader goes looking for a failure that never happened.
  expect(zh['signal-freeze-unavailable']).not.toContain('失败')
  expect(en['signal-freeze-unavailable']).not.toContain('fail')
})
