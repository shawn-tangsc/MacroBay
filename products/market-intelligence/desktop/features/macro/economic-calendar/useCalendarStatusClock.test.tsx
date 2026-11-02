// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('updates on the single local interval and focus, then cleans up on unmount', async () => {
  const { useCalendarStatusClock } = await import('./useCalendarStatusClock')
  vi.useFakeTimers()
  const host = document.createElement('div'), root = createRoot(host)
  let time = 0
  const now = vi.fn(() => new Date(time))
  function View() {
    const [instant, refresh] = useCalendarStatusClock(now)
    return <button onClick={refresh}>{instant}</button>
  }
  try {
    await act(async () => root.render(<View />))
    time = 35000
    await act(async () => host.querySelector('button')!.click())
    expect(host.textContent).toBe(new Date(time).toISOString())
    expect(vi.getTimerCount()).toBe(1)
    time = 60000
    await act(async () => vi.advanceTimersByTime(60000))
    expect(host.textContent).toBe(new Date(time).toISOString())
    time = 70000
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(host.textContent).toBe(new Date(time).toISOString())
    await act(async () => root.unmount())
    const calls = now.mock.calls.length
    vi.advanceTimersByTime(60000); window.dispatchEvent(new Event('focus'))
    expect(now).toHaveBeenCalledTimes(calls)
  } finally { vi.useRealTimers() }
})
