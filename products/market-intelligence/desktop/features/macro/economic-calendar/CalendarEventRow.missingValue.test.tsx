// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { productText } from '../../../shared/i18n/productText'
import { CalendarEventRow } from './CalendarEventRow'
import type { CalendarDayItem } from './economicCalendarDayModel'

/**
 * 行尾「未提供」的两条判据：
 * - 指标行、时刻已过、来源没给值 → 加；
 * - 事件型（讲话/会议/报告）永远不加——它们不是缺值，是本来就没有这个概念。
 */

const text = productText['zh-CN'].pages.intelligence.portal.calendar
const statusNow = '2026-11-13T10:00:00.000Z'

const item = (eventType: 'economic-indicator' | 'central-bank-activity'): CalendarDayItem => ({
  key: 'e1',
  date: '2026-11-13',
  time: '09:00',
  source: 'market',
  event: {
    eventKey: 'e1',
    title: eventType === 'economic-indicator' ? '10月家庭债务' : '央行讲话',
    countryCode: 'US',
    eventType,
    importance: 'high',
    scheduledAt: '2026-11-13T01:00:00.000Z',
    consensus: null,
    providerPrevious: null,
    providerActual: null,
    source: 'Narwhal',
    sourceObservedAt: '2026-11-13T01:00:00.000Z',
    coverage: 'observed-unverified'
  }
})

let host: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.innerHTML = ''
})

async function renderRow(eventType: 'economic-indicator' | 'central-bank-activity'): Promise<string> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><CalendarEventRow
      item={item(eventType)} text={text} statusNow={statusNow} missingValueLabel="未提供" /></ShellLanguageProvider>)
  })
  return document.body.querySelector('[data-calendar-row]')?.textContent ?? ''
}

describe('CalendarEventRow 行尾未提供', () => {
  it('adds it to an indicator row published without a value', async () => {
    expect(await renderRow('economic-indicator')).toContain('未提供')
  })

  it('never adds it to a central-bank row, which has no value concept at all', async () => {
    expect(await renderRow('central-bank-activity')).not.toContain('未提供')
  })
})
