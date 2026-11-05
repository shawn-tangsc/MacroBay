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
  it('prints one clock on a normal row, and both clocks only when the run was irregular', () => {
    // 正常行由排期生成：计划与实际是同一个值，印两个词只是噪音，还会把 252px 顶爆。
    render({ editions: [edition({ attemptCount: 2, periodTime: '2026-11-02T00:00:00.000Z' })] })
    const meta = host.querySelector('.mi-daily-briefing__rail-meta')
    expect(meta?.textContent).toContain('08:00')
    expect(meta?.textContent).not.toContain(text.history.timePlanned)
    expect(meta?.textContent).not.toContain(text.history.timeActual)
    expect(meta?.textContent).not.toContain('/4')
    expect(meta?.textContent).not.toContain('GMT')
    // 补跑/手动那类才成对出现，两个时刻真的不同。
    render({ editions: [edition({ attemptCount: 2, runTrigger: 'catch-up', periodTime: '2026-11-02T00:00:00.000Z' })] })
    const irregular = host.querySelector('.mi-daily-briefing__rail-meta')
    expect(irregular?.textContent).toContain(`${text.history.timePlanned} 08:00`)
    expect(irregular?.textContent).toContain(`${text.history.timeActual} 08:00`)
    // The item count is a row fact, not part of the clock run.
    expect(host.textContent).toContain(`4 ${text.readingsUnit}`)
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
    // Past days start collapsed: expand the day before reading its rows.
    const pastHead = [...host.querySelectorAll<HTMLButtonElement>('.mi-daily-briefing__rail-day-head')]
      .find((head) => head.closest('.mi-daily-briefing__rail-day')?.getAttribute('data-day') === '2026-10-28')!
    act(() => pastHead.click())
    const past = host.querySelector('[data-date="2026-10-28"]')?.closest('.mi-daily-briefing__rail-item')
    expect(past?.textContent).toContain(text.history.missingRun)
    // A9.9: a day that did not run still names its time once — the row has no body to show instead.
    expect(past?.textContent).toContain('08:00')
    // The missing row no longer repeats "not generated" and "app was not running" together.
    expect(host.textContent).not.toContain(`${text.history.missingRun}${text.history.generated}`)
    // A row without a verdict shows a dot; the word is only in the accessible name.
    const head = [...host.querySelectorAll<HTMLButtonElement>('.mi-daily-briefing__rail-day-head')]
      .find((node) => node.closest('.mi-daily-briefing__rail-day')?.getAttribute('data-day') === '2026-11-01')!
    act(() => head.click())
    const dot = host.querySelector('.mi-daily-briefing__rail-direction--none')
    expect(dot?.getAttribute('aria-label')).toBe(text.history.noConclusion)
    expect(host.textContent).not.toContain(text.history.noConclusion)
  })

  it('names each language the issue actually has, as a chip per language', () => {
    render({ editions: [
      edition({ availableLocales: ['zh-CN'] }),
      edition({ date: '2026-10-29', availableLocales: ['en-US'] }),
      edition({ date: '2026-10-28', availableLocales: ['zh-CN', 'en-US'] }),
      edition({ date: '2026-10-27', state: 'missing', availableLocales: [], generatedAt: undefined })
    ] })
    // Only today is open by default; the other days are headings with their issue count.
    const todayChips = [...host.querySelectorAll<HTMLElement>('[data-edition-locale]')].map((chip) => chip.getAttribute('data-edition-locale'))
    expect(todayChips).toEqual(['zh-CN'])
    const heads = [...host.querySelectorAll<HTMLElement>('.mi-daily-briefing__rail-day-count')].map((node) => node.textContent)
    expect(heads).toEqual(['共 1 期', '共 1 期', '共 1 期', '共 1 期'])
    // A day without an edition has no language to name.
    expect(host.querySelector('[data-day="2026-10-27"]')).not.toBeNull()
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

  it('prints one badge per row — the row\'s own language, never a choice of two', () => {
    // 一行 = 一期 = 一种语言：徽标是**标签**，不是可切换的开关。同一期即使带着两种语言的状态，
    // 这一行也只印自己的那一枚——否则读者又会以为“可以切语言”。
    const onSelect = vi.fn()
    const onSelectLocale = vi.fn()
    render({
      editions: [edition({ availableLocales: ['zh-CN', 'en-US'], languages: [
        { locale: 'zh-CN', state: 'published' }, { locale: 'en-US', state: 'published' }
      ], locale: 'zh-CN' })],
      selectedDate: '2026-11-02', onSelect, onSelectLocale
    })
    expect(host.querySelectorAll('.mi-daily-briefing__rail-item')).toHaveLength(1)
    const chips = [...host.querySelectorAll<HTMLElement>('[data-edition-locale]')]
    expect(chips.map((chip) => chip.getAttribute('data-edition-locale'))).toEqual(['zh-CN'])
    // 徽标不再是被按下的控件：没有 aria-pressed，点了也不会换语言。
    expect(chips[0]?.getAttribute('aria-pressed')).toBeNull()
    act(() => {
      const row = host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith('2026-11-02')
    expect(onSelectLocale).not.toHaveBeenCalled()
  })

  it('deletes the edition on screen, after the shared confirmation', async () => {
    const onDeletePeriod = vi.fn()
    const resolveText = (key: string) => key.endsWith('history.deleteEdition.zh-CN') ? '删除中文版…' : key
    render({ resolveText, onDeletePeriod })
    const row = host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!

    act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    // 第一项是"删除这一期"（删排期），这里点的是删这一语言版的那一条。
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    act(() => { items.at(-1)!.click() })
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

  it('opens the row menu from right-click or the keyboard, and disables it while generating', () => {
    const resolveText = (key: string) => key.endsWith('history.deleteEdition.zh-CN')
      ? '删除中文版…'
      : key.endsWith('history.deleteWholePeriod') ? '删除这一期…'
        : key.endsWith('history.deletePeriodBlocked') ? '生成中不能删除这一期' : key
    render({ resolveText })
    const row = host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!

    act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    // 一期一行之后，菜单先说"这一期"，再问"哪一个语言版"。
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('删除这一期…')
    expect(items[1].textContent).toContain('删除中文版…')

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
    expect(tag?.getAttribute('data-briefing-locale-tag')).toBe('both')

    render({ editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined })] })
    expect(host.querySelectorAll('[data-briefing-locale-tag]')).toHaveLength(0)

    render({ editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: 2 })], resolveText: (key: string) => key })
    expect(host.querySelectorAll('[data-briefing-locale-tag]')).toHaveLength(0)

    render({ editions: [edition()], generatingStage: 'AI 选择' })
    expect(host.querySelectorAll('[data-briefing-locale-tag]')).toHaveLength(1)
  })

  it('shows a gap count as its own segment, and only when there is one', () => {
    // "4 items" beside three dashes is what misleads a reader: the gap count is separate and never
    // merged with the item count.
    render({ editions: [edition()], selectedDate: '2026-11-02', gapCount: 3, resolveText: (key: string) => key })
    const withGaps = host.querySelector('[data-briefing-gap-count]')
    expect(withGaps?.getAttribute('data-briefing-gap-count')).toBe('3')
    expect(host.textContent).toContain(text.history.gapCount.replace('{count}', '3'))

    render({ editions: [edition()], selectedDate: '2026-11-02', gapCount: 0, resolveText: (key: string) => key })
    expect(host.querySelector('[data-briefing-gap-count]')).toBeNull()
  })

  it('describes an emptied issue as not run, never as a failed generation', () => {
    // The reader deleted the editions; the row describes the present, not the history.
    render({ editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: undefined })] })
    expect(host.textContent).toContain(text.history.missingRun)
    expect(host.textContent).not.toContain(text.history.generationFailed)
    expect(host.querySelector('.mi-daily-briefing__rail-row')?.getAttribute('data-state')).toBe('missing')
  })

  it('offers only the languages this issue actually has', () => {
    // A menu that names a language the issue does not have is how "deleted the Chinese edition"
    // happened for an issue with only an English one.
    const onlyEnglish = (key: string) => key.endsWith('history.deleteEdition.en-US') ? '删除英文版…' : key.endsWith('history.deleteEdition.zh-CN') ? '删除中文版…' : key
    render({ editions: [edition({ availableLocales: ['en-US'] })], resolveText: onlyEnglish })
    act(() => { host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    // 整期的动作 + 这一期真的有的语言版（英文一版），不出现中文那条。
    expect(items).toHaveLength(2)
    expect(items[1].textContent).toContain('删除英文版…')
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })

    render({ editions: [edition({ availableLocales: ['zh-CN', 'en-US'] })], resolveText: onlyEnglish })
    act(() => { host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(3)
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

describe('a collapsed day is readable on its own, and only today is 本期', () => {
  it('summarises the latest readable edition, and never marks yesterday as 本期', () => {
    // 折叠行不能只是「共 N 期」加一片空白；而「本期」属于今天——`isCurrent` 是"那一天最晚的一条"，
    // 每天各有一条，直接标就会把本期挂到昨天。
    render({
      editions: [
        edition({ date: '2026-11-04', periodId: 'p1', isCurrent: true, state: 'generated', summaryLine: '昨天的摘要', scheduledTime: '07:00' }),
        edition({ date: '2026-11-03', periodId: 'p2', isCurrent: true, state: 'generated', summaryLine: '前天的摘要', scheduledTime: '07:00' })
      ] as never
    })
    // 折叠行只有三段：时刻 · 语言 · 方向。**标题不进侧栏**（反向断言：拿已知标题去搜，出现即红）。
    const summaries = [...host.querySelectorAll<HTMLElement>('[data-day-summary]')]
    expect(summaries.length).toBeGreaterThan(0)
    const text_ = summaries.map((node) => node.textContent ?? '').join(' ')
    expect(text_).toContain('07:00')
    expect(text_).not.toContain('昨天的摘要')
    expect(text_).not.toContain('前天的摘要')
    expect(host.querySelectorAll('[data-is-current="true"]')).toHaveLength(0)
  })
})
