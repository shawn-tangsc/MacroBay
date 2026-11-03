// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
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
    render({ editions: [edition({ attemptCount: 2 })] })
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
    // The row is the clock and the item count; the attempt trail lives in the detail column, so a row
    // here carries no expander and no count.
    expect(meta?.textContent).not.toContain(text.history.attempts.times)
    expect(host.querySelector('[data-attempts-toggle]')).toBeNull()
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

  it('names which languages an issue has, as a read-only tag', () => {
    render({ editions: [
      edition({ date: '2026-10-30', availableLocales: ['zh-CN'] }),
      edition({ date: '2026-10-29', availableLocales: ['en-US'] }),
      edition({ date: '2026-10-28', availableLocales: ['zh-CN', 'en-US'] }),
      edition({ date: '2026-10-27', state: 'missing', availableLocales: [], generatedAt: undefined })
    ] })
    const tags = [...host.querySelectorAll<HTMLElement>('[data-edition-languages]')]

    expect(tags.map((tag) => tag.getAttribute('data-edition-languages'))).toEqual(['zh', 'en', 'both'])
    expect(tags[2].textContent).toBe(text.history.editionLanguages.both)
    // A fact, not a control: nothing here is focusable, so the row keeps one Tab stop.
    expect(tags.every((tag) => !tag.hasAttribute('tabindex'))).toBe(true)
    // A day without an edition has nothing to name.
    expect(host.querySelector('[data-date="2026-10-27"]')?.closest('.mi-daily-briefing__rail-item')?.querySelector('[data-edition-languages]')).toBeNull()
  })

  it('says a failed run on the row, without a count and without the reason', () => {
    render({ editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: 2 })] })
    const row = host.querySelector<HTMLElement>('.mi-daily-briefing__rail-row')!

    expect(row.textContent).toContain(`${text.history.generationFailed} · 08:00`)
    // No item count (there is no edition) and no reason (its length would break the row height).
    expect(row.textContent).not.toMatch(/\d+\s*项/)
    expect(row.textContent).not.toContain(text.aiSettings.failure['model-unavailable'])
    expect(row.textContent).not.toContain(text.history.missingRun)
  })

  it('keeps one row per issue and offers no language switch of its own', () => {
    // Contract change: the edition language is chosen from the top tab, so a row that had two
    // languages no longer renders a pair of buttons.
    const onSelect = vi.fn()
    render({ editions: [edition({ availableLocales: ['zh-CN', 'en-US'], locale: 'zh-CN' })], onSelect })
    expect(host.querySelectorAll('.mi-daily-briefing__rail-item')).toHaveLength(1)
    expect(host.querySelectorAll('[data-locale]')).toHaveLength(0)
    expect(host.querySelectorAll('.mi-daily-briefing__rail-lang')).toHaveLength(0)

    act(() => host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!.click())
    expect(onSelect).toHaveBeenCalledWith('2026-11-02')
  })

  it('marks an incomplete issue with the status pill, not a hand-made chip', () => {
    render({ editions: [edition({ state: 'partial' })], resolveText: () => '未完整' })
    expect(host.querySelector('.status-pill--warn')).not.toBeNull()
    expect(host.textContent).toContain('未完整')
  })
})
