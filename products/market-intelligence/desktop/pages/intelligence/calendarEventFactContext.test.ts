import { describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { formatCalendarEventFactContext } from './calendarEventFactContext'

const text = { factsHeading: '系统当前事实', factsUnavailable: '系统当前没有这条事件的数据，请勿据此推断', factsPartial: '以下事实不完整，缺失处请直说缺失', factsEvidence: '证据引用' }
// The contract's fact is `{ factId, metric, value }`; the formatter prints only `metric value`, so the
// identity is derived here rather than invented per call site.
const fact = (metric: string, value: string) => ({ factId: `fact-${metric}`, metric, value })

it('lists the facts and their evidence when the context is complete', () => {
  const block = formatCalendarEventFactContext({ facts: [fact('实际值', '0.3%'), fact('市场预期', '0.2%')], evidenceRefs: ['macro-calendar:official:US.CPI'], coverage: 'available', caveats: [] }, text)
  expect(block).toContain('实际值 0.3%')
  expect(block).toContain('证据引用: macro-calendar:official:US.CPI')
  expect(block).not.toContain('不完整')
})

it('says the facts are incomplete rather than presenting them as the whole picture', () => {
  const block = formatCalendarEventFactContext({ facts: [fact('市场预期', '0.2%')], evidenceRefs: [], coverage: 'partial', caveats: ['event-values-missing'] }, text)
  expect(block).toContain('以下事实不完整，缺失处请直说缺失')
  expect(block).toContain('市场预期 0.2%')
})

it('tells the agent nothing is held instead of handing it an empty list', () => {
  const block = formatCalendarEventFactContext({ facts: [], evidenceRefs: [], coverage: 'unavailable', caveats: ['no-facts-held'] }, text)
  expect(block).toBe('[系统当前事实: 系统当前没有这条事件的数据，请勿据此推断]')
  expect(block).not.toContain('\n')
})

it('uses the unreadable sentence when the month could not be read and the copy provides it', () => {
  const text = { factsHeading: 'F', factsUnavailable: 'nothing held', factsPartial: 'partial', factsEvidence: 'E', factsUnreadable: 'could not read' }
  const block = formatCalendarEventFactContext({ facts: [], evidenceRefs: [], coverage: 'unavailable', caveats: ['calendar-unreadable'] }, text)
  expect(block).toContain('could not read')
  expect(block).not.toContain('nothing held')
})

describe('calendar facts copy', () => {
  /**
   * 「这段时间的日历没读到」与「读到了但没有这条事件」必须是两句（2026-11-14）。
   * 前者来自 `factsUnreadable`、后者来自 `factsUnavailable`；合并回去就是又把
   * 「拿不到」画成「确实没有」——这轮反复拆的正是这一处。
   */
  it('carries a separate unread sentence in both languages', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const context = productText[language].pages.intelligence.portal.calendarCard.eventContext as Record<string, string>
      expect(context.factsUnreadable, language).toBeTruthy()
      expect(context.factsUnreadable, language).not.toBe(context.factsUnavailable)
    }
  })
})
