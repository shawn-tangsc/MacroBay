import { describe, expect, it } from 'vitest'

import { groupCaptionFor, timelineSpansGroups } from './analysisTimelineGrouping'

function entry(eventGroupId: string, groupType: string | null = null, groupSubject: string | null = null) {
  return { eventGroupId, groupType, groupSubject }
}

describe('timelineSpansGroups', () => {
  it('is false for an empty list and for a list scoped to one event', () => {
    expect(timelineSpansGroups([])).toBe(false)
    expect(timelineSpansGroups([entry('mi-eg-1'), entry('mi-eg-1')])).toBe(false)
  })

  it('is true as soon as two events share the page', () => {
    expect(timelineSpansGroups([entry('mi-eg-a'), entry('mi-eg-b'), entry('mi-eg-a')])).toBe(true)
  })
})

describe('groupCaptionFor', () => {
  const labels = { sentiment: '消息面', macro: '宏观', funding: '资金费率' }

  it('names the event and its kind', () => {
    expect(groupCaptionFor(entry('mi-eg-1', 'macro', 'Fed Funds Target Range Upper'), labels))
      .toBe('宏观 · Fed Funds Target Range Upper')
  })

  it('keeps the subject when the kind has no label', () => {
    expect(groupCaptionFor(entry('mi-eg-1', 'cross-asset', 'BTC 相关性强'), labels)).toBe('BTC 相关性强')
  })

  // A row without a name must not be captioned: the conclusion below already speaks, and a bare
  // "消息面" on two identical-looking rows would explain nothing.
  it('says nothing when the event has no name, or when neither field is known', () => {
    expect(groupCaptionFor(entry('mi-eg-1', 'sentiment', null), labels)).toBeNull()
    expect(groupCaptionFor(entry('mi-eg-1', null, null), labels)).toBeNull()
  })
})
