import { expect, it } from 'vitest'
import { formatCalendarEventFactContext } from './calendarEventFactContext'

const text = { factsHeading: '系统当前事实', factsUnavailable: '系统当前没有这条事件的数据，请勿据此推断', factsPartial: '以下事实不完整，缺失处请直说缺失', factsEvidence: '证据引用' }
const fact = (metric: string, value: string) => ({ factKey: `k-${metric}`, metric, value })

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
