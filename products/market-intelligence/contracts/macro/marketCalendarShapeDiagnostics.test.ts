import { describe, expect, it } from 'vitest'

import { explainShapeMismatch } from './marketCalendarShapeDiagnostics'

describe('形状不匹配的失败说明', () => {
  it('说清缺哪个键——这正是不说的话要靠人比对数组的那一步', () => {
    const event = { eventKey: 'a', timePrecision: 'minute', rowKind: 'release' }
    expect(explainShapeMismatch(event, ['eventKey'], ['timePrecision']))
      .toBe('多余键：rowKind')
    expect(explainShapeMismatch({ eventKey: 'a' }, ['eventKey', 'sourceFeedId'], ['timePrecision']))
      .toBe('缺少键：sourceFeedId')
  })

  it('两边都对得上时明确说「失败在取值，不在键集」——别让人误以为是漏字段', () => {
    expect(explainShapeMismatch({ a: 1 }, ['a'])).toBe('键集完全匹配（失败在取值，不在键集）')
    expect(explainShapeMismatch(null, ['a'])).toBe('期望对象，实际 null')
  })
})
