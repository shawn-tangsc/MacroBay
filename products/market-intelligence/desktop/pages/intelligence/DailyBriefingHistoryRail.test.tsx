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
  it('prints one clock on a normal row, and keeps only the prefix a manual run needs', () => {
    // 正常行由排期生成：计划和实际是同一个值，印两个词只是噪音，还会把 252px 顶爆。
    render({ editions: [edition({ periodTime: '2026-11-02T00:00:00.000Z' })] })
    const first = host.querySelector('.mi-daily-briefing__rail-line')!
    expect(first.textContent).toContain('08:00')
    expect(first.textContent).not.toContain(text.history.timePlanned)
    // 实际完成时刻不在行内（A5.4b 按图改过）：这一行只有一个时刻。
    expect(host.textContent).not.toContain(text.history.timeActual)
    // 手动那期保留「截止」：它说的不是几点，而是"你按下那一刻"。
    render({ editions: [edition({ periodKind: 'manual', periodTime: '2026-11-02T00:00:00.000Z' })] })
    expect(host.querySelector('.mi-daily-briefing__rail-line')?.textContent).toContain(`${text.history.timeCutoff} 08:00`)
    // 项数是正文元数据，两行制之后不进行。
    expect(host.textContent).not.toMatch(/\d+\s*项/)
    expect(host.querySelector('[data-attempts-toggle]')).toBeNull()
  })

  it('says "not run" once, and keeps the direction word for screen readers only', () => {
    render({ editions: [
      edition({ state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: undefined }),
      edition({ date: '2026-11-01', direction: undefined })
    ] })
    const row = host.querySelector<HTMLElement>('.mi-daily-briefing__rail-row')!
    // 来源徽标说「未运行」，第二行说原因——同一件事不在一行里说两遍。
    expect(row.querySelector('[data-run-source]')?.getAttribute('data-run-source')).toBe('not-run')
    expect(row.querySelector('[data-run-source]')?.textContent).toBe(text.history.missingRun)
    expect(row.querySelector('[data-rail-title="reason"]')?.textContent).toBe(text.history.railNotRun)
    // 没有版次就没有语言标签，也不画方向点。
    expect(row.querySelector('[data-edition-locale]')).toBeNull()
    expect(row.querySelector('i[data-direction]')).toBeNull()
    // 没结论的那一行画一个灰点，词只在可读名字里。
    const pastHead = [...host.querySelectorAll<HTMLButtonElement>('.mi-daily-briefing__rail-day-head')]
      .find((head) => head.closest('.mi-daily-briefing__rail-day')?.getAttribute('data-day') === '2026-11-01')!
    act(() => pastHead.click())
    const dot = host.querySelector('[data-date="2026-11-01"] i[data-direction]')
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

    // 两行制：第二行是标题位，失败那行写一句原因（留白会被读成"还在加载"）；项数一律不进行。
    expect(row.querySelector('[data-rail-title="reason"]')).not.toBeNull()
    expect(row.textContent).toContain(text.history.runFailed)
    expect(row.textContent).not.toMatch(/\d+\s*项|\d+\s*缺口/)
  })

  it('prints one badge per row, and clicking a row selects that edition', () => {
    // 一行 = 一期 = 一种语言：徽标是**标签**，不是可切换的开关；点整行才是选择。
    const onSelect = vi.fn()
    const onSelectLocale = vi.fn()
    render({
      editions: [edition({ availableLocales: ['zh-CN', 'en-US'], locale: 'zh-CN' })],
      selectedDate: '2026-11-02', onSelect, onSelectLocale
    })
    const chips = [...host.querySelectorAll<HTMLElement>('[data-edition-locale]')]
    expect(chips.map((chip) => chip.getAttribute('data-edition-locale'))).toEqual(['zh-CN'])
    expect(chips[0]?.tagName).toBe('SPAN')
    expect(chips[0]?.getAttribute('aria-pressed')).toBeNull()
    act(() => { host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 一行就是一版：选的是(日期, 期号, 语言)，不是「这一天」——只给日期，同期中英两行会开同一份。
    expect(onSelectLocale).toHaveBeenCalledWith({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' })
    expect(onSelect).not.toHaveBeenCalled()
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

  it('prints no reading count when the row carries none, instead of a fabricated zero', () => {
    // "0 项" was shown for editions whose count the list does not carry: unknown is not zero.
    render({ editions: [{ ...edition(), readingsAvailable: undefined }] })
    expect(host.textContent).not.toContain('0 项')
    // A real zero says nothing either: it is not a fact worth a column.
    render({ editions: [{ ...edition(), readingsAvailable: 0 }] })
    expect(host.textContent).not.toContain('0 项')
    expect(host.querySelectorAll('.mi-daily-briefing__rail-row')).toHaveLength(1)
  })

  it('marks the language on the row itself, and only where an edition exists', () => {
    render({ editions: [edition()] })
    expect(host.querySelector('[data-edition-locale]')?.getAttribute('data-edition-locale')).toBe('zh-CN')
    render({ editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined })] })
    expect(host.querySelectorAll('[data-edition-locale]')).toHaveLength(0)
  })

  it('keeps readings and gaps off the row entirely', () => {
    // 项数与缺口是正文派生量：读者扫列表时找的是"哪一份、讲什么"，这两样点开在正文区看。
    render({ editions: [edition({ readingsAvailable: 4 })], selectedDate: '2026-11-02' })
    expect(host.querySelector('[data-briefing-gap-count]')).toBeNull()
    expect(host.textContent).not.toMatch(/\d+\s*项/)
    expect(host.textContent).not.toMatch(/\d+\s*缺口/)
  })

  it('describes an emptied issue as not run, never as a failed generation', () => {
    // The reader deleted the editions; the row describes the present, not the history.
    render({ editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: undefined })] })
    expect(host.textContent).toContain(text.history.missingRun)
    expect(host.textContent).not.toContain(text.history.generationFailed)
    expect(host.querySelector('.mi-daily-briefing__rail-row')?.getAttribute('data-state')).toBe('missing')
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

  it('keeps a partial issue a data state, not a chip on the row', () => {
    render({ editions: [edition({ state: 'partial' })] })
    expect(host.querySelector('.mi-daily-briefing__rail-row')?.getAttribute('data-state')).toBe('partial')
    expect(host.querySelector('.status-pill')).toBeNull()
  })
})

