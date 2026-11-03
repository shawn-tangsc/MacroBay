// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigProvider } from 'antd'
import { ConfirmProvider } from '@platform/ui/components/confirm'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'

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
    // The row menu's delete confirmation is the shared dialog: it must render inside its provider,
    // or the hook throws instead of opening a themed dialog.
    root.render(<ConfigProvider button={WINDOW_ANTD_BUTTON_CONFIG}><ConfirmProvider>
      <DailyBriefingHistoryRail
      editions={[edition()]}
      todayDate="2026-11-02"
      locale="zh-CN"
      text={text}
      timeZone="Asia/Shanghai"
      onSelect={() => undefined}
      {...props}
    />
    </ConfirmProvider></ConfigProvider>)
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

  it('deletes the edition on screen, after the shared confirmation', async () => {
    const onDeletePeriod = vi.fn()
    const resolveText = (key: string) => key.endsWith('history.deleteEdition.zh-CN') ? '删除中文版…' : key
    render({ resolveText, onDeletePeriod })
    const row = host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!

    act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const item = document.querySelector<HTMLElement>('.ant-dropdown-menu-item') ?? document.querySelector<HTMLElement>('[role="menuitem"]')!
    act(() => { item.click() })
    for (let round = 0; round < 6; round += 1) await flush()

    // 删除是一个不可撤销的动作：先弹共用确认框，点「删除」才真的调宿主。
    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.replace(/\s/g, '') === text.history.deleteConfirm)!
    expect(confirmButton).not.toBeUndefined()
    expect(onDeletePeriod).not.toHaveBeenCalled()
    act(() => { confirmButton.click() })
    await flush()

    // The language is the one the reader was reading, and the menu said so before the dialog.
    expect(onDeletePeriod).toHaveBeenCalledWith({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' })
  })

  it('opens a one-item delete menu from right-click or the keyboard, and disables it while generating', () => {
    const resolveText = (key: string) => key.endsWith('history.deleteEdition.zh-CN')
      ? '删除中文版…'
      : key.endsWith('history.deletePeriodBlocked') ? '生成中不能删除这一期' : key
    render({ resolveText })
    const row = host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!

    act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain('删除中文版…')

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelectorAll('.ant-dropdown-menu-item')).toHaveLength(0)

    // Keyboard equivalent opens the same menu; while the day is generating it is disabled with a reason.
    render({ resolveText, generatingStage: 'AI 选择' })
    const running = host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!
    act(() => { running.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })) })
    const blocked = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(blocked).toHaveLength(1)
    expect(blocked[0].textContent).toContain('生成中不能删除这一期')
  })

  it('prints no reading count when the row carries none, instead of a fabricated zero', () => {
    // "0 项" was shown for editions whose count the list does not carry: unknown is not zero.
    render({ editions: [{ ...edition(), readingsAvailable: undefined }] })
    expect(host.textContent).not.toContain('0 项')
    // A real zero says nothing either: it is not a fact worth a column.
    render({ editions: [{ ...edition(), readingsAvailable: 0 }] })
    expect(host.textContent).not.toContain('0 项')
    expect(host.querySelectorAll('.mi-daily-briefing__rail-row')).toHaveLength(1)
  })

  it('carries the acceptance anchor on the language tag, and only where a tag exists', () => {
    // `02` finds this label by anchor: a tag without it fails the gate, and an anchor without a
    // tag would let a machine "find" a label the reader cannot see.
    render({ editions: [edition({ availableLocales: ['zh-CN', 'en-US'] })] })
    const tag = host.querySelector('[data-briefing-locale-tag]')
    expect(tag).not.toBeNull()
    expect(tag?.textContent).toBe(text.history.editionLanguages.both)

    render({ editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined })] })
    expect(host.querySelectorAll('[data-briefing-locale-tag]')).toHaveLength(0)

    render({ editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: 2 })], resolveText: (key: string) => key })
    expect(host.querySelectorAll('[data-briefing-locale-tag]')).toHaveLength(0)

    render({ editions: [edition()], generatingStage: 'AI 选择' })
    expect(host.querySelectorAll('[data-briefing-locale-tag]')).toHaveLength(1)
  })

  it('offers only the languages this issue actually has', () => {
    // A menu that names a language the issue does not have is how "deleted the Chinese edition"
    // happened for an issue with only an English one.
    const onlyEnglish = (key: string) => key.endsWith('history.deleteEdition.en-US') ? '删除英文版…' : key.endsWith('history.deleteEdition.zh-CN') ? '删除中文版…' : key
    render({ editions: [edition({ availableLocales: ['en-US'] })], resolveText: onlyEnglish })
    act(() => { host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain('删除英文版…')
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })

    render({ editions: [edition({ availableLocales: ['zh-CN', 'en-US'] })], resolveText: onlyEnglish })
    act(() => { host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2)
  })

  it('says there is nothing to delete when the issue has no edition', () => {
    render({
      editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined })],
      resolveText: (key: string) => key.endsWith('history.deleteNoEdition') ? '这一期没有可删除的版本' : key
    })
    act(() => { host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain('这一期没有可删除的版本')
  })

  it('marks an incomplete issue with the status pill, not a hand-made chip', () => {
    render({ editions: [edition({ state: 'partial' })], resolveText: () => '未完整' })
    expect(host.querySelector('.status-pill--warn')).not.toBeNull()
    expect(host.textContent).toContain('未完整')
  })
})
