// @vitest-environment happy-dom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { macroEconomicCalendarCaveatPolicy } from '../../../shared/macroEconomicCalendarCaveatPolicy'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../../shared/i18n/productText'
import { EconomicCalendar } from './index'
import { economicCalendarPresentationPolicy } from './economicCalendarModel'
import { marketCalendarClient } from '../../../shared/ipc/marketCalendarClient'
import type { MarketCalendarEvent, MarketCalendarPage } from '../../../../contracts/macro/marketCalendarQueryContracts'

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd')
  const { default: dayjs } = await import('dayjs')
  return {
    ...actual,
    DatePicker: (props: {
      'aria-label'?: string
      allowClear?: boolean
      className?: string
      format?: string
      inputReadOnly?: boolean
      onChange?: (value: unknown, dateString: string) => void
      picker?: string
      value?: { format: (format: string) => string }
    }) => <input
      aria-label={props['aria-label']}
      className={props.className}
      data-allow-clear={String(props.allowClear)}
      data-format={props.format}
      data-picker={props.picker}
      data-value={props.value?.format(props.format ?? '')}
      onInput={(event) => {
        const candidate = event.currentTarget.value
        props.onChange?.(candidate ? dayjs(`${candidate}-15T12:00:00`) : null, candidate)
      }}
      readOnly={props.inputReadOnly}
      type="text"
      value={props.value?.format(props.format ?? '')}
    />
  }
})

let root: Root | null = null
let restorePlatform: (() => void) | undefined
let confirmSpy: ReturnType<typeof vi.spyOn> | undefined

globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  restorePlatform?.()
  restorePlatform = undefined
  confirmSpy?.mockRestore()
  confirmSpy = undefined
  document.body.replaceChildren()
})

