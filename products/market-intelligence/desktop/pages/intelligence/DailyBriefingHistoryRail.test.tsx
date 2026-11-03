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
  scheduledTime: '08:00',
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
      timeZone="Asia/Shanghai"
      onSelect={() => undefined}
      {...props}
    />)
  })

describe('daily briefing history rail', () => {
  it('keeps the meta in unbreakable facts and leaves the attempt count to the list', () => {
    render({ editions: [edition({ attemptCount: 2 })], onLoadAttempts: async () => ({ state: 'available', attempts: [] }) })
    const meta = host.querySelector('.mi-daily-briefing__rail-meta')
    expect(meta?.textContent).toContain('4')
    expect(meta?.textContent).toContain('项')
    // "/4" and the word "生成" are the two things this row no longer says.
    expect(meta?.textContent).not.toContain('/4')
    expect(meta?.textContent).not.toContain('生成')
    // Only the count and the clock: the date is already on the row's first line, the offset belongs
    // to the settings page — repeating them here is what made the row read as crowded.
    expect(meta?.textContent).not.toContain('2026-11-02')
    expect(meta?.textContent).not.toContain('GMT')
    expect(meta?.textContent).toContain('08:00')
    // The row is the clock and the item count; the attempts list below already numbers every try, so
    // repeating "2 attempts" up here said the same fact twice.
    expect(meta?.textContent).not.toContain(text.history.attempts.times)
    expect(host.querySelector('[data-attempts-toggle]')?.textContent).toBe(text.history.attempts.show)
  })

  it('says "not run" once, with the scheduled time only for today, and keeps the direction word for screen readers', () => {
    render({ editions: [
      edition({ state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: undefined }),
      // A past day that did not run: repeating the same clock twelve times told the reader nothing.
      edition({ date: '2026-10-28', state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: undefined }),
      edition({ date: '2026-11-01', direction: undefined })
    ] })
    expect(host.textContent).toContain(`${text.history.missingRun} · 08:00`)
    const past = host.querySelector('[data-date="2026-10-28"]')?.closest('.mi-daily-briefing__rail-item')
    expect(past?.textContent).toContain(text.history.missingRun)
    expect(past?.textContent).not.toContain('08:00')
    // The missing row no longer repeats "not generated" and "app was not running" together.
    expect(host.textContent).not.toContain(`${text.history.missingRun}${text.history.generated}`)
    // A row without a verdict shows a dot; the word is only in the accessible name.
    const dot = host.querySelector('.mi-daily-briefing__rail-direction--none')
    expect(dot?.getAttribute('aria-label')).toBe(text.history.noConclusion)
    expect(host.textContent).not.toContain(text.history.noConclusion)
  })

  it('shows one row per issue and switches language in place', () => {
    const onSelect = vi.fn()
    render({ editions: [edition({ availableLocales: ['zh-CN', 'en-US'], locale: 'zh-CN' })], onSelect })
    expect(host.querySelectorAll('.mi-daily-briefing__rail-item')).toHaveLength(1)
    const english = host.querySelector('[data-locale="en-US"]') as HTMLButtonElement
    act(() => english.click())
    expect(onSelect).toHaveBeenCalledWith('2026-11-02', 'en-US')
  })

  it('marks the language the reader is reading, not the one the list row happens to carry', () => {
    // The row summary carries the issue's primary language. After switching in place the page shows
    // another language of the same issue, so the pressed button has to follow what is shown.
    render({
      editions: [edition({ availableLocales: ['zh-CN', 'en-US'], locale: 'zh-CN' })],
      selectedDate: '2026-11-02',
      selectedLocale: 'en-US'
    })
    expect((host.querySelector('[data-locale="en-US"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect((host.querySelector('[data-locale="zh-CN"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')
    // The issue is still the current row even though its primary language is not the shown one.
    expect(host.querySelector('.mi-daily-briefing__rail-row')?.getAttribute('aria-current')).toBe('true')
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
