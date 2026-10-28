import { expect, it } from 'vitest'
import { buildCalendarEventContextBlock } from './calendarEventContext'
import type { CalendarCardRow } from './projectUpcomingCalendarCard'

const text = { heading: '选中事件', state: '状态', released: '已公布', upcoming: '待公布', cancelled: '已取消', missing: '未公布', related: '同期事件', metric: { actual: '实际值', consensus: '市场预期', previous: '前值' } }
const row = (overrides: Partial<CalendarCardRow> = {}): CalendarCardRow => ({
  eventKey: 'e-1', titleKey: 'cpi', month: '2026-10', date: '2026-10-13', at: '2026-10-13T12:30:00.000Z',
  importance: 'high', category: 'economic-indicator', kind: 'released-changed', actual: '0.3%', previous: '0.1%', consensus: '0.2%',
  surprise: { direction: 'beat', value: 0.1, unit: 'pp', reason: null }, ...overrides
})
const input = (overrides: Partial<CalendarCardRow> = {}, related: readonly CalendarCardRow[] = []) => ({
  row: row(overrides), related, text, stamp: (entry: CalendarCardRow) => entry.at ?? entry.date, name: (key: string) => ({ cpi: '消费者物价指数（CPI）', nfp: '非农就业' }[key] ?? key), category: () => '经济指标'
})

it('states what was published, with the numbers it is compared against', () => {
  const block = buildCalendarEventContextBlock(input())
  expect(block).toContain('选中事件：2026-10-13T12:30:00.000Z · 经济指标 · 消费者物价指数（CPI）')
  expect(block).toContain('状态：已公布')
  expect(block).toContain('实际值 0.3%')
  expect(block).toContain('市场预期 0.2%')
  expect(block).toContain('前值 0.1%')
})

it('names a value as unpublished instead of quietly leaving it out', () => {
  const block = buildCalendarEventContextBlock(input({ kind: 'upcoming', actual: null, previous: '0.1%', consensus: '7.4%' }))
  // The agent must be told the actual is missing; otherwise it reads the expectation as a result.
  expect(block).toContain('实际值：未公布')
  expect(block).toContain('市场预期 7.4%')
})

it('never invents a number that was not in the row', () => {
  const block = buildCalendarEventContextBlock(input({ kind: 'upcoming', actual: null, previous: null, consensus: null }))
  expect(block).toContain('实际值：未公布')
  expect(block).not.toMatch(/[\d.]+%/)
})

it('quotes the same hour only, and only up to the policy cap', () => {
  const related = [
    row({ eventKey: 'e-2', titleKey: 'nfp' }),
    row({ eventKey: 'e-3', titleKey: 'nfp' }),
    row({ eventKey: 'e-4', titleKey: 'nfp' }),
    row({ eventKey: 'e-5', titleKey: 'nfp' }),
    row({ eventKey: 'e-6', titleKey: 'nfp', at: '2026-10-13T18:00:00.000Z' })
  ]
  const block = buildCalendarEventContextBlock(input({}, related))
  expect(block.split('同期事件：')[1]!.split('、')).toHaveLength(3)
  // A different hour is a different story and does not belong in this context.
  expect(block).not.toContain('18:00')
})
