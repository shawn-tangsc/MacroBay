import { describe, expect, it } from 'vitest'

import { shouldAutoRenameAssistantTopic, summarizeAssistantTopicFallback } from './assistantTopicAutoTitle'

describe('assistantTopicAutoTitle', () => {
  it('allows auto rename only for default topic names', () => {
    expect(shouldAutoRenameAssistantTopic({ name: 'New topic', isNameManuallyEdited: false })).toBe(true)
    expect(shouldAutoRenameAssistantTopic({ name: 'Custom', isNameManuallyEdited: true })).toBe(false)
  })

  it('summarizes fallback titles with length limit', () => {
    expect(summarizeAssistantTopicFallback('short title')).toBe('short title')
    expect(summarizeAssistantTopicFallback('x'.repeat(60)).length).toBeLessThanOrEqual(48)
  })
})
