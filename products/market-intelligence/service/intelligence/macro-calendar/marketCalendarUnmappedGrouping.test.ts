import { describe, expect, it } from 'vitest'

import { mergedReasonOf } from './marketCalendarUnmappedGrouping'

/**
 * **合并后原因按语义分组判定**（Chief 2026-11-18）：不取「先到那条」，也不「有行就算缺期次」。
 * 红过的那次：真库 70 条 `no-code` 被抹成「缺统计期」，读者再也筛不出「要建码」那批。
 */
const row = (reason: string, hasStandardRow: boolean) => ({
  sourceId: '1', scheduledDate: '2026-11-17', title: 't', reason, hasStandardRow
})

describe('合并后原因：组内一起看', () => {
  it('组内一条有行、一条 no-code → 报「没有对应的码」', () => {
    expect(mergedReasonOf([row('no-standard-row', false), row('no-code', true)])).toBe('no-code')
  })

  it('组内都有行、一条 no-code 一条 period-unresolved → 报「没有对应的码」（缺码优先）', () => {
    expect(mergedReasonOf([row('period-unresolved', true), row('no-code', true)])).toBe('no-code')
  })

  it('组内全无行 → 「没进标准表」', () => {
    expect(mergedReasonOf([row('no-standard-row', false), row('no-standard-row', false)])).toBe('no-standard-row')
  })

  it('组内有事件 → 事件（不受其它原因影响）', () => {
    expect(mergedReasonOf([row('unknown-event-type', false), row('no-code', true)])).toBe('unknown-event-type')
  })
})
