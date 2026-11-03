// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DailyBriefingClientAttemptsResult } from '../../shared/ipc/dailyBriefingClient'
import { productText } from '../../shared/i18n/productText'
import { DailyBriefingAttempts } from './DailyBriefingAttempts'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

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

const flush = async (): Promise<void> => {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

const render = (loadAttempts?: () => Promise<DailyBriefingClientAttemptsResult>) =>
  act(() => {
    root.render(<DailyBriefingAttempts
      date="2026-11-02"
      locale="zh-CN"
      periodId="default"
      text={text}
      {...(loadAttempts ? { loadAttempts } : {})}
    />)
  })

describe('daily briefing attempt trail', () => {
  it('renders nothing when the client cannot read attempts', () => {
    render()
    expect(host.querySelector('[data-briefing-attempts]')).toBeNull()
  })

  it('opens from its summary line, never from an attempt count', async () => {
    const loadAttempts = vi.fn(async () => ({ state: 'available' as const, attempts: [] }))
    render(loadAttempts)
    // One disclosure shape with the other two blocks: native details, the summary is the target,
    // and it holds no button of its own.
    const details = host.querySelector<HTMLDetailsElement>('details[data-briefing-attempts]')!
    const summary = details.querySelector<HTMLElement>('summary')!

    expect(host.querySelectorAll('h3')).toHaveLength(1)
    expect(host.textContent!.match(/生成记录/g) ?? []).toHaveLength(1)
    expect(summary.querySelectorAll('button, a')).toHaveLength(0)
    expect(summary.textContent).not.toMatch(/\d|次/)
    expect(details.open).toBe(false)
    expect(loadAttempts).not.toHaveBeenCalled()

    act(() => summary.click())
    await flush()
    expect(details.open).toBe(true)
    expect(loadAttempts).toHaveBeenCalledWith('2026-11-02', 'default', 'zh-CN')
  })

  it('numbers the attempts and says which one was cleaned', async () => {
    render(async () => ({
      state: 'available' as const,
      attempts: [
        { attemptNo: 2, state: 'succeeded' as const, startedAt: '2026-10-30T08:00:00.000Z', finishedAt: '2026-10-30T08:05:00.000Z', cleanedAt: '2026-10-30T08:10:00.000Z' },
        { attemptNo: 1, state: 'failed' as const, failureCode: 'source-failed', startedAt: '2026-10-30T07:00:00.000Z', finishedAt: '2026-10-30T07:01:00.000Z' }
      ]
    }))
    act(() => host.querySelector<HTMLElement>('summary')!.click())
    await flush()

    expect(host.textContent).toContain('第 2 次')
    expect(host.textContent).toContain(text.history.attempts.cleaned)
    expect(host.querySelectorAll('[data-attempt]')).toHaveLength(2)
  })

  it('states an unreadable attempt list instead of drawing "no attempts"', async () => {
    render(async () => ({ state: 'unavailable' as const }))
    act(() => host.querySelector<HTMLElement>('summary')!.click())
    await flush()

    expect(host.textContent).toContain(text.history.attempts.unreadable)
    expect(host.textContent).not.toContain(text.history.attempts.none)
  })
})
