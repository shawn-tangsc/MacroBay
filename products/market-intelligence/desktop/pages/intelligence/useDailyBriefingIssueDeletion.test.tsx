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

    await act(async () => { await deletion().deletePeriod({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' }) })

    expect(deletePeriod).toHaveBeenCalledWith({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' })
    expect(deletion().outcome).toEqual({ target: { date: '2026-11-02', periodId: 'default', locale: 'zh-CN' }, kind: 'partial', remaining: 3 })
    // The list is read again either way: a row that survived the delete must still be on screen.
    expect(onSettled).toHaveBeenCalledTimes(1)
    // Half of it went through, so the reload must not generate either.
    expect(deletion().takeSkipGenerate()).toBe(true)
    // One-shot: the next ordinary read generates again.
    expect(deletion().takeSkipGenerate()).toBe(false)
  })

  it('says the count is unknown, not zero, when the call itself fails', async () => {
    const deletePeriod = vi.fn(async () => { throw new Error('ipc-down') })
    const deletion = render({ deletePeriod }, vi.fn())

    await act(async () => { await deletion().deletePeriod({ date: '2026-11-02', periodId: 'default', locale: 'en-US' }) })

    expect(deletion().outcome).toEqual({ target: { date: '2026-11-02', periodId: 'default', locale: 'en-US' }, kind: 'partial', remaining: null })
    // Nothing was deleted: the reload behaves like any other reload.
    expect(deletion().takeSkipGenerate()).toBe(false)
  })

  it('does not report a delete that removed nothing', async () => {
    const empty = vi.fn(async () => ({ editions: 0, attempts: 0, periodRuns: 0, sessionLinks: 0, remaining: 0, allDone: true }))
    const deletion = render({ deletePeriod: empty }, vi.fn())

    await act(async () => { await deletion().deletePeriod({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' }) })

    // The reply removed no edition: the note must say so, not "deleted".
    expect(deletion().outcome).toEqual({ target: { date: '2026-11-02', periodId: 'default', locale: 'zh-CN' }, kind: 'nothing', remaining: 0 })
  })

  it('reports a finished delete once, and does nothing without a port', async () => {
    const done = vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0, sessionLinks: 0, remaining: 0, allDone: true }))
    const withPort = render({ deletePeriod: done }, vi.fn())
    await act(async () => { await withPort().deletePeriod({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' }) })
    // A finished delete still says what happened — once — while the pane it lands on stays the
    // ordinary empty state.
    expect(withPort().outcome).toEqual({ target: { date: '2026-11-02', periodId: 'default', locale: 'zh-CN' }, kind: 'done', remaining: 0 })
    expect(withPort().takeSkipGenerate()).toBe(true)

    const noPort = render({}, vi.fn())
    await act(async () => { await noPort().deletePeriod({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' }) })
    expect(noPort().outcome).toBeNull()
    expect(noPort().takeSkipGenerate()).toBe(false)
  })
})
