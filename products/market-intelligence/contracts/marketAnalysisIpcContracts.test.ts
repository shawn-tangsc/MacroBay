import { expect, it } from 'vitest'
import { isMarketAnalysisCalendarEventContextInput, MARKET_ANALYSIS_IPC_METHODS } from './marketAnalysisIpcContracts'

it('names the context method like the other product methods', () => {
  expect(MARKET_ANALYSIS_IPC_METHODS.calendarEventContext).toBe('marketAnalysis.calendarEventContext')
})

it('accepts only the event, its month and an instant', () => {
  expect(isMarketAnalysisCalendarEventContextInput({ eventKey: 'US.CPI', month: '2026-10', asOf: '2026-10-11T09:00:00.000Z' })).toBe(true)
  // A 0xRouter key carries no month, so a request without one cannot be scoped.
  expect(isMarketAnalysisCalendarEventContextInput({ eventKey: 'market-observation-1', asOf: '2026-10-11T09:00:00.000Z' })).toBe(false)
  expect(isMarketAnalysisCalendarEventContextInput({ eventKey: 'US.CPI', month: 'October', asOf: '2026-10-11T09:00:00.000Z' })).toBe(false)
  expect(isMarketAnalysisCalendarEventContextInput({ eventKey: 'US.CPI', month: '2026-10', asOf: 'nope' })).toBe(false)
  expect(isMarketAnalysisCalendarEventContextInput({ eventKey: 'US.CPI', month: '2026-10', asOf: '2026-10-11T09:00:00.000Z', maxItems: 5 })).toBe(false)
  expect(isMarketAnalysisCalendarEventContextInput(null)).toBe(false)
})
