// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingClientAttemptsResult } from '../../shared/ipc/dailyBriefingClient'
import { DailyBriefingHistoryRail } from './DailyBriefingHistoryRail'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

const edition = (overrides: Partial<DailyBriefingEditionSummary> = {}): DailyBriefingEditionSummary => ({
  date: '2026-11-02',
  periodId: 'default',
  locale: 'zh-CN',
  availableLocales: ['zh-CN'],
  state: 'generated',
  generatedAt: '2026-11-02T00:00:00.000Z',
  readingsAvailable: 4,
  windowEnd: '2026-11-02T00:00:00.000Z',
  ...overrides
})

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

const render = (props: Partial<React.ComponentProps<typeof DailyBriefingHistoryRail>> = {}) =>
  act(() => {
    root.render(<DailyBriefingHistoryRail
      editions={[edition()]}
      todayDate="2026-11-02"
      locale="zh-CN"
      text={text}
      onSelect={() => undefined}
      {...props}
    />)
  })

describe('daily briefing history rail', () => {
  it('shows one row per issue and switches language in place', () => {
    const onSelect = vi.fn()
    render({ editions: [edition({ availableLocales: ['zh-CN', 'en-US'], locale: 'zh-CN' })], onSelect })
    expect(host.querySelectorAll('.mi-daily-briefing__rail-item')).toHaveLength(1)
    const english = host.querySelector('[data-locale="en-US"]') as HTMLButtonElement
    act(() => english.click())
    expect(onSelect).toHaveBeenCalledWith('2026-11-02', 'en-US')
  })

  it('expands an issue into its attempts and says which one was cleaned', async () => {
    const attempts: DailyBriefingClientAttemptsResult = {
      state: 'available',
      attempts: [
        { attemptNo: 2, state: 'succeeded', startedAt: '2026-10-30T08:00:00.000Z', finishedAt: '2026-10-30T08:05:00.000Z', cleanedAt: '2026-10-30T08:10:00.000Z' },
        { attemptNo: 1, state: 'failed', failureCode: 'source-failed', startedAt: '2026-10-30T07:00:00.000Z', finishedAt: '2026-10-30T07:01:00.000Z' }
      ]
    }
    const onLoadAttempts = vi.fn(async () => attempts)
    render({ onLoadAttempts })
    const toggle = host.querySelector('[data-attempts-toggle]') as HTMLButtonElement
    act(() => toggle.click())
    await flush()
    expect(onLoadAttempts).toHaveBeenCalledWith('2026-11-02', 'default', 'zh-CN')
    expect(host.textContent).toContain('第 2 次')
    expect(host.textContent).toContain(text.history.attempts.cleaned)
    expect(host.querySelectorAll('[data-attempt]')).toHaveLength(2)
  })

  it('states an unreadable attempt list instead of drawing "no attempts"', async () => {
    render({ onLoadAttempts: async () => ({ state: 'unavailable' }) })
    act(() => (host.querySelector('[data-attempts-toggle]') as HTMLButtonElement).click())
    await flush()
    expect(host.textContent).toContain(text.history.attempts.unreadable)
    expect(host.textContent).not.toContain(text.history.attempts.none)
  })

  it('marks an incomplete issue with the status pill, not a hand-made chip', () => {
    render({ editions: [edition({ state: 'partial' })], resolveText: () => '未完整' })
    expect(host.querySelector('.status-pill--warn')).not.toBeNull()
    expect(host.textContent).toContain('未完整')
  })
})