describe('a collapsed day carries only day-level facts', () => {
  it('shows the day, its count and the caret — never a period\'s clock or language', () => {
    // 折叠行代表的是"那一天"，时刻与语言是**期级**属性：挂在"这一天"上就是维度错误。
    render({
      editions: [
        edition({ date: '2026-11-04', periodId: 'p1', state: 'generated', scheduledTime: '07:00' }),
        edition({ date: '2026-11-03', periodId: 'p2', state: 'generated', scheduledTime: '07:00' })
      ] as never
    })
    expect(host.querySelectorAll('[data-day-summary]')).toHaveLength(0)
    expect(host.textContent).not.toContain('07:00 · 中文')
    // 天头三要素仍在：日期、共 N 期、箭头。
    expect(host.querySelectorAll('[data-day-count]').length).toBeGreaterThan(0)
    expect(host.querySelectorAll('[data-day-caret="closed"]').length).toBeGreaterThan(0)
  })
})

describe('a row is two lines: the facts, then what it says', () => {
  it('prints exactly one source badge, out of the five, and never 本期', () => {
    // 第一行最右那一格"这一份怎么来的"：五个值，恰一枚；「本期」这个词不进侧栏。
    const kinds = [
      { edition: edition(), expected: 'scheduled' },
      { edition: edition({ periodKind: 'manual' }), expected: 'manual' },
      { edition: edition({ runTrigger: 'catch-up' }), expected: 'catch-up' },
      { edition: edition({ state: 'missing', availableLocales: [], generatedAt: undefined }), expected: 'not-run' },
      { edition: edition({ state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: 2 }), expected: 'failed' }
    ] as const
    for (const { edition: row, expected } of kinds) {
      render({ editions: [row], selectedDate: '2026-11-02' })
      const badges = [...host.querySelectorAll<HTMLElement>('[data-run-source]')]
      expect(badges, expected).toHaveLength(1)
      expect(badges[0].getAttribute('data-run-source')).toBe(expected)
      expect(host.textContent).not.toContain(text.history.currentPeriod)
    }
  })

  it('puts the title on line two, and a deleted period keeps its mark there', () => {
    render({ editions: [edition({ summaryLine: '一条足够长的标题，用来确认它落在第二行' })] })
    const title = host.querySelector('[data-rail-title="summary"]')
    expect(title?.textContent).toContain('一条足够长的标题')
    expect(title?.getAttribute('title')).toContain('一条足够长的标题')
    // 已删除的期仍然说得出"排期没了、版次还在"：标记进第二行标题前，不占第一行的格。
    render({ editions: [edition({ periodDeleted: true, summaryLine: '删掉排期之后仍然能读的正文' })] })
    expect(host.querySelector('[data-rail-title="summary"]')?.textContent)
      .toBe(`${text.history.deletedPeriod} · 删掉排期之后仍然能读的正文`)
  })

  it('runs the period again from the failed row, without opening it first', () => {
    const onRegeneratePeriod = vi.fn()
    render({
      editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: 2 })],
      onRegeneratePeriod
    })
    const retry = host.querySelector<HTMLButtonElement>('[data-rail-retry]')!
    expect(retry.textContent).toBe(text.history.retryOne)
    act(() => { retry.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onRegeneratePeriod).toHaveBeenCalledWith({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' })
  })

  it('shows the waiting row with the spinner in the title slot, and it does not open', () => {
    const onSelectLocale = vi.fn()
    render({
      editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined })],
      generatingStage: 'AI 选择', onSelectLocale
    })
    const row = host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!
    expect(row.getAttribute('aria-busy')).toBe('true')
    const waiting = row.querySelector('[data-rail-title="running"]')!
    expect(waiting.textContent).toContain(text.generationProgress.railRunning)
    expect(waiting.querySelector('.loading-spinner, [class*="spinner"], svg')).not.toBeNull()
    act(() => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onSelectLocale).not.toHaveBeenCalled()
  })

})
