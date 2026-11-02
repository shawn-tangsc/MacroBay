// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { CalendarInspector } from './CalendarInspector'


const DETAIL_TITLE = productText['zh-CN'].pages.intelligence.portal.calendar.details.title

it('opens one side panel, not a drawer: the board beside it stays visible and clickable', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const close = vi.fn()
  try {
    await act(async () => root.render(
      <CalendarInspector contentId="US.CPI.AUGUST" onClose={close} open when="20:30 GMT+8"><p>Derived detail</p></CalendarInspector>
    ))
    expect(host.querySelectorAll('[data-calendar-detail-container]')).toHaveLength(1)
    expect(host.querySelector('[data-calendar-detail-container]')?.textContent).toContain('Derived detail')
    // A panel, not a modal: no drawer root, no mask, no dialog role. The panel takes its own column
    // and the calendar keeps the rest, so nothing has to be dismissed before picking the next row.
    const panel = host.querySelector('aside')
    expect(panel?.classList.contains('side-panel')).toBe(true)
    expect(panel?.classList.contains('mi-calendar-detail')).toBe(true)
    expect(host.querySelector('.ant-drawer')).toBeNull()
    expect(host.querySelector('.ant-drawer-mask')).toBeNull()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    // One visible way out, named by the component's own text table rather than the caller's key space.
    const closeControl = host.querySelector<HTMLButtonElement>('aside button')!
    expect(closeControl.getAttribute('aria-label')).toBe('收起面板')
    await act(async () => closeControl.click())
    expect(close).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('keeps nothing of the detail mounted while the panel is closed', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(
      <CalendarInspector contentId="US.CPI.AUGUST" onClose={() => {}} open={false} when="20:30 GMT+8"><p>Derived detail</p></CalendarInspector>
    ))
    expect(host.querySelectorAll('[data-calendar-detail-container]')).toHaveLength(0)
    expect(host.textContent).not.toContain('Derived detail')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('closes on Escape from anywhere, and leaves the reader\'s focus on the row they picked', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const outside = document.createElement('button'); outside.textContent = 'event row'; document.body.append(outside)
  const root = createRoot(host)
  const close = vi.fn()
  try {
    await act(async () => root.render(
      <CalendarInspector contentId="US.CPI.AUGUST" onClose={close} open={false} when="20:30 GMT+8">List</CalendarInspector>
    ))
    outside.focus()
    await act(async () => outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(close).not.toHaveBeenCalled()

    await act(async () => root.render(
      <CalendarInspector contentId="US.CPI.AUGUST" onClose={close} open when="20:30 GMT+8"><p>Event detail</p></CalendarInspector>
    ))
    // `stay`: the reader is clicking down the list, so opening the panel must not pull them out of it.
    expect(document.activeElement).toBe(outside)
    // The panel does not take Escape (the reader walks between both sides), so the detail keeps its
    // own key: it is opened from a list and has to stay dismissable from the keyboard.
    await act(async () => outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(close).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); host.remove(); outside.remove() }
})

it('announces which row is showing, with its moment, once for a burst of picks', async () => {
  vi.useFakeTimers()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const render = async (contentId: string, when: string): Promise<void> => {
    await act(async () => {
      root.render(
        <CalendarInspector contentId={contentId} onClose={() => undefined} open when={when}><p>Event detail</p></CalendarInspector>
      )
    })
  }
  try {
    await render('US.CPI.AUGUST', '20:30 GMT+8')
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    const first = host.querySelector('[role="status"]')?.textContent ?? ''
    expect(first).toContain(DETAIL_TITLE)
    expect(first).toContain('20:30 GMT+8')
    // A template that was never filled also "contains the title", so the placeholder check is the
    // one that catches an empty `when`.
    expect(first).not.toContain('{')

    // Two picks inside the debounce window: the reader wants "where did I land", not a transcript.
    await render('US.FOMC.SEPTEMBER', '21:00 GMT+8')
    await render('US.NFP.SEPTEMBER', '21:30 GMT+8')
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    const status = host.querySelector('[role="status"]')?.textContent ?? ''
    expect(status).toContain('21:30 GMT+8')
    expect(status).not.toContain('21:00 GMT+8')
  } finally { vi.useRealTimers(); await act(async () => root.unmount()); host.remove() }
})
