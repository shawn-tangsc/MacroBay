// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDailyBriefingIssueDeletion } from './useDailyBriefingIssueDeletion'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

type Deletion = ReturnType<typeof useDailyBriefingIssueDeletion>

function render(client: Parameters<typeof useDailyBriefingIssueDeletion>[0]['client'], onSettled: () => void) {
  let latest: Deletion | undefined
  const Probe = (): null => { latest = useDailyBriefingIssueDeletion({ client, onSettled }); return null }
  act(() => root.render(<Probe />))
  return () => latest!
}

describe('briefing issue deletion', () => {
  it('keeps the real leftover count when the delete only half finished', async () => {
    const onSettled = vi.fn()
    const deletePeriod = vi.fn(async () => ({ editions: 2, attempts: 1, periodRuns: 1, sessionLinks: 0, remaining: 3, allDone: false }))
    const deletion = render({ deletePeriod }, onSettled)

    await act(async () => { await deletion().deletePeriod({ date: '2026-11-02', periodId: 'default' }) })

    expect(deletePeriod).toHaveBeenCalledWith({ date: '2026-11-02', periodId: 'default' })
    expect(deletion().outcome).toEqual({ target: { date: '2026-11-02', periodId: 'default' }, remaining: 3 })
    // The list is read again either way: a row that survived the delete must still be on screen.
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('says the count is unknown, not zero, when the call itself fails', async () => {
    const deletePeriod = vi.fn(async () => { throw new Error('ipc-down') })
    const deletion = render({ deletePeriod }, vi.fn())

    await act(async () => { await deletion().deletePeriod({ date: '2026-11-02', periodId: 'default' }) })

    expect(deletion().outcome).toEqual({ target: { date: '2026-11-02', periodId: 'default' }, remaining: null })
  })

  it('clears the note when everything was deleted, and does nothing without a port', async () => {
    const done = vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0, sessionLinks: 0, remaining: 0, allDone: true }))
    const withPort = render({ deletePeriod: done }, vi.fn())
    await act(async () => { await withPort().deletePeriod({ date: '2026-11-02', periodId: 'default' }) })
    expect(withPort().outcome).toBeNull()

    const noPort = render({}, vi.fn())
    await act(async () => { await noPort().deletePeriod({ date: '2026-11-02', periodId: 'default' }) })
    expect(noPort().outcome).toBeNull()
  })
})
