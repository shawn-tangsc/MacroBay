// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import { expect, it, vi } from 'vitest'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('opens one detail drawer on the left, without a mask, with its close control in the header corner', async () => {
  const { CalendarInspector } = await import('./CalendarInspector')
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const close = vi.fn()
  try {
    await act(async () => root.render(<CalendarInspector open onClose={close} title="Details"><p>Derived detail</p></CalendarInspector>))
    expect(host.querySelectorAll('[data-calendar-detail-container]')).toHaveLength(1)
    expect(host.querySelector('[data-calendar-detail-container]')?.textContent).toContain('Derived detail')
    // Left and unmasked: the surface the reader was reading stays visible and clickable underneath.
    expect(host.querySelector('.ant-drawer-left')).not.toBeNull()
    expect(host.querySelector('.ant-drawer-mask')).toBeNull()
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    // One width for both entry points (calendar page and dashboard card), wide enough that the
    // release title and the source/period rows do not wrap on their first line.
    expect(host.querySelector<HTMLElement>('.ant-drawer-content-wrapper')?.style.width).toBe('480px')
    // One visible way out, in the header's own corner rather than in front of the title.
    const closeControl = host.querySelector<HTMLButtonElement>('.ant-drawer-close')!
    expect(closeControl).not.toBeNull()
    expect(closeControl.classList.contains('ant-drawer-close-end')).toBe(true)
    await act(async () => closeControl.click())
    expect(close).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); host.remove() }
})
it('keeps nothing of the detail mounted while the drawer is closed', async () => {
  const { CalendarInspector: Inspector } = await import('./CalendarInspector')
  const CalendarInspector = (props: Parameters<typeof Inspector>[0]) => <ConfigProvider theme={{ token: { motion: false } }}><Inspector {...props} /></ConfigProvider>
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<CalendarInspector open={false} onClose={() => {}} title="Details"><p>Derived detail</p></CalendarInspector>))
    expect(host.querySelectorAll('[data-calendar-detail-container]')).toHaveLength(0)
    expect(host.textContent).not.toContain('Derived detail')
  } finally { await act(async () => root.unmount()); host.remove() }
})
it('closes on Escape from anywhere, and ignores Escape while closed', async () => {
  const { CalendarInspector: Inspector } = await import('./CalendarInspector')
  const CalendarInspector = (props: Parameters<typeof Inspector>[0]) => <ConfigProvider theme={{ token: { motion: false } }}><Inspector {...props} /></ConfigProvider>
  const host = document.createElement('div'); document.body.append(host)
  const outside = document.createElement('button'); document.body.append(outside)
  const root = createRoot(host)
  const close = vi.fn()
  try {
    await act(async () => root.render(<CalendarInspector open={false} onClose={close} title="Details">List</CalendarInspector>))
    outside.focus()
    await act(async () => outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(close).not.toHaveBeenCalled()
    await act(async () => root.render(<CalendarInspector open onClose={close} title="Details"><p>Event detail</p></CalendarInspector>))
    // Without a mask the reader can click the calendar, so the key can arrive outside the drawer.
    expect(document.activeElement).toBe(outside)
    await act(async () => outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(close).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); host.remove(); outside.remove() }
})