describe('macro economic calendar', () => {
  it.each([false, true])('does not attach a new source snapshot to an old detail after a later page fails (linked=%s)', async (isLinked) => {
    const official = blsEvent({ eventKey: 'US.CPI.RELEASE.failed-page', scheduledDate: '2026-08-12', scheduledAt: marketEvent.scheduledAt })
    const old = { ...marketEvent, providerActual: { displayValue: 'OLD' }, ...(isLinked ? { officialLink: {
      officialEventKey: official.eventKey, officialPeriodKey: '2026-M07', officialScheduledDate: '2026-08-12',
      officialScheduledAt: marketEvent.scheduledAt, officialDetectedAt: asOf, timeDisplaySource: 'official-scheduled' as const,
      displayScheduledAt: marketEvent.scheduledAt, officialActual: null, officialPrevious: null } } : {}) }
    const source = { eventType: marketEvent.eventType, status: 'success' as const, sourceObservedAt: marketEvent.sourceObservedAt }
    const page = { state: 'available' as const, month: '2026-08', locale: 'zh' as const, asOf, events: [old], sources: [source] }
    const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValueOnce(page)
      .mockResolvedValueOnce({ ...page, events: [], sources: [{ ...source, sourceObservedAt: '2026-08-06T00:00:00.000Z' }], nextCursor: 'next-page' })
      .mockResolvedValue({ state: 'unavailable', failureCode: 'query-unavailable' })
    const refresh = vi.spyOn(marketCalendarClient, 'refresh').mockResolvedValue({ state: 'completed', sources: [] })
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: isLinked ? [official] : [] }),
        getEventDetail: async () => ({ state: 'available', asOf, event: official }) })
      await flush()
      await act(async () => (isLinked ? eventButton(container, official.eventKey) : container.querySelector<HTMLButtonElement>('[data-market-event]')!).click())
      expect(container.querySelector('[data-market-value="providerActual"]')?.textContent).toContain('OLD')
      await act(async () => button(container, productText['zh-CN'].pages.intelligence.portal.calendar.market.refresh).click())
      expect(container.querySelector('.mi-market-calendar__status')?.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.market.queryUnavailable)
      // The observation is still shown, with its own value and the time it belongs to. What the old
      // implementation enforced by rendering nothing — never attaching the newer source's time to this
      // older reading — is now enforced by `shownSource`, which falls back to the observation's own
      // source whenever the live one has moved past it.
      const inspector = container.querySelector('.mi-market-calendar__inspector')
      expect(inspector, 'the stale observation still renders').not.toBeNull()
      expect(inspector?.textContent).toContain('OLD')
    } finally { query.mockRestore(); refresh.mockRestore() }
  })
  it('clears the old linked observation after refresh instead of labelling its stale values with the new source time', async () => {
    const official = blsEvent({ eventKey: 'US.CPI.RELEASE.linked-refresh', scheduledDate: '2026-08-12', scheduledAt: marketEvent.scheduledAt })
    const linked = { ...marketEvent, providerActual: { displayValue: 'OLD' }, officialLink: {
      officialEventKey: official.eventKey, officialPeriodKey: '2026-M07', officialScheduledDate: '2026-08-12',
      officialScheduledAt: marketEvent.scheduledAt, officialDetectedAt: asOf, timeDisplaySource: 'official-scheduled' as const,
      displayScheduledAt: marketEvent.scheduledAt, officialActual: null, officialPrevious: null } }
    const page = { state: 'available' as const, month: '2026-08', locale: 'zh' as const, asOf, events: [linked], sources: [] }
    const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValueOnce(page).mockResolvedValue({ ...page, events: [] })
    const refresh = vi.spyOn(marketCalendarClient, 'refresh').mockResolvedValue({ state: 'completed', sources: [] })
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [official] }),
        getEventDetail: async () => ({ state: 'available', asOf, event: official }) })
      await flush()
      await act(async () => eventButton(container, official.eventKey).click())
      expect(container.querySelector('[data-market-value="providerActual"]')?.textContent).toContain('OLD')
      await act(async () => button(container, productText['zh-CN'].pages.intelligence.portal.calendar.market.refresh).click())
      expect(container.querySelector('.mi-market-calendar__inspector')).toBeNull()
    } finally { query.mockRestore(); refresh.mockRestore() }
  })
  it('shows the proxy notice only after every market feed failed to answer, and routes to the proxy settings', async () => {
    const attempt = { state: 'failed' as const, attemptedAt: asOf, failureCode: 'response-unavailable' as const, trigger: 'automatic' as const }
    const sources = ([ 'economic-indicator', 'financial-event', 'central-bank-activity' ] as const)
      .map(eventType => ({ eventType, status: 'unavailable' as const, sourceObservedAt: null, latestAttempt: attempt }))
    const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-08', locale: 'zh', asOf, events: [], sources })
    try {
      const { container } = await renderCalendar({
        queryMonth: async () => ({ state: 'available', asOf, events: [] }),
        getEventDetail: async () => ({ state: 'unavailable' })
      })
      await flush()

      const banner = container.querySelector('[data-network-proxy-banner]')
      expect(banner, 'a detected network failure explains itself').not.toBeNull()
      const navigation = vi.fn()
      window.addEventListener('app-shell:navigate', navigation)
      await act(async () => banner!.querySelector<HTMLButtonElement>('[data-network-proxy-settings]')!.click())
      expect(navigation.mock.calls[0]?.[0].detail).toEqual({ navKey: 'settings', settingsPanelKey: 'preferences' })
      window.removeEventListener('app-shell:navigate', navigation)
    } finally { query.mockRestore() }
  })
  it('keeps the proxy notice away when no failure was detected', async () => {
    const sources = ([ 'economic-indicator', 'financial-event', 'central-bank-activity' ] as const)
      .map(eventType => ({ eventType, status: 'success' as const, sourceObservedAt: marketEvent.sourceObservedAt }))
    const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-08', locale: 'zh', asOf, events: [marketEvent], sources })
    try {
      const { container } = await renderCalendar({
        queryMonth: async () => ({ state: 'available', asOf, events: [] }),
        getEventDetail: async () => ({ state: 'unavailable' })
      })
      await flush()
      expect(container.querySelector('[data-network-proxy-banner]')).toBeNull()
    } finally { query.mockRestore() }
  })
  it('shows endpoint failure with old data time in overview and details without hiding other successful sources', async () => {
    const sources = ([ 'economic-indicator', 'financial-event', 'central-bank-activity' ] as const).map(eventType => ({
      eventType, status: 'success' as const, sourceObservedAt: marketEvent.sourceObservedAt,
      latestAttempt: { state: eventType === 'economic-indicator' ? 'failed' as const : 'succeeded' as const, attemptedAt: asOf }
    }))
    const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-08', locale: 'zh', asOf,
      events: [marketEvent], sources })
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [] }), getEventDetail: async () => unavailableDetail() })
      await flush()
      const overview = container.querySelector('.mi-market-calendar__status')!
      expect(overview.textContent).toContain('经济指标 · 刷新失败')
      expect(overview.textContent).toContain('显示上次数据')
      expect(overview.textContent).toContain('2026-08-05 08:00:00 GMT+8')
      expect(overview.textContent).toContain('财经事件 · 刷新成功')
      await act(async () => container.querySelector<HTMLButtonElement>('[data-market-event]')!.click())
      expect(container.querySelector('.mi-market-calendar__inspector')?.textContent).toContain('刷新失败')
      expect(container.querySelector('[data-market-value="providerActual"]')?.textContent).toContain('暂无')
    } finally { query.mockRestore() }
  })
  it.each([[1920, 0, 3, 2], [1920, 3, 2, 1], [1920, 8, 1, 1], [900, 3, 2, 1]])(
    'groups %i px day list with %i indicators, %i financial and %i central events', async (widthValue, economic, financial, central) => {
      const kinds = [...Array.from({ length: economic }, () => 'economic-indicator' as const),
        ...Array.from({ length: financial }, () => 'financial-event' as const), ...Array.from({ length: central }, () => 'central-bank-activity' as const)]
      const events = kinds.map((eventType, index) => ({ ...marketEvent, eventType, consensus: null,
        // One minute apart in the order they are built, so "the first six by release time" is a
        // different statement from "the first six by kind" — the cell must obey the former.
        scheduledAt: new Date(Date.parse(marketEvent.scheduledAt) + index * 60_000).toISOString(),
        title: `${eventType} ${index}`, eventKey: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }))
      const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-08', locale: 'zh', asOf, events, sources: [] })
      const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(widthValue)
      try {
        const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [] }), getEventDetail: async () => unavailableDetail() })
        await flush()
        const day = container.querySelector('[data-date="2026-08-12"]')!
        // Importance leads in the cell, then the release time — never the kind, which is only the
        // row's glyph. These rows share one importance, so the six are simply the earliest six.
        const cellTypes = [...Array.from({ length: economic }, () => 'economic-indicator'),
          ...Array.from({ length: financial }, () => 'financial-event'),
          ...Array.from({ length: central }, () => 'central-bank-activity')]
          .slice(0, economicCalendarPresentationPolicy.dayEventLimit)
        expect([...day.querySelectorAll<HTMLElement>('[data-calendar-row]')]
          .map(row => row.querySelector('.mi-economic-calendar__event-title')?.textContent?.split(' ')[0])).toEqual(cellTypes)
        const overflow = events.length - cellTypes.length
        if (overflow) {
          expect(day.querySelector('[data-calendar-more]')?.textContent).toBe(`还有 ${overflow} 条`)
          await act(async () => day.querySelector<HTMLButtonElement>('[data-calendar-more]')!.click())
        } else {
          // The whole day already fits the cell; a row of it is what opens its list.
          expect(day.querySelector('[data-calendar-more]')).toBeNull()
          await act(async () => day.querySelector<HTMLButtonElement>('[data-calendar-row]')!.click())
        }
        const detail = container.querySelector<HTMLElement>('[data-calendar-day-list]')!
        expect(detail.querySelector('[data-day-summary]')?.textContent).toBe(`当日共 ${events.length} 条 · 已按类型分组`)
        const groups = [...detail.querySelectorAll('[data-calendar-group]')]
        expect(groups.map(group => group.getAttribute('data-calendar-group'))).toEqual(economic ? ['economic-indicator', 'financial-event', 'central-bank-activity'] : ['financial-event', 'central-bank-activity'])
        expect(groups.map(group => group.querySelectorAll('[data-calendar-row]').length)).toEqual(economic ? [economic, financial, central] : [financial, central])
        expect(groups.map(group => group.querySelector('h3')?.textContent)).toEqual(economic ? [`经济指标 · ${economic} 条`, `财经事件 · ${financial} 条`, `央行活动 · ${central} 条`] : [`财经事件 · ${financial} 条`, `央行活动 · ${central} 条`])
        // The day list is a standing column now, so it is never the drawer itself.
        expect(detail.closest('[role="dialog"]')).toBeNull()
        detail.scrollTop = 120
        const selected = detail.querySelector<HTMLButtonElement>('[data-calendar-group="central-bank-activity"] [data-calendar-row]')!
        expect(selected.dataset.importance).toBe('high')
        const status = selected.dataset.eventStatus
        await act(async () => selected.click())
        // Opening a detail leaves that surface exactly where it was: same node, same scroll, same rows.
        expect(container.querySelector('[data-calendar-day-list]')).toBe(detail)
        expect(detail.scrollTop).toBe(120)
        expect(detail.querySelectorAll('[data-calendar-group]')).toHaveLength(groups.length)
        expect(detail.querySelector<HTMLButtonElement>('[data-calendar-group="central-bank-activity"] [data-calendar-row]')?.dataset.eventStatus).toBe(status)
      } finally { query.mockRestore(); width.mockRestore() }
    })
  it.each([[2, 3, 5], [0, 5, 5], [8, 3, 6]])('keeps %i high and %i other events reachable, holding %i of them in the month cell', async (high, other, shown) => {
    const events = Array.from({ length: high + other }, (_, i) => ({ ...marketEvent, importance: i < high ? 'high' as const : 'low' as const,
      eventKey: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }))
    const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-08', locale: 'zh', asOf, events, sources: [] })
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1920)
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [] }), getEventDetail: async () => unavailableDetail() })
      await flush()
      const day = container.querySelector('[data-date="2026-08-12"]')!
      // The cell is filled from the lower levels once the high ones run out, so a day of five events
      // needs no more action at all — and the high rows are still the ones that lead it.
      const cellRows = [...day.querySelectorAll<HTMLElement>('[data-calendar-row]')]
      expect(cellRows).toHaveLength(shown)
      expect(cellRows.slice(0, Math.min(high, shown)).map(row => row.dataset.importance))
        .toEqual(Array.from({ length: Math.min(high, shown) }, () => 'high'))
      const overflow = high + other - shown
      if (overflow) {
        expect(day.querySelector('[data-calendar-more]')?.textContent).toBe(`还有 ${overflow} 条`)
        await act(async () => day.querySelector<HTMLButtonElement>('[data-calendar-more]')!.click())
      } else {
        // The cell already holds the whole day; picking one of its rows is what opens that day's list.
        expect(day.querySelector('[data-calendar-more]')).toBeNull()
        await act(async () => cellRows[0]!.click())
      }
      expect(container.querySelectorAll('[data-calendar-day-list] [data-calendar-row]')).toHaveLength(high + other)
      // The last lower-importance row, so that picking it is a new pick and not a toggle of the first.
      const lowRows = [...container.querySelectorAll<HTMLButtonElement>('[data-calendar-day-list] [data-importance="low"]')]
      await act(async () => lowRows[lowRows.length - 1]!.click())
      expect(container.querySelector('.mi-market-calendar__inspector')?.textContent).toContain(marketEvent.title)
    } finally { query.mockRestore(); width.mockRestore() }
  })
  it.each([[true, 0], [false, 0], [true, 6], [false, 6]])('counts linked=%s with %i extra economic events once in the month grid', async (isLinked, extraCount) => {
    const official = blsEvent({ eventKey: 'US.CPI.RELEASE.linked', scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z' })
    const linked = { ...marketEvent, eventKey: '00000000-0000-4000-8000-000000000010', officialLink: {
      officialEventKey: official.eventKey, officialPeriodKey: official.periodKey, officialScheduledDate: official.scheduledDate,
      officialScheduledAt: official.scheduledAt, officialDetectedAt: official.detectedAt, timeDisplaySource: 'official-scheduled' as const,
      displayScheduledAt: official.scheduledAt, officialActual: null, officialPrevious: null
    } }
    const extraEvents = Array.from({ length: extraCount }, (_, index) => ({ ...marketEvent,
      eventKey: `00000000-0000-4000-8000-${String(index + 20).padStart(12, '0')}` }))
    const unlinked = { ...marketEvent, eventKey: linked.eventKey }
    const spy = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-08', locale: 'zh', asOf,
      events: [isLinked ? linked : unlinked, ...extraEvents], sources: [] })
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [official] }), getEventDetail: async () => unavailableDetail() })
      await flush()
      const day = container.querySelector('[data-date="2026-08-12"]')!
      const total = 1 + Number(!isLinked) + extraCount
      expect(day.querySelectorAll('[data-calendar-row]')).toHaveLength(Math.min(total, 6))
      if (extraCount) expect(day.querySelector('[data-calendar-more]')?.textContent).toBe(`还有 ${total - 6} 条`)
      else expect(day.querySelector('[data-calendar-more]')).toBeNull()
      if (isLinked) expect(day.querySelector(`[data-market-event="${linked.eventKey}"]`)).toBeNull()
    } finally { spy.mockRestore() }
  })
  it('keeps actual-zero status color and accessible status identical in month grid and full day list', async () => {
    const events = Array.from({ length: 7 }, (_, index) => blsEvent({
      eventKey: `US.CPI.RELEASE.status-${index}`, scheduledDate: '2026-09-12', scheduledAt: '2026-09-12T12:30:00.000Z',
      lifecycleState: 'released', actual: { displayValue: '0', numericValue: 0, unit: 'percent' }
    }))
    const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-09', locale: 'zh', asOf, events: [], sources: [] })
    try {
      const { container } = await renderCalendar({ now: () => new Date('2026-09-12T13:00:00.000Z'), queryMonth: async () => ({ state: 'available', asOf: '2026-09-12T13:00:00.000Z', events }), getEventDetail: async () => unavailableDetail() })
      await flush()
      const day = container.querySelector('[data-date="2026-09-12"]')!
      const monthRow = day.querySelector<HTMLButtonElement>('[data-calendar-row]')!
      expect(monthRow.dataset.eventStatus).toBe('data-received')
      await act(async () => day.querySelector<HTMLButtonElement>('[data-calendar-more]')!.click())
      const listRow = container.querySelector<HTMLButtonElement>('[data-calendar-day-list] [data-calendar-row]')!
      expect(listRow.dataset.eventStatus).toBe(monthRow.dataset.eventStatus)
      expect(listRow.getAttribute('aria-label')).toContain('数据已获取')
    } finally { query.mockRestore() }
  })
  it('discloses the official query cap and shows a safe storage-limited refresh result', async () => {
    const refresh = vi.spyOn(marketCalendarClient, 'refresh').mockResolvedValue({ state: 'unavailable', sources: [], failureCode: 'storage-unavailable' })
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [] }), getEventDetail: async () => unavailableDetail() })
      await flush()
      expect(container.querySelector('.mi-market-calendar__status')?.textContent).toContain('官方最多 200 条')
      await act(async () => button(container, productText['zh-CN'].pages.intelligence.portal.calendar.market.refresh).click())
      await flush()
      expect(container.querySelector('.mi-market-calendar__status')?.textContent).toContain('存储受限')
    } finally { refresh.mockRestore() }
  })
  it('shows the same Beijing day in official detail as in its calendar cell', async () => {
    const event = blsEvent({ scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T16:30:00.000Z' })
    const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [event] }), getEventDetail: async () => ({ state: 'available', asOf, event }) })
    await flush()
    await act(async () => eventButton(container, event.eventKey).click())
    await flush()
    expect(container.querySelector('[data-date="2026-08-13"] [data-event-key]')).not.toBeNull()
    expect(container.querySelector('.mi-economic-calendar__inspector')?.textContent).toContain('2026-08-13 00:30 GMT+8')
  })
  it('shows loading instead of a false exact count until the final market page arrives', async () => {
    let complete!: (page: MarketCalendarPage) => void
    const page: MarketCalendarPage = { state: 'available', month: '2026-08', locale: 'zh', asOf,
      events: Array.from({ length: 7 }, (_, i) => ({ ...marketEvent, eventKey: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` })), sources: [] }
    const spy = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValueOnce({ ...page, nextCursor: '00000000-0000-4000-8000-000000000009' })
      .mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [] }), getEventDetail: async () => unavailableDetail() })
      await flush()
      expect(container.querySelector('[data-date="2026-08-12"] [data-calendar-more]')?.textContent).toBe('加载中')
      await act(async () => complete({ ...page, events: [] }))
      expect(container.querySelector('[data-date="2026-08-12"] [data-calendar-more]')?.textContent).toBe('还有 1 条')
    } finally { spy.mockRestore() }
  })
  it('stands the reader day as a grouped event list in the right column and opens no detail for them', async () => {
    const copy = productText['zh-CN'].pages.intelligence.portal.calendar
    const events = [blsEvent({ eventKey: 'US.CPI.TODAY', scheduledDate: '2026-08-05', scheduledAt: '2026-08-05T12:30:00.000Z' })]
    const spy = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-08', locale: 'zh', asOf,
      events: [{ ...marketEvent, scheduledAt: '2026-08-05T13:30:00.000Z' }], sources: [] })
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events }), getEventDetail: async () => unavailableDetail() })
      await flush()
      const list = container.querySelector<HTMLElement>('[data-calendar-day-list]')!
      expect(list.textContent).toContain(copy.dayEvents.title.replace('{date}', '2026-08-05'))
      expect(list.querySelector('[data-day-summary]')?.textContent).toBe(`${copy.unifiedDay.total.replace('{count}', '2')} · ${copy.unifiedDay.grouped}`)
      expect(list.querySelectorAll('[data-calendar-group]')).toHaveLength(1)
      expect(list.querySelectorAll('[data-calendar-row]')).toHaveLength(2)
      // Nothing is selected on the reader's behalf: the detail only ever appears because they asked.
      expect(container.querySelector('[data-calendar-detail-container]')).toBeNull()
      expect(container.querySelector('[role="dialog"]')).toBeNull()
      expect(container.querySelector('[data-calendar-detail-actions]')).toBeNull()
    } finally { spy.mockRestore() }
  })
  it('opens one left drawer without a mask for the event the reader picks, and keeps the calendar clickable', async () => {
    const copy = productText['zh-CN'].pages.intelligence.portal.calendar
    const event = blsEvent({ eventKey: 'US.CPI.AUGUST', scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z' })
    const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available', asOf, event }) })
    await flush()
    await act(async () => eventButton(container, event.eventKey).click())
    await flush()
    const detail = container.querySelector<HTMLElement>('[data-calendar-detail-container]')!
    expect(detail.textContent).toContain(copy.events.cpi)
    // Left, and without a mask: the month grid underneath stays reachable.
    expect(container.querySelector('.ant-drawer-left')).not.toBeNull()
    expect(container.querySelector('.ant-drawer-mask')).toBeNull()
    // 类必须落在**根节点**上：antd 把 `className` 交给 `.ant-drawer-content`，而 12px 浮卡与圆角的选择器
    // 需要根节点同时带 `.ant-drawer` 与 `.ant-drawer-left`。这一条以前只断言 CSS 源码文本，所以那条规则
    // 匹配不到任何元素、读者的"四面 12px 浮卡"从未生效——正是独立评审 be5e5e55 的 Critical。
    const root = container.querySelector('.ant-drawer')
    expect(root?.classList.contains('mi-calendar-drawer')).toBe(true)
    expect(container.querySelector('.ant-drawer-content')?.classList.contains('mi-calendar-drawer')).toBe(false)
    // 元素级样式要跟着块走：图表页打开的抽屉没有 `.mi-economic-calendar` 祖先，字段名否则不是灰的。
    const drawerClassRules = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css'), 'utf8')
    for (const rule of ['.mi-calendar-drawer dt', '.mi-calendar-drawer dd', '.mi-calendar-drawer h2']) {
      expect(drawerClassRules, rule).toContain(rule)
    }
    // …and anchored to this page's own box. An inline antd drawer is `position: absolute`, so with no
    // positioned ancestor it resolved against the initial containing block and covered the app's icon
    // rail and tab strip — while the same drawer opened from the dashboard stops at the content
    // area's edge. Both surfaces must put it in the same place.
    const styles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css'), 'utf8')
    const pageRule = styles.slice(styles.indexOf('.mi-economic-calendar {'))
    expect(pageRule.slice(0, pageRule.indexOf('\n}'))).toContain('position: relative')
    // And it floats: 12px off every side of the content area, rounded, rather than glued to the icon
    // rail and the tab strip. The placement class has to be in the selector — antd injects its own
    // `top/bottom/left: 0` at runtime, so a two-class rule would tie and lose on source order.
    expect(styles).toMatch(/\.mi-calendar-drawer \{ --mi-calendar-drawer-inset: 12px/)
    const wrapper = styles.slice(styles.indexOf('.mi-calendar-drawer.ant-drawer-left > .ant-drawer-content-wrapper'))
    const wrapperRule = wrapper.slice(wrapper.indexOf('{') + 1, wrapper.indexOf('\n}'))
    for (const edge of ['top', 'bottom', 'left']) expect(wrapperRule).toContain(`${edge}: var(--mi-calendar-drawer-inset)`)
    expect(wrapperRule).toContain('max-width: calc(100% - 2 * var(--mi-calendar-drawer-inset))')
    // 圆角与裁切现在真的能匹配（类在根节点上）；浮卡四边的位移本身在 happy-dom 里算不出来，
    // 所以这半边只能断言规则形状，类挂在哪一侧由上面的 DOM 断言负责。
    expect(styles).toContain('.mi-calendar-drawer .ant-drawer-content { border-radius: var(--mi-calendar-drawer-radius); overflow: hidden; }')
    // The reused body's tokens travel with the drawer. Opened from the market dashboard there is no
    // `.mi-economic-calendar` ancestor, and an undefined `var()` is invalid at computed-value time —
    // it unsets the property instead of falling back — so the body silently lost its padding and the
    // inspector's labels their muted colour.
    const tokenRule = styles.slice(styles.indexOf('.mi-economic-calendar,\n.mi-calendar-drawer {'))
    const tokens = tokenRule.slice(tokenRule.indexOf('{') + 1, tokenRule.indexOf('\n}'))
    for (const token of ['--mi-economic-page-inline', '--mi-economic-muted', '--mi-economic-line', '--mi-economic-surface', '--mi-economic-text']) {
      expect(tokens).toContain(`${token}:`)
    }
    // A close control in the header, and no release-progress row: the detail is the drawer's content.
    const closeControl = container.querySelector<HTMLButtonElement>('.ant-drawer-close')!
    expect(closeControl, 'the reader needs a visible way out of an unmasked drawer').not.toBeNull()
    expect(closeControl.getAttribute('aria-label')).toBeTruthy()
    expect(detail.textContent).not.toContain(copy.eventStatus.label)
    expect(detail.textContent).not.toContain(copy.dayEvents.close)
    // The day that event belongs to is what the standing column shows, and it never left.
    const list = container.querySelector<HTMLElement>('[data-calendar-day-list]')!
    expect(list.textContent).toContain(copy.dayEvents.title.replace('{date}', '2026-08-12'))
    expect(list.querySelector('[data-event-key="US.CPI.AUGUST"]')).not.toBeNull()
    expect(container.querySelector('[data-date="2026-08-12"] [data-event-key="US.CPI.AUGUST"]')).not.toBeNull()
  })
  it('swaps the one open drawer to the next event instead of stacking a second detail', async () => {
    const official = blsEvent({ eventKey: 'US.CPI.AUGUST', scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z' })
    const market = { ...marketEvent, scheduledAt: '2026-08-12T13:30:00.000Z' }
    const spy = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-08', locale: 'zh', asOf, events: [market], sources: [] })
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [official] }),
        getEventDetail: async () => ({ state: 'available', asOf, event: official }) })
      await flush()
      await act(async () => eventButton(container, official.eventKey).click())
      await flush()
      expect(container.querySelector('[data-release-time-row]')).not.toBeNull()
      await act(async () => container.querySelector<HTMLButtonElement>('[data-market-event]')!.click())
      await flush()
      expect(container.querySelectorAll('[data-calendar-detail-container]')).toHaveLength(1)
      expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1)
      expect(container.querySelector('.mi-market-calendar__inspector')?.textContent).toContain(market.title)
      expect(container.querySelector('[data-release-time-row]')).toBeNull()
      // The list it replaced is still standing behind it.
      expect(container.querySelector('[data-calendar-day-list]')).not.toBeNull()
    } finally { spy.mockRestore() }
  })
  it('collapses the drawer when the reader picks the same event again, and closes it on Escape', async () => {
    const event = blsEvent({ eventKey: 'US.CPI.AUGUST', scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z' })
    const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available', asOf, event }) })
    await flush()
    const row = eventButton(container, event.eventKey)
    await act(async () => row.click())
    await flush()
    expect(container.querySelector('[data-calendar-detail-container]')).not.toBeNull()
    expect(row.getAttribute('aria-pressed')).toBe('true')
    await act(async () => row.click())
    expect(container.querySelector('[data-calendar-detail-container]')).toBeNull()
    expect(row.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-calendar-day-list]')).not.toBeNull()
    await act(async () => row.click())
    await flush()
    expect(container.querySelector('[data-calendar-detail-container]')).not.toBeNull()
    await act(async () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('[data-calendar-detail-container]')).toBeNull()
    expect(container.querySelector('.mi-economic-calendar__inspector')).toBeNull()
    expect(container.querySelector('[data-calendar-day-list] [data-event-key="US.CPI.AUGUST"]')).not.toBeNull()
  })
  it('closes the drawer from its header control and keeps the day list standing', async () => {
    const event = blsEvent({ eventKey: 'US.CPI.AUGUST', scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z' })
    const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available', asOf, event }) })
    await flush()
    await act(async () => eventButton(container, event.eventKey).click())
    await flush()
    await act(async () => container.querySelector<HTMLButtonElement>('.ant-drawer-close')!.click())
    expect(container.querySelector('[data-calendar-detail-container]')).toBeNull()
    expect(container.querySelector('.mi-economic-calendar__inspector')).toBeNull()
    expect(container.querySelector('[data-calendar-day-list]')).not.toBeNull()
  })
  it('carries the stale-source note inside the drawer instead of hanging it over the day list', async () => {
    const copy = productText['zh-CN'].pages.intelligence.portal.calendar
    const spy = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-08', locale: 'zh', asOf, events: [marketEvent], sources: [] })
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [] }), getEventDetail: async () => unavailableDetail() })
      await flush()
      expect(container.querySelector('[data-source-advanced]')).toBeNull()
      await act(async () => container.querySelector<HTMLButtonElement>('[data-market-event]')!.click())
      await flush()
      expect(container.querySelector('[data-calendar-day-list] [data-source-advanced]')).toBeNull()
      expect(container.querySelector('[data-calendar-detail-container] [data-source-advanced]')?.textContent).toBe(copy.market.sourceAdvanced)
    } finally { spy.mockRestore() }
  })
  it('moves the standing day list to the day whose more action the reader used, without opening a detail', async () => {
    const events = Array.from({ length: 7 }, (_, index) => blsEvent({
      eventKey: `US.CPI.${index}`, scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z'
    }))
    const spy = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-08', locale: 'zh', asOf, events: [], sources: [] })
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events }), getEventDetail: async () => unavailableDetail() })
      await flush()
      await act(async () => container.querySelector<HTMLButtonElement>('[data-date="2026-08-12"] [data-calendar-more]')!.click())
      const list = container.querySelector<HTMLElement>('[data-calendar-day-list]')!
      expect(list.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.dayEvents.title.replace('{date}', '2026-08-12'))
      expect(list.querySelector('[data-day-summary]')?.textContent).toBe('当日共 7 条 · 已按类型分组')
      expect(list.querySelectorAll('[data-calendar-group]')).toHaveLength(1)
      expect(list.querySelectorAll('[data-calendar-row]')).toHaveLength(7)
      expect(container.querySelector('[data-calendar-detail-container]')).toBeNull()
    } finally { spy.mockRestore() }
  })
  it('gives a day the reader comes back to the scroll position they left it at', async () => {
    const events = ['2026-08-12', '2026-08-13'].flatMap((date, day) => Array.from({ length: 7 }, (_, index) => blsEvent({
      eventKey: `US.CPI.${day}-${index}`, scheduledDate: date, scheduledAt: `${date}T12:30:00.000Z`
    })))
    const spy = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-08', locale: 'zh', asOf, events: [], sources: [] })
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events }), getEventDetail: async () => unavailableDetail() })
      await flush()
      const more = (date: string) => container.querySelector<HTMLButtonElement>(`[data-date="${date}"] [data-calendar-more]`)!
      await act(async () => more('2026-08-12').click())
      const list = container.querySelector<HTMLElement>('[data-calendar-day-list]')!
      list.scrollTop = 120
      await act(async () => more('2026-08-13').click())
      expect(list.scrollTop).toBe(0)
      expect(list.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.dayEvents.title.replace('{date}', '2026-08-13'))
      await act(async () => more('2026-08-12').click())
      expect(container.querySelector('[data-calendar-day-list]')).toBe(list)
      expect(list.scrollTop).toBe(120)
    } finally { spy.mockRestore() }
  })
  // Derived safe projections only; not provider evidence or identity admission.
  it('updates refreshed market row and open detail before the next clock tick without extra requests', async () => {
    let instant = '2026-08-12T12:00:00.000Z'
    const event = { ...marketEvent, scheduledAt: '2026-08-12T12:00:30.000Z' }
    const page: MarketCalendarPage = { state: 'available', month: '2026-08', locale: 'zh', asOf: instant, events: [event], sources: [] }
    const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValueOnce(page)
      .mockResolvedValue({ ...page, events: [{ ...event, providerActual: { displayValue: '0' } }] })
    const refresh = vi.spyOn(marketCalendarClient, 'refresh').mockResolvedValue({ state: 'completed', sources: [] })
    try {
      const { container, client } = await renderCalendar({ now: () => new Date(instant),
        queryMonth: async () => ({ state: 'available', asOf: instant, events: [] }), getEventDetail: async () => ({ state: 'unavailable' }) })
      const row = container.querySelector<HTMLButtonElement>('[data-market-event]')!
      await act(async () => row.click())
      expect(row.dataset.eventStatus).toBe('upcoming')
      instant = '2026-08-12T12:00:35.000Z'
      await act(async () => button(container, productText['zh-CN'].pages.intelligence.portal.calendar.market.refresh).click())
      expect(row.dataset.eventStatus).toBe('data-received')
      expect(container.querySelector('[data-market-event]')).toBe(row)
      // The drawer holds the refreshed reading, and no release-progress row sits above it.
      expect(container.querySelector('[data-calendar-detail-container]')?.textContent).not.toContain(productText['zh-CN'].pages.intelligence.portal.calendar.eventStatus.label)
      expect(container.querySelector('.mi-market-calendar__inspector')?.textContent).toContain('0')
      expect(query).toHaveBeenCalledTimes(2)
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(client.queryMonth).toHaveBeenCalledTimes(1)
    } finally { query.mockRestore(); refresh.mockRestore() }
  })

  it.each(['bls', 'fomc'] as const)('updates %s official row and detail immediately after refresh without a clock tick', async (source) => {
    let instant = source === 'bls' ? '2026-08-12T12:00:00.000Z' : '2026-08-11T15:59:50.000Z'
    let received = false
    const makeEvent = source === 'bls' ? blsEvent : fomcEvent
    const event = () => makeEvent({ ...(source === 'bls' ? { scheduledAt: '2026-08-12T12:00:30.000Z' } : {}),
      ...(source === 'bls' ? { eventFamily: 'consumer-price-index' } : {}),
      ...(received ? { lifecycleState: 'released', actual: { displayValue: '0%', numericValue: 0, unit: 'percent' } } : {}) })
    const updated = async () => { received = true; return { state: 'updated' as const } }
    const { container, client } = await renderCalendar({ now: () => new Date(instant),
      queryMonth: async () => ({ state: 'available', asOf: instant, events: [event()] }),
      getEventDetail: async ({ asOf }: { asOf: string }) => ({ state: 'available', asOf, event: event() }),
      refreshBlsEmploymentRelease: updated, refreshFedFomcDecision: updated })
    const row = container.querySelector<HTMLButtonElement>('[data-calendar-row]')!
    expect(row.dataset.eventStatus).toBe(source === 'bls' ? 'upcoming' : 'time-pending')
    instant = '2026-08-12T12:00:35.000Z'
    await act(async () => row.click())
    Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) })
    confirmSpy = window.confirm as ReturnType<typeof vi.fn>
    await act(async () => button(container, source === 'bls' ? '刷新 BLS 数据' : '获取官方值').click())
    await flush()
    expect(row.dataset.eventStatus).toBe('data-received')
    expect(container.querySelector('[data-calendar-row]')).toBe(row)
    // The open drawer re-reads the released row: the actual value arrives with it.
    expect(container.querySelector('.mi-economic-calendar__inspector')?.textContent).toContain('0%')
    expect(client.queryMonth).toHaveBeenCalledTimes(2)
    expect(client.getEventDetail).toHaveBeenCalledTimes(2)
  })

  const marketEvent: MarketCalendarEvent = { eventKey: '00000000-0000-4000-8000-000000000001', title: 'Derived independent market event',
    countryCode: null, eventType: 'economic-indicator', importance: 'high', scheduledAt: '2026-08-12T12:30:00.000Z',
    consensus: { displayValue: '0' }, providerActual: null, providerPrevious: null, source: '0xRouter',
    sourceObservedAt: '2026-08-05T00:00:00.000Z', coverage: 'observed-unverified' }
  it.each(['loading', 'unavailable'])('keeps market events visible while the official calendar is %s', async (state) => {
    const spy = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-08', locale: 'zh', asOf,
      events: [marketEvent], sources: [] })
    try {
      const { container } = await renderCalendar({ queryMonth: () => state === 'loading' ? new Promise(() => {}) : Promise.resolve({ state: 'unavailable', failureCode: 'calendar-query-unavailable' }), getEventDetail: async () => unavailableDetail() })
      await flush()
      expect(container.querySelector('[data-market-event]')?.textContent ?? '').toContain(marketEvent.title)
      expect(container.textContent).toContain(state === 'loading' ? productText['zh-CN'].pages.intelligence.portal.calendar.status.loading : productText['zh-CN'].pages.intelligence.portal.calendar.failures['calendar-query-unavailable'])
    } finally { spy.mockRestore() }
  })
  it('shows an overdue market cell as storage-limited when the newest automatic attempt was refused by the ceiling', async () => {
    // The reader's actual bug: the value was published, our collection was refused on capacity,
    // and the cell looked like an event with no data at all.
    const lateAsOf = '2026-08-12T14:00:00.000Z'
    const copy = productText['zh-CN'].pages.intelligence.portal.calendar
    const source = { eventType: 'economic-indicator' as const, status: 'success' as const, sourceObservedAt: marketEvent.sourceObservedAt,
      latestAttempt: { state: 'failed' as const, attemptedAt: '2026-08-12T13:00:00.000Z', failureCode: 'storage-pressure' as const, trigger: 'automatic' as const } }
    const page: MarketCalendarPage = { state: 'available', month: '2026-08', locale: 'zh', asOf: lateAsOf, events: [marketEvent], sources: [source,
      { eventType: 'financial-event', status: 'unavailable', sourceObservedAt: null },
      { eventType: 'central-bank-activity', status: 'unavailable', sourceObservedAt: null }] }
    const spy = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue(page)
    try {
      const { container } = await renderCalendar({ now: () => new Date(lateAsOf),
        queryMonth: async () => ({ state: 'available', asOf: lateAsOf, events: [] }), getEventDetail: async () => unavailableDetail() })
      await flush()
      const row = container.querySelector<HTMLElement>('[data-market-event]')!
      expect(row.dataset.eventStatus).toBe('storage-limited')
      expect(row.getAttribute('aria-label')).toContain(copy.eventStatus['storage-limited'])
      expect(copy.eventStatus['storage-limited']).not.toBe(copy.eventStatus['awaiting-data'])
      // The same verdict is on the source line, with its origin and the retained-data time.
      const status = container.querySelector('.mi-market-calendar__status')?.textContent ?? ''
      expect(status).toContain(copy.market.attemptFailure['storage-pressure'])
      expect(status).toContain(copy.market.refreshTrigger.automatic)
      expect(status).toContain(copy.market.retainedData)
    } finally { spy.mockRestore() }
  })
  it('shows the same overdue cell as not-yet-published when the source answered after the release', async () => {
    const lateAsOf = '2026-08-12T14:00:00.000Z'
    const copy = productText['zh-CN'].pages.intelligence.portal.calendar
    const observedAfterRelease = { ...marketEvent, sourceObservedAt: '2026-08-12T13:05:00.000Z' }
    const source = { eventType: 'economic-indicator' as const, status: 'success' as const, sourceObservedAt: observedAfterRelease.sourceObservedAt,
      latestAttempt: { state: 'failed' as const, attemptedAt: '2026-08-12T13:30:00.000Z', failureCode: 'storage-pressure' as const, trigger: 'automatic' as const } }
    const page: MarketCalendarPage = { state: 'available', month: '2026-08', locale: 'zh', asOf: lateAsOf, events: [observedAfterRelease], sources: [source] }
    const spy = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue(page)
    try {
      const { container } = await renderCalendar({ now: () => new Date(lateAsOf),
        queryMonth: async () => ({ state: 'available', asOf: lateAsOf, events: [] }), getEventDetail: async () => unavailableDetail() })
      await flush()
      const row = container.querySelector<HTMLElement>('[data-market-event]')!
      // A refused later attempt must not relabel data the source itself answered.
      expect(row.dataset.eventStatus).toBe('awaiting-data')
      expect(row.getAttribute('aria-label')).toContain(copy.eventStatus['awaiting-data'])
    } finally { spy.mockRestore() }
  })
  it('keeps the selected market observation while another page arrives', async () => {
    let complete!: (page: MarketCalendarPage) => void
    const page: MarketCalendarPage = { state: 'available', month: '2026-08', locale: 'zh', asOf, events: [marketEvent], sources: [] }
    const spy = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValueOnce({ ...page, nextCursor: '00000000-0000-4000-8000-000000000002' })
      .mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [] }), getEventDetail: async () => unavailableDetail() })
      await flush()
      await act(async () => container.querySelector<HTMLButtonElement>('[data-market-event]')!.click())
      expect(container.querySelector('.mi-market-calendar__inspector')).not.toBeNull()
      await act(async () => complete({ ...page, events: [] }))
      await flush()
      expect(container.querySelector('.mi-market-calendar__inspector')?.textContent ?? '').toContain(marketEvent.title)
    } finally { spy.mockRestore() }
  })
  it('closes a market detail when a completed refresh no longer contains that observation', async () => {
    let refreshCount = 0
    const firstPage: MarketCalendarPage = { state: 'available', month: '2026-08', locale: 'zh', asOf, events: [marketEvent], sources: [] }
    const spy = vi.spyOn(marketCalendarClient, 'queryMonth').mockImplementation(async () => {
      refreshCount++
      return refreshCount === 1 ? firstPage : { ...firstPage, events: [] }
    })
    const refresh = vi.spyOn(marketCalendarClient, 'refresh').mockResolvedValue({ state: 'completed', sources: [] })
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1920)
    try {
      const official = blsEvent()
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [official] }), getEventDetail: async () => ({ state: 'available', asOf, event: official }) })
      await flush()
      await act(async () => container.querySelector<HTMLButtonElement>('[data-market-event]')!.click())
      expect(container.querySelector('.mi-market-calendar__inspector')).not.toBeNull()
      await act(async () => button(container, productText['zh-CN'].pages.intelligence.portal.calendar.market.refresh).click())
      await flush()
      // The observation is gone, so its drawer closes; the day list stays where it was.
      expect(container.querySelector('.mi-market-calendar__inspector')).toBeNull()
      expect(container.querySelector('[data-calendar-detail-container]')).toBeNull()
      expect(container.querySelector('[data-calendar-day-list]')).not.toBeNull()
    } finally { spy.mockRestore(); refresh.mockRestore(); width.mockRestore() }
  })
  it('retains a selected later-page observation until a refresh finishes reading all pages', async () => {
    let complete!: (page: MarketCalendarPage) => void
    const page: MarketCalendarPage = { state: 'available', month: '2026-08', locale: 'zh', asOf, events: [marketEvent], sources: [] }
    const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValueOnce(page)
      .mockResolvedValueOnce({ ...page, events: [], nextCursor: '00000000-0000-4000-8000-000000000009' })
      .mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const refresh = vi.spyOn(marketCalendarClient, 'refresh').mockResolvedValue({ state: 'completed', sources: [] })
    try {
      const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [] }), getEventDetail: async () => unavailableDetail() })
      await flush()
      await act(async () => container.querySelector<HTMLButtonElement>('[data-market-event]')!.click())
      await act(async () => button(container, productText['zh-CN'].pages.intelligence.portal.calendar.market.refresh).click())
      await flush()
      expect(container.querySelector('.mi-market-calendar__inspector')?.textContent).toContain(marketEvent.title)
      await act(async () => complete(page))
      expect(container.querySelector('.mi-market-calendar__inspector')?.textContent).toContain(marketEvent.title)
    } finally { query.mockRestore(); refresh.mockRestore() }
  })
  it('wraps market status and long values and keeps a bounded narrow detail overlay', () => {
    const styles = readFileSync(resolve('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css'), 'utf8')
    expect(cssRule(styles, '.mi-market-calendar__status')).toContain('flex-wrap: wrap')
    expect(cssRule(styles, '.mi-market-calendar__inspector strong')).toContain('overflow-wrap: anywhere')
    expect(styles).toContain('--mi-market-detail-max-height')
    expect(styles).toContain('.mi-calendar-detail-container')
  })
  it('offers manual market refresh next to month navigation without requesting on page entry', async () => {
    const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }), getEventDetail: async () => unavailableDetail() })
    const text = productText['zh-CN'].pages.intelligence.portal.calendar
    expect(container.querySelector(`button[aria-label="${text.market.refresh}"]`)).not.toBeNull()
    expect(container.querySelector('.mi-market-calendar__status')).not.toBeNull()
  })
  it('synchronizes the complete 60-revision BLS schedule year before loading the initial month', async () => {
    const { client } = await renderCalendar({
      syncBlsEmploymentSchedule: async () => ({ state: 'completed' as const, schedule: 'updated' as const, values: { cpi: 'updated' as const, employment: 'current' as const } }),
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }),
      getEventDetail: async () => unavailableDetail(),
      now: () => new Date('2026-08-11T00:00:00.000Z')
    })

    await flush()

    expect(client.syncBlsEmploymentSchedule).toHaveBeenCalledWith({ year: '2026' })
    expect(client.queryMonth).toHaveBeenCalledWith({ month: '2026-08', asOf: '2026-08-11T00:00:00.000Z' })
    expect(client.syncBlsEmploymentSchedule.mock.invocationCallOrder[0]).toBeLessThan(client.queryMonth.mock.invocationCallOrder[0]!)
  })

  it('re-queries after an updated value family and presents only the localized aggregate outcomes', async () => {
    const { container, client } = await renderCalendar({
      syncBlsEmploymentSchedule: async () => ({ state: 'completed' as const, schedule: 'unchanged' as const, values: { cpi: 'updated' as const, employment: 'unavailable' as const } }),
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }),
      getEventDetail: async () => unavailableDetail(),
      now: () => new Date('2026-08-11T00:00:00.000Z')
    })
    await flush()

    expect(client.queryMonth).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.blsScheduleSync.cpi.updated)
    expect(container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.blsScheduleSync.employment.unavailable)
    expect(container.textContent).not.toMatch(/eventKey|series|https?:|evidence|proxy|parser|error/i)
  })

  it('uses full official source names with abbreviations in both calendar locales', () => {
    const zh = productText['zh-CN'].pages.intelligence.portal.calendar.sources
    const en = productText['en-US'].pages.intelligence.portal.calendar.sources

    expect(zh).toMatchObject({
      federalReserve: 'Federal Reserve Board (Fed)',
      bea: '美国经济分析局（BEA）',
      blsManualIcs: '美国劳工统计局（BLS，手动 ICS）'
    })
    expect(en).toMatchObject({
      federalReserve: 'Federal Reserve Board (Fed)',
      bea: 'Bureau of Economic Analysis (BEA)',
      blsManualIcs: 'Bureau of Labor Statistics (BLS, manual ICS)'
    })
    expect(`${zh.blsManualIcs}\n${en.blsManualIcs}`).not.toMatch(/macro-calendar-bls|providerId/i)
  })

  it('renders safe queried BLS and Fed schedules with the official BLS time and manual-import caveat', async () => {
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [blsEvent(), fomcEvent()] }),
      getEventDetail: async ({ eventKey }: { eventKey: string }) => ({ state: 'available' as const, asOf, event: eventKey === fomcEvent().eventKey ? fomcEvent() : blsEvent() })
    })

    await flush()
    await flush()

    expect(client.queryMonth).toHaveBeenCalledWith({ month: '2026-08', asOf })
    expect(container.querySelectorAll('.mi-economic-calendar__day')).toHaveLength(42)
    // The compact cells never carry the source disclosure; it belongs to the detail.
    expect(container.textContent).toContain('CPI')
    expect(container.textContent).not.toContain('20:30 GMT+8')
    expect(container.textContent).not.toContain(productText['zh-CN'].pages.intelligence.portal.calendar.caveats['manual-ics-import'])
    expect(container.textContent).not.toMatch(/https?:|sourceUrl|evidenceHash|rawRecordId|credential/i)

    await act(async () => eventButton(container, blsEvent().eventKey).click())
    await flush()
    await flush()

    expect(container.textContent).toContain('20:30 GMT+8')
    expect(container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.caveats['manual-ics-import'])

    const fomc = Array.from(container.querySelectorAll<HTMLButtonElement>('.mi-economic-calendar__event')).find(
      (button) => button.dataset.eventKey === fomcEvent().eventKey
    )
    await act(async () => fomc?.click())
    await flush()
    await flush()

    expect(client.getEventDetail).toHaveBeenCalledWith({ eventKey: fomcEvent().eventKey, asOf })
    expect(container.querySelector('.mi-economic-calendar__inspector')?.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.caveats['official-time-not-published'])
  })

  it('shows a verified FOMC actual while keeping a missing previous value unavailable', async () => {
    const event = fomcEvent({
      lifecycleState: 'released', publishedAt: '2026-07-29T18:00:00.000Z',
      actual: { displayValue: '3.50%–3.75%', numericLowerBound: 3.5, numericUpperBound: 3.75, unit: 'percent' }
    })
    const { container } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available' as const, asOf, event })
    })

    await flush()
    await act(async () => button(container, registeredEventName('fomc')).click())
    await flush()

    const inspector = container.querySelector('.mi-economic-calendar__inspector')?.textContent
    expect(inspector).toContain('3.50%–3.75%')
    expect(inspector).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.details.unavailable)
    expect(inspector).not.toMatch(/https?:|rawRecordId|evidenceHash|sourceUrl|parser/i)
  })

  it('shows a revised FOMC value and its publication time separately from its date-only schedule', async () => {
    const event = fomcEvent({ lifecycleState: 'released', publishedAt: '2026-08-12T18:00:00.000Z',
      actual: { displayValue: '3.50%–3.75%' }, caveats: ['official-time-not-published', 'official-value-revised'] })
    const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available', asOf, event }) })
    await act(async () => eventButton(container, event.eventKey).click())
    const inspector = container.querySelector('.mi-economic-calendar__inspector')!
    expect(inspector.textContent).toContain('已修正')
    expect(inspector.textContent).toContain('2026-08-13 02:00:00 GMT+8')
    expect(inspector.textContent).toContain('官方未公布具体时间')
  })

  it.each([true, false])('reports failed FOMC refresh with retained official value only when one exists (%s)', async hasValue => {
    const event = fomcEvent({ scheduledDate: '2026-08-01', eventKey: 'US.FOMC.2026-08-01',
      ...(hasValue ? { lifecycleState: 'released', actual: { displayValue: '3.50%–3.75%' } } : {}) })
    const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available', asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available', asOf, event }), refreshFedFomcDecision: async () => ({ state: 'unavailable' }) })
    await act(async () => eventButton(container, event.eventKey).click())
    Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) })
    confirmSpy = window.confirm as ReturnType<typeof vi.fn>
    await act(async () => button(container, productText['zh-CN'].pages.intelligence.portal.calendar.fomcRefresh.action).click())
    const inspector = container.querySelector('.mi-economic-calendar__inspector')!
    if (hasValue) {
      expect(inspector.textContent).toContain('显示上次官方值')
      expect(inspector.textContent).toContain('2026-08-05 08:00:00 GMT+8')
      expect(inspector.textContent).toContain('3.50%–3.75%')
    } else {
      expect(inspector.textContent).not.toContain('显示上次官方值')
      expect(inspector.textContent).toContain('暂无官方值')
    }
  })

  it.each([
    ['date-only', { scheduledAt: undefined, caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule'] }],
    ['timed', { scheduledAt: '2026-08-12T12:30:00.000Z', caveats: ['manual-ics-import'] }]
  ] as const)('shows released actual before %s schedule copy while preserving inspector schedule metadata and caveat', async (_name, schedule) => {
    const event = blsEvent({
      ...schedule, lifecycleState: 'released', actual: { displayValue: '3.4%', numericValue: 3.364825041479902, unit: 'percent' }
    })
    const { container } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available' as const, asOf, event })
    })
    await flush()

    const compactValue = eventButton(container, event.eventKey).querySelector('.mi-economic-calendar__event-time')?.textContent
    expect(compactValue).toBe(schedule.scheduledAt ? '20:30' : '待定')
    expect(compactValue).not.toContain('3.4%')

    await act(async () => eventButton(container, event.eventKey).click())
    await flush()
    const inspector = container.querySelector('.mi-economic-calendar__inspector')?.textContent
    expect(inspector).toContain(schedule.scheduledAt ? '2026-08-12 20:30 GMT+8' : `2026-08-12 ${productText['zh-CN'].pages.intelligence.portal.calendar.details.scheduledDateOnly}`)
    expect(inspector).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.caveats[schedule.caveats[0] as 'official-time-not-published' | 'manual-ics-import'])
  })

  it('admits a released official date without rendering it as a publication time', async () => {
    const event = blsEvent({
      lifecycleState: 'released', scheduledAt: undefined, officialReleaseDate: '2026-08-12',
      actual: { displayValue: '3.4%', numericValue: 3.4, unit: 'percent' }, caveats: ['bls-python-schedule']
    })
    const { container } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available' as const, asOf, event })
    })
    await flush()

    expect(eventButton(container, event.eventKey).querySelector('.mi-economic-calendar__event-time')?.textContent).toBe('待定')
    expect(container.textContent).not.toContain('2026-08-12 00:00')
  })

  it('fails the month closed for an impossible official release date', async () => {
    const { container } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [blsEvent({ officialReleaseDate: '2026-02-30' })] }),
      getEventDetail: async () => unavailableDetail()
    })
    await flush()

    expect(container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.failures['calendar-query-unavailable'])
  })

  it('keeps compact scheduled time when no actual exists', async () => {
    const event = blsEvent()
    const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available' as const, asOf, events: [event] }), getEventDetail: async () => ({ state: 'available' as const, asOf, event }) })
    await flush()
    expect(eventButton(container, event.eventKey).querySelector('.mi-economic-calendar__event-time')?.textContent).toBe('20:30')
  })

  it('refreshes an eligible FOMC official value through the confirmed sealed action', async () => {
    const event = fomcEvent({
      eventKey: 'US.FOMC.2026-08-04', releaseGroupKey: 'US.FOMC.2026-08-04', periodKey: '2026-08-04', scheduledDate: '2026-08-04'
    })
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available' as const, asOf, event }),
      refreshFedFomcDecision: async () => ({ state: 'updated' as const })
    })

    await flush()
    await act(async () => button(container, registeredEventName('fomc')).click())
    await flush()
    Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) })
    confirmSpy = window.confirm as ReturnType<typeof vi.fn>
    await act(async () => button(container, '获取官方值').click())
    await flush()

    expect(client.refreshFedFomcDecision).toHaveBeenCalledWith({ eventKey: event.eventKey, confirmed: true })
    expect(client.queryMonth).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toMatch(/https?:|rawRecordId|evidenceHash|body|hash|proxy|header/i)
  })

  it.each([
    ['future', fomcEvent({ eventKey: 'US.FOMC.2026-08-12', releaseGroupKey: 'US.FOMC.2026-08-12', periodKey: '2026-08-12', scheduledDate: '2026-08-12' })],
    ['timed', fomcEvent({ eventKey: 'US.FOMC.2026-08-04', releaseGroupKey: 'US.FOMC.2026-08-04', periodKey: '2026-08-04', scheduledDate: '2026-08-04', scheduledAt: '2026-08-04T18:00:00.000Z' })],
    ['non-Fed', fomcEvent({ eventKey: 'US.FOMC.2026-08-04', releaseGroupKey: 'US.FOMC.2026-08-04', periodKey: '2026-08-04', scheduledDate: '2026-08-04', providerIds: ['macro-calendar-bls'] })],
    ['cancelled', fomcEvent({ eventKey: 'US.FOMC.2026-08-04', releaseGroupKey: 'US.FOMC.2026-08-04', periodKey: '2026-08-04', scheduledDate: '2026-08-04', lifecycleState: 'cancelled' })]
  ] as const)('does not show a FOMC official-value refresh action for a %s event', async (_label, event) => {
    const { container } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available' as const, asOf, event })
    })

    await flush()
    await act(async () => eventButton(container, event.eventKey).click())
    await flush()

    expect(container.textContent).not.toContain('获取官方值')
  })

  it('does not show BLS refresh feedback after switching to a FOMC detail', async () => {
    const bls = blsEvent({ eventKey: 'US.CPI.RELEASE.2026-M07', eventFamily: 'consumer-price-index', scheduledDate: '2026-08-04', scheduledAt: '2026-08-04T12:30:00.000Z' })
    const fomc = fomcEvent({ eventKey: 'US.FOMC.2026-08-04', releaseGroupKey: 'US.FOMC.2026-08-04', periodKey: '2026-08-04', scheduledDate: '2026-08-04' })
    const { container } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [bls, fomc] }),
      getEventDetail: async ({ eventKey }: { eventKey: string }) => ({ state: 'available' as const, asOf, event: eventKey === fomc.eventKey ? fomc : bls }),
      refreshBlsEmploymentRelease: async () => ({ state: 'unchanged' as const })
    })

    await flush()
    await act(async () => eventButton(container, bls.eventKey).click())
    await flush()
    Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) })
    confirmSpy = window.confirm as ReturnType<typeof vi.fn>
    await act(async () => button(container, '刷新 BLS 数据').click())
    await flush()
    expect(container.textContent).toContain('对应完整 BLS 发布组的数据已是最新。')

    await act(async () => eventButton(container, fomc.eventKey).click())
    await flush()

    expect(container.querySelector('.mi-economic-calendar__inspector')?.textContent).not.toContain('对应完整 BLS 发布组的数据已是最新。')
  })

  it('disables the FOMC refresh action while an eligible BLS refresh is pending', async () => {
    let settleBls: ((result: { state: 'updated' | 'unchanged' | 'unavailable' }) => void) | undefined
    const bls = blsEvent({ eventKey: 'US.CPI.RELEASE.2026-M07', eventFamily: 'consumer-price-index', scheduledDate: '2026-08-04', scheduledAt: '2026-08-04T12:30:00.000Z' })
    const fomc = fomcEvent({ eventKey: 'US.FOMC.2026-08-04', releaseGroupKey: 'US.FOMC.2026-08-04', periodKey: '2026-08-04', scheduledDate: '2026-08-04' })
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [bls, fomc] }),
      getEventDetail: async ({ eventKey }: { eventKey: string }) => ({ state: 'available' as const, asOf, event: eventKey === fomc.eventKey ? fomc : bls }),
      refreshBlsEmploymentRelease: () => new Promise((resolve) => { settleBls = resolve }),
      refreshFedFomcDecision: vi.fn(async () => ({ state: 'updated' as const }))
    })

    await flush()
    await act(async () => eventButton(container, bls.eventKey).click())
    await flush()
    Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) })
    confirmSpy = window.confirm as ReturnType<typeof vi.fn>
    await act(async () => button(container, '刷新 BLS 数据').click())
    await act(async () => eventButton(container, fomc.eventKey).click())
    await flush()

    const fomcAction = button(container, '获取官方值')
    expect(fomcAction.disabled).toBe(true)
    await act(async () => fomcAction.click())
    expect(client.refreshFedFomcDecision).not.toHaveBeenCalled()

    await act(async () => settleBls?.({ state: 'unchanged' }))
  })

  it('shows a confirmed refresh action for every released or past BLS five-metric schedule and re-queries after update', async () => {
    const event = blsEvent({ eventKey: 'US.NONFARM_PAYROLLS.RELEASE.group', eventFamily: 'employment-situation', titleKey: 'nonfarm-payrolls', scheduledDate: '2026-08-07', scheduledAt: '2026-08-07T12:30:00.000Z' })
    for (const [eventKey, eventFamily, titleKey, automatic] of [
      ['US.CPI.RELEASE.2026-M07', 'consumer-price-index', 'cpi', false],
      ['US.CORE_CPI.RELEASE.2026-M07', 'consumer-price-index', 'core-cpi', true],
      ['US.NONFARM_PAYROLLS.RELEASE.2026-M07', 'employment-situation', 'nonfarm-payrolls', false],
      ['US.UNEMPLOYMENT.RELEASE.2026-M07', 'employment-situation', 'unemployment', true],
      ['US.AVERAGE_HOURLY_EARNINGS.RELEASE.2026-M07', 'employment-situation', 'average-hourly-earnings', false]
    ] as const) {
      const metric = blsEvent({
        eventKey, eventFamily, titleKey, scheduledDate: '2026-08-07',
        ...(automatic
          ? { scheduledAt: undefined, caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule'] }
          : { scheduledAt: '2026-08-07T12:30:00.000Z' })
      })
      const { container, root: metricRoot, client } = await renderCalendar({
        queryMonth: async () => ({ state: 'available' as const, asOf, events: [metric] }),
        getEventDetail: async () => ({ state: 'available' as const, asOf, event: metric }),
        refreshBlsEmploymentRelease: async () => ({ state: 'updated' as const }),
        now: sequenceNow(asOf, '2026-08-08T00:00:00.000Z')
      })
      await flush()
      await act(async () => button(container, registeredEventName(titleKey)).click())
      await flush()
      Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) })
      confirmSpy = window.confirm as ReturnType<typeof vi.fn>
      await act(async () => button(container, '刷新 BLS 数据').click())
      await flush()
      expect(client.refreshBlsEmploymentRelease).toHaveBeenCalledWith({ eventKey, confirmed: true })
      expect(client.queryMonth).toHaveBeenCalledTimes(2)
      expect(container.textContent).not.toMatch(/raw|header|proxy|https?:|market-intelligence@example/i)
      await act(async () => metricRoot.unmount())
      container.remove()
      root = null
    }
  })

  it.each([
    ['legacy CPI', 'cpi', 'cpi', 'US.CPI.RELEASE.legacy'],
    ['legacy Core CPI', 'core-cpi', 'core-cpi', 'US.CORE_CPI.RELEASE.legacy']
  ] as const)('does not expose refresh for an uncovered past %s manual ICS row', async (_name, eventFamily, titleKey, eventKey) => {
    const legacyAsOf = '2026-07-15T00:00:00.000Z'
    const event = blsEvent({ eventKey, eventFamily, titleKey, scheduledDate: '2026-07-14', scheduledAt: '2026-07-14T12:30:00.000Z', detectedAt: legacyAsOf })
    const { container } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf: legacyAsOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available' as const, asOf: legacyAsOf, event }),
      now: () => new Date(legacyAsOf)
    })

    await flush()
    await act(async () => button(container, registeredEventName(titleKey)).click())
    await flush()

    expect(container.textContent).not.toContain('刷新 BLS 数据')
  })

  it.each([
    ['legacy CPI', 'US.CPI.RELEASE.2026-M06', 'cpi'],
    ['legacy Core CPI', 'US.CORE_CPI.RELEASE.2026-M06', 'core-cpi']
  ] as const)('refreshes a past %s manual ICS row through its canonical automatic projection', async (_name, eventKey, titleKey) => {
    const legacyAsOf = '2026-07-15T00:00:00.000Z'
    const automatic = blsEvent({
      eventKey, eventFamily: 'consumer-price-index', titleKey, scheduledDate: '2026-07-14', scheduledAt: undefined,
      detectedAt: legacyAsOf, caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule']
    })
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf: legacyAsOf, events: [automatic] }),
      getEventDetail: async () => ({ state: 'available' as const, asOf: legacyAsOf, event: automatic }),
      refreshBlsEmploymentRelease: async () => ({ state: 'updated' as const }),
      now: () => new Date(legacyAsOf)
    })

    await flush()
    await act(async () => button(container, registeredEventName(titleKey)).click())
    await flush()
    Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) })
    confirmSpy = window.confirm as ReturnType<typeof vi.fn>
    await act(async () => button(container, '刷新 BLS 数据').click())
    await flush()

    expect(client.refreshBlsEmploymentRelease).toHaveBeenCalledWith({ eventKey, confirmed: true })
    expect(client.queryMonth).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['cancelled automatic AHE', blsEvent({ eventKey: 'US.AVERAGE_HOURLY_EARNINGS.RELEASE.2026-M07', eventFamily: 'employment-situation', titleKey: 'average-hourly-earnings', scheduledDate: '2026-08-07', scheduledAt: undefined, lifecycleState: 'cancelled', caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule'] })],
    ['future manual CPI', blsEvent({ eventKey: 'US.CPI.RELEASE.2026-M07', eventFamily: 'consumer-price-index', titleKey: 'cpi', scheduledDate: '2026-08-09', scheduledAt: '2026-08-09T12:30:00.000Z' })],
    ['forged automatic caveat', blsEvent({ eventKey: 'US.CORE_CPI.RELEASE.2026-M07', eventFamily: 'consumer-price-index', titleKey: 'core-cpi', scheduledDate: '2026-08-07', scheduledAt: undefined, caveats: ['manual-ics-import', 'bls-python-schedule'] })],
    ['unrecognized BLS family', blsEvent({ eventKey: 'US.UNKNOWN.RELEASE.2026-M07', eventFamily: 'unknown-bls-family', titleKey: 'cpi', scheduledDate: '2026-08-07', scheduledAt: '2026-08-07T12:30:00.000Z' })]
  ])('never shows the BLS refresh action for a %s', async (_name, event) => {
    const { container } = await renderCalendar({ queryMonth: async () => ({ state: 'available' as const, asOf, events: [event] }), getEventDetail: async () => ({ state: 'available' as const, asOf, event }), now: sequenceNow(asOf, '2026-08-08T00:00:00.000Z') })
    await flush()
    // The verdict lives in the detail, so the detail has to be the thing under test. A family the
    // page refuses to project has no row at all, which is the strongest form of "no action offered".
    const row = container.querySelector<HTMLButtonElement>('.mi-economic-calendar__event')
    if (row) await act(async () => row.click())
    await flush()
    if (row) expect(container.querySelector('[data-release-time-row]')).not.toBeNull()
    expect(container.textContent).not.toContain('刷新 BLS 数据')
  })

  it('keeps a confirmed refresh disabled until settlement and only re-queries after updated', async () => {
    let settle: ((result: { state: 'updated' | 'unchanged' | 'unavailable' }) => void) | undefined
    const event = blsEvent({ eventKey: 'US.CPI.RELEASE.2026-M07', eventFamily: 'consumer-price-index', titleKey: 'cpi', scheduledDate: '2026-08-07', scheduledAt: '2026-08-07T12:30:00.000Z' })
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available' as const, asOf, event }),
      refreshBlsEmploymentRelease: () => new Promise((resolve) => { settle = resolve }),
      now: sequenceNow(asOf, '2026-08-08T00:00:00.000Z')
    })
    await flush()
    await act(async () => button(container, 'CPI').click())
    await flush()
    Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) })
    confirmSpy = window.confirm as ReturnType<typeof vi.fn>
    await act(async () => button(container, '刷新 BLS 数据').click())

    expect(button(container, '正在刷新 BLS 数据…').disabled).toBe(true)
    expect(client.queryMonth).toHaveBeenCalledTimes(1)

    await act(async () => settle?.({ state: 'unchanged' }))
    await flush()
    expect(client.queryMonth).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.blsRefresh.unchanged)
  })

  it.each(['unavailable', 'unchanged'] as const)('does not re-query when refresh resolves %s', async (state) => {
    const event = blsEvent({ eventKey: 'US.CORE_CPI.RELEASE.2026-M07', eventFamily: 'consumer-price-index', titleKey: 'core-cpi', scheduledDate: '2026-08-07', scheduledAt: undefined, caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule'] })
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available' as const, asOf, event }),
      refreshBlsEmploymentRelease: async () => ({ state }),
      now: sequenceNow(asOf, '2026-08-08T00:00:00.000Z')
    })
    await flush()
    await flush()
    await act(async () => button(container, registeredEventName('core-cpi')).click())
    await flush()
    expect(container.querySelector('.mi-economic-calendar__inspector')?.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.sources.blsAutomaticSchedule)
    expect(container.querySelector('.mi-economic-calendar__inspector')?.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.details.scheduledDateOnly)
    Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) })
    confirmSpy = window.confirm as ReturnType<typeof vi.fn>
    await act(async () => button(container, '刷新 BLS 数据').click())
    await flush()
    expect(client.queryMonth).toHaveBeenCalledTimes(1)
  })

  it('renders two compact grid rows with source markers and retains full source disclosure outside the grid', async () => {
    const event = blsEvent({
      providerIds: ['macro-calendar-bls', 'macro-calendar-fed'], periodKey: 'release-2026-08-07',
      scheduledDate: '2026-08-07', scheduledAt: '2026-08-07T12:30:00.000Z'
    })
    const { container } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [event] }),
      getEventDetail: async () => ({ state: 'available' as const, asOf, event })
    })

    await flush()

    const text = productText['zh-CN'].pages.intelligence.portal.calendar
    const card = container.querySelector<HTMLButtonElement>('.mi-economic-calendar__event')!
    const rows = card.querySelectorAll('[data-calendar-event-row]')
    const sourceMarker = card.querySelector<HTMLElement>('[data-calendar-source-marker]')
    expect(rows).toHaveLength(0)
    expect(card.textContent).toContain(text.events.cpi)
    expect(card.textContent).toContain('20:30')
    expect(sourceMarker).toBeNull()
    expect(card.textContent).not.toContain(text.sources.federalReserve)
    expect(card.textContent).not.toContain(text.sources.blsManualIcs)
    expect(card.textContent).not.toContain('手动 ICS')
    // The disclosure is the drawer's, so the reader opens it to read it.
    await act(async () => card.click())
    await flush()
    const inspectorText = container.querySelector('.mi-economic-calendar__inspector')?.textContent
    expect(inspectorText).toContain(`${text.details.source}${text.sources.federalReserve}, ${text.sources.blsManualIcs}`)
    expect(inspectorText).toContain(text.periods.officialNotPublished)
    expect(inspectorText).not.toContain('release-2026-08-07')
    expect(inspectorText).toContain('2026-08-07 20:30 GMT+8')
    expect(container.textContent).not.toMatch(/macro-calendar-(?:fed|bea|bls)|providerIds|descriptorId|rawRecordId|evidenceHash|https?:|credential/i)
  })

  it('renders compact localized loading, unavailable, and empty month states', async () => {
    const loading = await renderCalendar({ queryMonth: () => new Promise(() => undefined), getEventDetail: async () => unavailableDetail() })
    expect(loading.container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.status.loading)
    await act(async () => loading.root.unmount())
    loading.container.remove()

    const unavailable = await renderCalendar({ queryMonth: async () => ({ state: 'unavailable' as const, failureCode: 'calendar-query-unavailable' }), getEventDetail: async () => unavailableDetail() })
    await flush()
    expect(unavailable.container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.failures['calendar-query-unavailable'])
    await act(async () => unavailable.root.unmount())
    unavailable.container.remove()

    const empty = await renderCalendar({ queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }), getEventDetail: async () => unavailableDetail() })
    await flush()
    expect(empty.container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.status.empty)
    expect(empty.container.querySelector('.mi-economic-calendar__empty-state')).not.toBeNull()

    expect(loading.container.querySelector('.mi-economic-calendar__empty-state')).toBeNull()
    expect(unavailable.container.querySelector('.mi-economic-calendar__empty-state')).toBeNull()
  })

  it('accepts every caveat admitted by the shared renderer policy through the page sanitizer', async () => {
    const pce = blsEvent({
      eventKey: 'US.PCE.2026-07', releaseGroupKey: 'US.BEA.PCE.2026-07', eventFamily: 'pce', titleKey: 'pce', periodKey: '2026-07',
      lifecycleState: 'released', scheduledDate: '2026-08-26', scheduledAt: undefined, publishedAt: asOf,
      actual: { displayValue: '3.7%', numericValue: 3.7, unit: 'percent-yoy' }, providerIds: ['macro-calendar-bea'], caveats: [...macroEconomicCalendarCaveatPolicy.admittedCaveats]
    })
    const gdp = blsEvent({
      eventKey: 'US.GDP.2026-Q2.SECOND', releaseGroupKey: 'US.BEA.GDP.2026-Q2.SECOND', eventFamily: 'gdp', titleKey: 'gdp', periodKey: '2026-Q2',
      lifecycleState: 'released', scheduledDate: '2026-08-26', scheduledAt: undefined, publishedAt: asOf,
      actual: { displayValue: '1.5%', numericValue: 1.5, unit: 'percent-saar' }, providerIds: ['macro-calendar-bea'], caveats: [...macroEconomicCalendarCaveatPolicy.admittedCaveats]
    })
    const { container } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [pce, gdp] }),
      getEventDetail: async () => ({ state: 'available' as const, asOf, event: gdp })
    })

    await flush()

    expect(container.textContent).not.toContain(productText['zh-CN'].pages.intelligence.portal.calendar.failures['calendar-query-unavailable'])
    expect(container.querySelector('.mi-economic-calendar__grid')?.textContent).not.toContain('3.7%')
    await act(async () => eventButton(container, gdp.eventKey).click())
    await flush()
    expect(container.textContent).toContain('1.5%')
  })

  it('keeps unknown page caveats fail-closed', async () => {
    const { container } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [blsEvent({ caveats: ['unknown-caveat'] })] }),
      getEventDetail: async () => unavailableDetail()
    })

    await flush()

    expect(container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.failures['calendar-query-unavailable'])
  })

  it('converges a permanently pending initial month query to the existing redacted unavailable state without another request', async () => {
    vi.useFakeTimers()
    try {
      const { container, client } = await renderCalendar({
        queryMonth: () => new Promise(() => undefined),
        getEventDetail: async () => unavailableDetail()
      })

      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

      expect(client.queryMonth).toHaveBeenCalledTimes(1)
      expect(container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.failures['calendar-query-unavailable'])
      expect(container.textContent).not.toContain(productText['zh-CN'].pages.intelligence.portal.calendar.status.loading)
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves the initial month loading budget through React strict-mode effect replay without a second query', async () => {
    vi.useFakeTimers()
    try {
      const { container, client } = await renderCalendar({
        queryMonth: () => new Promise(() => undefined),
        getEventDetail: async () => unavailableDetail(),
        strict: true
      })

      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

      expect(client.queryMonth).toHaveBeenCalledTimes(1)
      expect(container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.failures['calendar-query-unavailable'])
      expect(container.textContent).not.toContain(productText['zh-CN'].pages.intelligence.portal.calendar.status.loading)
    } finally {
      vi.useRealTimers()
    }
  })

  it('replaces the prior month with the pending target and converges only that target to unavailable', async () => {
    vi.useFakeTimers()
    try {
      const august = blsEvent({ eventKey: 'US.CPI.AUGUST', scheduledDate: '2026-08-12' })
      const { container, client } = await renderCalendar({
        queryMonth: ({ month }: { month: string }) => month === '2026-08'
          ? Promise.resolve({ state: 'available' as const, asOf, events: [august] })
          : new Promise(() => undefined),
        getEventDetail: async () => unavailableDetail()
      })

      await flush()
      await act(async () => button(container, '下个月').click())
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

      expect(client.queryMonth).toHaveBeenCalledTimes(2)
      expect(container.querySelector('[data-month-key="2026-08"]')).toBeNull()
      expect(container.querySelector('[data-month-key="2026-09"]')?.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.failures['calendar-query-unavailable'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a month loading fallback when the normal query completes', async () => {
    vi.useFakeTimers()
    try {
      let resolveMonth: ((value: unknown) => void) | undefined
      const { container, client } = await renderCalendar({
        queryMonth: () => new Promise((resolve) => { resolveMonth = resolve }),
        getEventDetail: async () => unavailableDetail()
      })

      await act(async () => resolveMonth?.({ state: 'available', asOf, events: [] }))
      await flush()
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

      expect(client.queryMonth).toHaveBeenCalledTimes(1)
      expect(container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.status.empty)
      expect(container.textContent).not.toContain(productText['zh-CN'].pages.intelligence.portal.calendar.failures['calendar-query-unavailable'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('queries a directly selected month once on every real month switch without re-arming a completed fallback', async () => {
    vi.useFakeTimers()
    try {
      const { container, client } = await renderCalendar({
        queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }),
        getEventDetail: async () => unavailableDetail()
      })

      await flush()
      await act(async () => button(container, '下个月').click())
      await flush()
      await act(async () => button(container, '回到本月').click())
      await flush()
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

      const august = container.querySelector('[data-month-key="2026-08"]')
      expect(client.queryMonth).toHaveBeenCalledTimes(3)
      expect(august?.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.status.empty)
      expect(august?.textContent).not.toContain(productText['zh-CN'].pages.intelligence.portal.calendar.failures['calendar-query-unavailable'])
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['throws synchronously', () => { throw new Error('unavailable') }],
    ['rejects its promise', () => Promise.reject(new Error('unavailable'))]
  ])('fails closed when a month query %s', async (_name, queryMonth) => {
    const { container, client } = await renderCalendar({
      queryMonth,
      getEventDetail: async () => unavailableDetail()
    })

    await flush()

    expect(client.queryMonth).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.failures['calendar-query-unavailable'])
    expect(container.textContent).not.toContain(productText['zh-CN'].pages.intelligence.portal.calendar.status.loading)
  })

  it('routes an empty month to the data sources settings without issuing calendar queries', async () => {
    const navigation = vi.fn()
    window.addEventListener('app-shell:navigate', navigation)
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }),
      getEventDetail: async () => unavailableDetail()
    })

    await flush()
    await act(async () => button(container.querySelector<HTMLElement>('.mi-economic-calendar__empty-state')!, productText['zh-CN'].pages.intelligence.portal.calendar.emptyState.manageAction).click())

    expect(navigation).toHaveBeenCalledTimes(1)
    expect(navigation.mock.calls[0]?.[0].detail).toEqual({
      navKey: 'settings',
      settingsPanelKey: 'market-intelligence.intelligence-sources'
    })
    expect(client.queryMonth).toHaveBeenCalledTimes(1)
    expect(client.getEventDetail).not.toHaveBeenCalled()
    window.removeEventListener('app-shell:navigate', navigation)
  })

  it('starts only the existing file picker from the empty month import action', async () => {
    const selectFiles = vi.fn(async () => [])
    const readTextFile = vi.fn(async () => ({ path: '', text: '', truncated: false }))
    installFileBridge(selectFiles, readTextFile)
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }),
      getEventDetail: async () => unavailableDetail()
    })

    await flush()
    await act(async () => button(container.querySelector<HTMLElement>('.mi-economic-calendar__empty-state')!, productText['zh-CN'].pages.intelligence.portal.calendar.manualImport.action).click())
    await flush()

    expect(selectFiles).toHaveBeenCalledTimes(1)
    expect(readTextFile).not.toHaveBeenCalled()
    expect(client.previewManualBlsIcs).not.toHaveBeenCalled()
    expect(client.importManualBlsIcs).not.toHaveBeenCalled()
    expect(client.queryMonth).toHaveBeenCalledTimes(1)
    expect(client.getEventDetail).not.toHaveBeenCalled()
  })

  it('keeps a localized inspector state visible while a selected event detail is loading', async () => {
    const calendar = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [blsEvent()] }),
      getEventDetail: () => new Promise(() => undefined)
    })

    await flush()
    await act(async () => calendar.container.querySelector<HTMLButtonElement>('[data-calendar-row]')!.click())

    expect(calendar.container.querySelector('.mi-economic-calendar__inspector')?.textContent).toContain(
      productText['zh-CN'].pages.intelligence.portal.calendar.status.loading
    )
  })

  it('imports a selected local BLS ICS and refreshes only the current calendar month without changing asOf', async () => {
    const path = '/private/downloads/bls.ics'
    const body = 'BEGIN:VCALENDAR\nSUMMARY:secret\nEND:VCALENDAR'
    const selectFiles = vi.fn(async () => [path])
    const readTextFile = vi.fn(async () => ({ path, text: body, truncated: false }))
    installFileBridge(selectFiles, readTextFile)
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }),
      getEventDetail: async () => unavailableDetail(),
      previewManualBlsIcs: async () => preview(),
      importManualBlsIcs: async () => ({ ...preview(), state: 'imported' as const }),
      now: sequenceNow(asOf, asOf)
    })

    await flush()
    await act(async () => button(container, '上个月').click())
    await flush()
    const importButton = button(container, productText['zh-CN'].pages.intelligence.portal.calendar.manualImport.action)
    expect(importButton.getAttribute('aria-label')).toBe(productText['zh-CN'].pages.intelligence.portal.calendar.manualImport.action)
    expect(importButton.querySelector('svg')).not.toBeNull()
    await act(async () => importButton.click())
    await flush()

    expect(document.body.textContent).toContain('bls.ics')
    expect(document.body.textContent).toContain(String(preview().supportedReleaseGroups))
    expect(document.body.textContent).not.toMatch(/private|BEGIN:VCALENDAR|secret|https?:|evidenceHash|rawRecordId|credential/i)

    await act(async () => button(document.body, productText['zh-CN'].pages.intelligence.portal.calendar.manualImport.actions.confirm).click())
    await flush()

    expect(client.previewManualBlsIcs).toHaveBeenCalledWith({ body, truncated: false })
    expect(client.importManualBlsIcs).toHaveBeenCalledWith({ body, truncated: false })
    expect(client.queryMonth).toHaveBeenCalledTimes(3)
    expect(client.queryMonth).toHaveBeenNthCalledWith(1, { month: '2026-08', asOf })
    expect(client.queryMonth).toHaveBeenNthCalledWith(2, { month: '2026-07', asOf })
    expect(client.queryMonth).toHaveBeenNthCalledWith(3, { month: '2026-07', asOf })
    expect(document.body.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.manualImport.results.imported)
  })

  it('clears a selected event and its detail when the imported-month refresh becomes unavailable', async () => {
    const path = '/private/downloads/bls.ics'
    const body = 'BEGIN:VCALENDAR\nEND:VCALENDAR'
    const event = blsEvent()
    const selectFiles = vi.fn(async () => [path])
    const readTextFile = vi.fn(async () => ({ path, text: body, truncated: false }))
    let queryCount = 0
    installFileBridge(selectFiles, readTextFile)
    const { container, client } = await renderCalendar({
      queryMonth: async () => ++queryCount === 1
        ? { state: 'available' as const, asOf, events: [event] }
        : { state: 'unavailable' as const, failureCode: 'calendar-query-unavailable' as const },
      getEventDetail: async () => ({ state: 'available' as const, asOf, event }),
      previewManualBlsIcs: async () => preview(),
      importManualBlsIcs: async () => ({ ...preview(), state: 'imported' as const })
    })

    await flush()
    await act(async () => eventButton(container, event.eventKey).click())
    await flush()
    expect(container.querySelector('.mi-economic-calendar__inspector')?.textContent).toContain('CPI')
    await act(async () => button(container, productText['zh-CN'].pages.intelligence.portal.calendar.manualImport.action).click())
    await flush()
    await act(async () => button(document.body, productText['zh-CN'].pages.intelligence.portal.calendar.manualImport.actions.confirm).click())
    await flush()

    expect(client.queryMonth).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-event-key]')).toBeNull()
    expect(container.querySelector('.mi-economic-calendar__inspector')).toBeNull()
    // The month went away, so its detail goes with it: the drawer does not outlive its reading.
    expect(container.querySelector('[data-calendar-detail-container]')).toBeNull()
    expect(client.getEventDetail).toHaveBeenCalledTimes(1)
  })

  it('uses previous, next, the Ant Design month picker, and current reset to load one direct target each with unchanged asOf', async () => {
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }),
      getEventDetail: async () => unavailableDetail()
    })

    await flush()
    expect(container.querySelector('input[type="month"]')).toBeNull()
    const picker = container.querySelector<HTMLInputElement>('.mi-economic-calendar__month-picker')!
    expect(picker.dataset.picker).toBe('month')
    expect(picker.dataset.allowClear).toBe('false')
    expect(picker.dataset.format).toBe('YYYY-MM')
    expect(picker.readOnly).toBe(true)
    expect(readSource('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css')).not.toContain('color-scheme')
    await act(async () => button(container, '上个月').click())
    await flush()
    await act(async () => button(container, '下个月').click())
    await flush()
    await act(async () => {
      picker.value = '2026-12'
      picker.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    await act(async () => button(container, '回到本月').click())
    await flush()

    expect(client.queryMonth).toHaveBeenCalledTimes(5)
    expect(client.queryMonth).toHaveBeenNthCalledWith(1, { month: '2026-08', asOf })
    expect(client.queryMonth).toHaveBeenNthCalledWith(2, { month: '2026-07', asOf })
    expect(client.queryMonth).toHaveBeenNthCalledWith(3, { month: '2026-08', asOf })
    expect(client.queryMonth).toHaveBeenNthCalledWith(4, { month: '2026-12', asOf })
    expect(client.queryMonth).toHaveBeenNthCalledWith(5, { month: '2026-08', asOf })
  })

  it('removes the inert current-month label while retaining a usable current-month reset', async () => {
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }),
      getEventDetail: async () => unavailableDetail()
    })

    await flush()

    const text = productText['zh-CN'].pages.intelligence.portal.calendar
    expect(container.textContent).not.toContain(text.month)
    await act(async () => button(container, text.monthNavigation.previous).click())
    await flush()
    const reset = button(container, text.monthNavigation.current)
    expect(reset).not.toBeNull()
    await act(async () => reset.click())
    await flush()

    expect(client.queryMonth).toHaveBeenCalledTimes(3)
    expect(client.queryMonth).toHaveBeenNthCalledWith(2, { month: '2026-07', asOf })
    expect(client.queryMonth).toHaveBeenNthCalledWith(3, { month: '2026-08', asOf })
  })

  it.each([[''], ['2026-8'], ['not-a-month']])('retains the selected month and makes no query for an invalid picker callback %j', async (candidate) => {
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }),
      getEventDetail: async () => unavailableDetail()
    })

    await flush()
    const picker = container.querySelector<HTMLInputElement>('.mi-economic-calendar__month-picker')!
    await act(async () => {
      picker.value = candidate
      picker.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()

    expect(picker.dataset.value).toBe('2026-08')
    expect(client.queryMonth).toHaveBeenCalledTimes(1)
    expect(client.queryMonth).toHaveBeenCalledWith({ month: '2026-08', asOf })
  })

  it('retains the standing day list for a malformed picker callback', async () => {
    const events = [
      blsEvent({ eventKey: 'US.CPI.ONE', scheduledDate: '2026-08-12' }),
      blsEvent({ eventKey: 'US.CPI.TWO', scheduledDate: '2026-08-12', titleKey: 'core-cpi' }),
      blsEvent({ eventKey: 'US.CPI.THREE', scheduledDate: '2026-08-12', titleKey: 'pce', eventFamily: 'pce' })
    ]
    events.push(...Array.from({ length: 4 }, (_, i) => blsEvent({ eventKey: `US.CPI.EXTRA${i}` })))
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events }),
      getEventDetail: async () => unavailableDetail()
    })

    await flush()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-calendar-more]')!.click())
    await flush()
    const picker = container.querySelector<HTMLInputElement>('.mi-economic-calendar__month-picker')!
    await act(async () => {
      picker.value = '2026-8'
      picker.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()

    expect(container.querySelector('[data-calendar-day-list] [role="list"]')).not.toBeNull()
    expect(client.queryMonth).toHaveBeenCalledTimes(1)
  })

  it('keeps the canonical month in the picker display without serializing through UTC', async () => {
    const { container } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }),
      getEventDetail: async () => unavailableDetail()
    })

    await flush()
    const picker = container.querySelector<HTMLInputElement>('.mi-economic-calendar__month-picker')!

    expect(picker.dataset.value).toBe('2026-08')
    expect(readSource('products/market-intelligence/desktop/features/macro/economic-calendar/EconomicCalendar.tsx')).not.toContain('toISOString')
  })

  it('shows only the selected target month and ignores an earlier month completion', async () => {
    let resolveAugust: ((value: unknown) => void) | undefined
    let resolveDecember: ((value: unknown) => void) | undefined
    const { container } = await renderCalendar({
      queryMonth: ({ month }: { month: string }) => new Promise((resolve) => {
        if (month === '2026-08') resolveAugust = resolve
        if (month === '2026-12') resolveDecember = resolve
      }),
      getEventDetail: async () => unavailableDetail()
    })

    const picker = container.querySelector<HTMLInputElement>('.mi-economic-calendar__month-picker')!
    await act(async () => {
      picker.value = '2026-12'
      picker.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => resolveDecember?.({ state: 'available', asOf, events: [blsEvent({ eventKey: 'US.CPI.DECEMBER', scheduledDate: '2026-12-10', scheduledAt: '2026-12-10T12:30:00.000Z' })] }))
    await flush()
    await act(async () => resolveAugust?.({ state: 'available', asOf, events: [blsEvent({ eventKey: 'US.CPI.AUGUST', scheduledDate: '2026-08-10' })] }))
    await flush()

    expect(container.querySelector('[data-event-key="US.CPI.AUGUST"]')).toBeNull()
    expect(container.querySelector('[data-event-key="US.CPI.DECEMBER"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-month-key]')).toHaveLength(1)
    expect(container.querySelector('[data-month-key="2026-12"]')).not.toBeNull()
  })

  it('renders one single-month section without stream scrolling or edge loading', async () => {
    const { container, client } = await renderCalendar({
      queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }),
      getEventDetail: async () => unavailableDetail()
    })

    await flush()

    expect(client.queryMonth).toHaveBeenCalledTimes(1)
    expect(client.queryMonth).toHaveBeenNthCalledWith(1, { month: '2026-08', asOf })
    expect(container.querySelectorAll('[data-month-key]')).toHaveLength(1)
    expect(container.querySelector('.mi-economic-calendar__stream')).toBeNull()
    expect(readSource('products/market-intelligence/desktop/features/macro/economic-calendar/EconomicCalendar.tsx')).not.toMatch(/onScroll|scrollIntoView|pendingScroll|monthSections|economicCalendarStreamPolicy/)
  })

  it.each([
    ['malformed', { state: 'available', events: [] }],
    ['accessor', accessorMonthResult()],
    ['symbol-bearing', symbolMonthResult()],
    ['extension-bearing', { state: 'available', asOf, events: [], extra: true }],
    ['cyclic', cyclicMonthResult()],
    ['throwing Proxy', new Proxy({}, { getPrototypeOf: () => { throw new Error('trap') } })]
  ])('fails closed for a %s selected-month result without retaining the prior month', async (_name, invalidResult) => {
    const august = blsEvent({ eventKey: 'US.CPI.AUGUST', scheduledDate: '2026-08-12' })
    const { container, client } = await renderCalendar({
      queryMonth: async ({ month }: { month: string }) => month === '2026-08'
        ? { state: 'available' as const, asOf, events: [august] }
        : invalidResult,
      getEventDetail: async () => unavailableDetail()
    })

    await flush()
    await act(async () => button(container, '下个月').click())
    await flush()

    expect(client.queryMonth).toHaveBeenNthCalledWith(2, { month: '2026-09', asOf })
    expect(container.querySelector('[data-month-key="2026-09"]')?.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.failures['calendar-query-unavailable'])
    expect(container.querySelector('[data-month-key="2026-08"]')).toBeNull()
  })

  it('replaces the visible month with the target loading state before its pending query settles', async () => {
    let resolveDecember: ((value: unknown) => void) | undefined
    const august = blsEvent({ eventKey: 'US.CPI.AUGUST', scheduledDate: '2026-08-12' })
    const { container } = await renderCalendar({
      queryMonth: ({ month }: { month: string }) => month === '2026-08'
        ? Promise.resolve({ state: 'available' as const, asOf, events: [august] })
        : new Promise((resolve) => { resolveDecember = resolve }),
      getEventDetail: async () => unavailableDetail()
    })

    await flush()
    const picker = container.querySelector<HTMLInputElement>('.mi-economic-calendar__month-picker')!
    await act(async () => {
      picker.value = '2026-12'
      picker.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(container.querySelector('[data-event-key="US.CPI.AUGUST"]')).toBeNull()
    expect(container.querySelector('[data-month-key="2026-12"]')?.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.calendar.status.loading)
    await act(async () => resolveDecember?.({ state: 'available', asOf, events: [] }))
  })

  it('uses only the feature public barrel across the page boundary and keeps the renderer free of service and transport imports', () => {
    const page = readSource('products/market-intelligence/desktop/pages/intelligence/index.tsx')
    const calendar = readSource('products/market-intelligence/desktop/features/macro/economic-calendar/EconomicCalendar.tsx')
    const model = readSource('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendarModel.ts')
    const client = readSource('products/market-intelligence/desktop/shared/ipc/macroEconomicCalendarClient.ts')
    const barrel = readSource('products/market-intelligence/desktop/features/macro/economic-calendar/index.ts')

    expect(page).toContain("from '../../features/macro/economic-calendar'")
    expect(page).not.toContain('features/macro/economic-calendar/EconomicCalendar')
    expect(page).not.toContain("shared/ipc/macroEconomicCalendarClient")
    expect(barrel).toContain("export { EconomicCalendar }")
    expect(barrel).toContain("export { macroEconomicCalendarClient }")
    expect([calendar, model].join('\n')).not.toMatch(/import.+(?:service|parser|repository|raw-store|fetch|WebSocket|axios|node:)/i)
    expect(client).not.toMatch(/(?:fetch|WebSocket|axios|node:|service|parser|repository|raw-store)/i)
  })

  it('uses feature-local theme variables without a calendar stream scroll container', () => {
    const styles = readSource('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css')

    expect(styles).toContain('--mi-economic-surface: var(--surface)')
    expect(styles).toContain('--mi-economic-text: var(--text)')
    expect(styles).not.toContain('mi-economic-calendar__stream')
    expect(styles).not.toContain('mi-economic-calendar__month-section')
  })

  it('gives every compact event text cell a genuine single-line flex ellipsis contract', () => {
    const styles = readSource('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css')

    for (const selector of [
      '.mi-economic-calendar__event-title',
      '.mi-economic-calendar__event-time'
    ]) {
      const rule = cssRule(styles, selector)
      expect(rule).toContain('min-width: 0')
      expect(rule).toContain('white-space: nowrap')
      expect(rule).toContain('overflow: hidden')
      expect(rule).toContain('text-overflow: ellipsis')
    }
    expect(cssRule(styles, '.mi-economic-calendar__event')).toContain('grid-template-columns: var(--mi-calendar-time-width) minmax(0, 1fr)')
  })

  it('right-aligns the compact primary value in the event card', () => {
    const styles = readSource('products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css')

    expect(cssRule(styles, '.mi-economic-calendar__event-time')).toContain('text-align: left')
  })

  it('selects the official event a caller named, from the month page that holds it', async () => {
    // The dashboard card's rows carry an event key; asking for one must land on its detail.
    const official = blsEvent({ eventKey: 'US.CPI.RELEASE.2026-M10', scheduledDate: '2026-10-13', scheduledAt: '2026-10-13T12:30:00.000Z' })
    const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-10', locale: 'zh', asOf, events: [], sources: [] })
    const getEventDetail = vi.fn(async () => ({ state: 'available' as const, asOf, event: official }))
    try {
      await renderCalendar({ openTarget: { month: '2026-10', eventKey: official.eventKey },
        queryMonth: async () => ({ state: 'available', asOf, events: [official] }), getEventDetail })
      await settleCalendar()
      expect(getEventDetail).toHaveBeenCalledWith({ eventKey: official.eventKey, asOf })
    } finally { query.mockRestore() }
  })

  it('selects a provider event a caller named, on the route that owns it', async () => {
    const provider: MarketCalendarEvent = { eventKey: '00000000-0000-4000-8000-0000000000aa', title: 'Provider-named event',
      countryCode: null, eventType: 'financial-event', importance: 'high', scheduledAt: '2026-10-13T12:30:00.000Z',
      consensus: null, providerActual: null, providerPrevious: null, source: '0xRouter',
      sourceObservedAt: '2026-10-01T00:00:00.000Z', coverage: 'observed-unverified' }
    const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-10', locale: 'zh', asOf, events: [provider], sources: [] })
    try {
      const { container } = await renderCalendar({ openTarget: { month: '2026-10', eventKey: provider.eventKey },
        queryMonth: async () => ({ state: 'available', asOf, events: [provider] }), getEventDetail: async () => unavailableDetail() })
      await settleCalendar()
      expect(container.querySelector('.mi-market-calendar__inspector')?.textContent).toContain(provider.title)
    } finally { query.mockRestore() }
  })

  it('leaves the page alone when the named event is not in the month it was asked for', async () => {
    const query = vi.spyOn(marketCalendarClient, 'queryMonth').mockResolvedValue({ state: 'available', month: '2026-10', locale: 'zh', asOf, events: [], sources: [] })
    const getEventDetail = vi.fn(async () => unavailableDetail())
    try {
      const { container } = await renderCalendar({ openTarget: { month: '2026-10', eventKey: 'US.CPI.RELEASE.2099-M01' },
        queryMonth: async () => ({ state: 'available', asOf, events: [] }), getEventDetail })
      await settleCalendar()
      expect(getEventDetail).not.toHaveBeenCalled()
      expect(container.querySelector('.mi-market-calendar__inspector')).toBeNull()
    } finally { query.mockRestore() }
  })

  it('follows the clock into the next month and reads it as of now', async () => {
    let clock = new Date('2026-08-30T12:00:00.000Z')
    const { container, client } = await renderCalendar({
      now: () => clock,
      queryMonth: async (input: { month: string; asOf: string }) => ({ state: 'available' as const, asOf: input.asOf, events: [] }),
      getEventDetail: async () => unavailableDetail()
    })
    await settleCalendar()
    expect(client.queryMonth).toHaveBeenCalledWith({ month: '2026-08', asOf: '2026-08-30T12:00:00.000Z' })

    clock = new Date('2026-09-01T00:10:00.000Z')
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await settleCalendar()

    expect(client.queryMonth).toHaveBeenCalledWith({ month: '2026-09', asOf: '2026-09-01T00:10:00.000Z' })
    expect(container.querySelector('.mi-economic-calendar__month')?.getAttribute('data-month-key')).toBe('2026-09')
  })

  it('leaves a month the reader chose alone, and brings them back to the live one', async () => {
    let clock = new Date('2026-08-30T12:00:00.000Z')
    const { container, client } = await renderCalendar({
      now: () => clock,
      queryMonth: async (input: { month: string; asOf: string }) => ({ state: 'available' as const, asOf: input.asOf, events: [] }),
      getEventDetail: async () => unavailableDetail()
    })
    await settleCalendar()
    await act(async () => button(container, '下个月').click())
    await settleCalendar()
    expect(client.queryMonth).toHaveBeenLastCalledWith({ month: '2026-09', asOf: '2026-08-30T12:00:00.000Z' })

    // The reader owns this month now: a boundary must not move the page under them.
    clock = new Date('2026-10-01T00:10:00.000Z')
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await settleCalendar()
    expect(client.queryMonth).not.toHaveBeenCalledWith(expect.objectContaining({ month: '2026-10' }))
    expect(container.querySelector('.mi-economic-calendar__month')?.getAttribute('data-month-key')).toBe('2026-09')

    // Asking for the current month reads the clock, not the month the page opened with.
    await act(async () => button(container, '回到本月').click())
    await settleCalendar()
    expect(client.queryMonth).toHaveBeenLastCalledWith({ month: '2026-10', asOf: '2026-10-01T00:10:00.000Z' })
  })
})

const asOf = '2026-08-05T00:00:00.000Z'

async function renderCalendar(client: {
  queryMonth: () => unknown
  getEventDetail: () => unknown
  previewManualBlsIcs?: () => unknown
  importManualBlsIcs?: () => unknown
    refreshBlsEmploymentRelease?: () => unknown
  refreshFedFomcDecision?: () => unknown
  syncBlsEmploymentSchedule?: () => unknown
  now?: () => Date
  strict?: boolean
  openTarget?: { month: string; eventKey?: string }
}) {
  const container = document.createElement('div')
  document.body.append(container)
  const localRoot = createRoot(container)
  const input = {
    queryMonth: vi.fn(client.queryMonth),
    getEventDetail: vi.fn(client.getEventDetail),
    previewManualBlsIcs: vi.fn(client.previewManualBlsIcs ?? (async () => ({ state: 'failed' as const, failureCode: 'invalid-file' as const }))),
    importManualBlsIcs: vi.fn(client.importManualBlsIcs ?? (async () => ({ state: 'failed' as const, failureCode: 'invalid-file' as const }))),
    refreshBlsEmploymentRelease: vi.fn(client.refreshBlsEmploymentRelease ?? (async () => ({ state: 'unavailable' as const }))),
    refreshFedFomcDecision: vi.fn(client.refreshFedFomcDecision ?? (async () => ({ state: 'unavailable' as const }))),
    syncBlsEmploymentSchedule: vi.fn(client.syncBlsEmploymentSchedule ?? (async () => ({ state: 'unavailable' as const })))
  }
  root = localRoot
  // 显示时区由窗口级 provider 提供；测试固定 Asia/Shanghai，断言才与宿主时区无关。
  const calendar = <ShellTimeZoneProvider timeZone="Asia/Shanghai"><EconomicCalendar client={input as never} now={client.now ?? (() => new Date(asOf))} onBack={() => undefined} {...(client.openTarget ? { openTarget: client.openTarget } : {})} text={productText['zh-CN'].pages.intelligence.portal.calendar} /></ShellTimeZoneProvider>
  await act(async () => localRoot.render(client.strict ? <StrictMode>{calendar}</StrictMode> : calendar))
  return { container, root: localRoot, client: input }
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

/**
 * Drains the month-load chain (month sync → query → projection → selection) before asserting.
 *
 * Opening a named month adds hops to the chain the initial load does not have, and waiting on a
 * fixed timer instead would either flake or slow the suite down.
 */
async function settleCalendar(): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) await flush()
}

function blsEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'US.CPI.RELEASE.uid-1', releaseGroupKey: 'US.BLS.RELEASE.uid-1', eventFamily: 'cpi', titleKey: 'cpi',
    countryCode: 'US' as const, importance: 'high' as const, periodKey: 'release-2026-08-12', lifecycleState: 'scheduled' as const,
    coverage: 'available' as const, scheduledDate: '2026-08-12', scheduledAt: '2026-08-12T12:30:00.000Z', releaseTimeSource: 'official' as const, detectedAt: asOf,
    consensus: null, consensusState: 'unavailable' as const, surprise: 'consensus-unavailable' as const,
    providerIds: ['macro-calendar-bls'], caveats: ['official-period-not-published-in-ics', 'manual-ics-import'], ...overrides
  }
}

function fomcEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'US.FOMC.2026-08-12', releaseGroupKey: 'US.FOMC.2026-08-12', eventFamily: 'fomc', titleKey: 'fomc',
    countryCode: 'US' as const, importance: 'high' as const, periodKey: '2026-08-12', lifecycleState: 'scheduled' as const,
    coverage: 'available' as const, scheduledDate: '2026-08-12', releaseTimeSource: 'date-only' as const, detectedAt: asOf,
    consensus: null, consensusState: 'unavailable' as const, surprise: 'consensus-unavailable' as const,
    providerIds: ['macro-calendar-fed'], caveats: ['official-time-not-published'], ...overrides
  }
}

function unavailableDetail() {
  return { state: 'unavailable' as const, failureCode: 'event-not-found' }
}

function preview() {
  return {
    state: 'ready' as const,
    totalEvents: 313,
    supportedReleaseGroups: 46,
    generatedEvents: 115,
    unsupportedEvents: 198,
    insertedCount: 100,
    rescheduledCount: 10,
    unchangedCount: 5
  }
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(text))
  if (!match) throw new Error(`missing button: ${text}`)
  return match
}

/**
 * 日历行的按钮，按**产品自己的**事件名找（设计 145 §8 D）。
 *
 * 这里曾经用缩写去找（`calendar.abbreviations`）：那时缩写在日历侧那份长名字里**恰好**是子串
 * （「FOMC / 利率决议」「Core CPI（核心消费者价格指数）」「非农就业报告」），于是"找一个按钮"
 * 顺带把两份词表钉在了一起。词表统一到分析侧之后那个巧合不再成立——按名字找，才是测产品行为。
 */
function registeredEventName(titleKey: string): string {
  return (productText['zh-CN'].pages.intelligence.portal.analysisWorkspace.readableNames.eventName as Record<string, string>)[titleKey]!
}

function eventButton(container: HTMLElement, eventKey: string): HTMLButtonElement {
  const match = container.querySelector<HTMLButtonElement>(`[data-event-key="${eventKey}"]`)
  if (!match) throw new Error(`missing event: ${eventKey}`)
  return match
}

function installFileBridge(selectFiles: () => Promise<string[]>, readTextFile: (path: string) => Promise<{ path: string; text: string; truncated: boolean }>): void {
  const original = Object.getOwnPropertyDescriptor(window, 'platform')
  Object.defineProperty(window, 'platform', { configurable: true, value: { app: { selectFiles, readTextFile } } })
  restorePlatform = () => {
    if (original) Object.defineProperty(window, 'platform', original)
    else Reflect.deleteProperty(window, 'platform')
  }
}

function sequenceNow(...instants: string[]): () => Date {
  let index = 0
  return () => new Date(instants[Math.min(index++, instants.length - 1)]!)
}

function accessorMonthResult(): Record<string, unknown> {
  const result: Record<string, unknown> = { state: 'available', asOf, events: [] }
  Object.defineProperty(result, 'asOf', { enumerable: true, get: () => asOf })
  return result
}

function symbolMonthResult(): Record<string | symbol, unknown> {
  return { state: 'available', asOf, events: [], [Symbol('unexpected')]: true }
}

function cyclicMonthResult(): Record<string, unknown> {
  const result: Record<string, unknown> = { state: 'available', asOf, events: [] }
  result.self = result
  return result
}

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? ''
}
