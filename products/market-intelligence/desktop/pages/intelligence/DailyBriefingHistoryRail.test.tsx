// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigProvider } from 'antd'
import { ConfirmProvider } from '@platform/ui/components/confirm'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'

import type { DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
import { resolveProductTextKey } from '../../shared/i18n/productTextKey'
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
    // 语言标签照标（这一行属于哪种语言），但没有版次就不画方向点。
    // 用户 2026-11-06：失败/没跑的那一行也要能看出是哪一种语言，否则英文那版失败看着像中文版。
    expect(row.querySelector('[data-edition-locale]')?.getAttribute('data-edition-locale')).toBe('zh-CN')
    expect(row.querySelector('i[data-direction]')).toBeNull()
    // 没结论的那一行画一个灰点，词只在可读名字里。默认只展开今天，先点开那一天。
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
    // 默认只开今天：今天那一行带自己这一版的标签，其余天先只有天头（`共 N 期`）。
    const chips = (): string[] => [...host.querySelectorAll<HTMLElement>('[data-edition-locale]')].map((chip) => chip.getAttribute('data-edition-locale') ?? '')
    expect(chips()).toEqual(['zh-CN'])
    // 逐个展开，每一天的那一行各带上自己这一版的标签。
    for (const date of ['2026-10-29', '2026-10-28', '2026-10-27']) {
      const head = [...host.querySelectorAll<HTMLButtonElement>('.mi-daily-briefing__rail-day-head')]
        .find((node) => node.closest('.mi-daily-briefing__rail-day')?.getAttribute('data-day') === date)!
      act(() => head.click())
    }
    // 没有版次的那一行也带自己的语言标签：一行就是"一期 + 一种语言"。
    expect(chips()).toHaveLength(4)
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
    const resolveText = (key: string) => key.endsWith('history.deleteEditionCurrent') ? '删除这一版…' : key
    render({ resolveText, onDeletePeriod })
    // 版次级菜单挂在语言徽标上，恰一项：它删的是这一版正文，不是这一期的排期。
    const chip = host.querySelector<HTMLElement>('[data-edition-locale]')!
    act(() => { chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items).toHaveLength(1)
    act(() => { items[0]!.click() })
    for (let round = 0; round < 6; round += 1) await flush()

    // 删除是一个不可撤销的动作：先弹共用确认框，点「删除这一版」才真的调宿主。
    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.replace(/\s/g, '') === text.history.deleteEditionConfirm)!
    expect(confirmButton).not.toBeUndefined()
    // 确认框点名的是哪一版：日期 · 时刻 · 语言（A9.6 v2.35）。
    expect(document.body.textContent).toContain('2026-11-02')
    expect(onDeletePeriod).not.toHaveBeenCalled()
    act(() => { confirmButton.click() })
    await flush()
    expect(onDeletePeriod).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' }))
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

  it('marks the language on every row, including a row that has no edition yet', () => {
    render({ editions: [edition()] })
    expect(host.querySelector('[data-edition-locale]')?.getAttribute('data-edition-locale')).toBe('zh-CN')
    // 失败或还在跑的那一行同样有语言：读者要能看出"这次跑的是哪一种语言"。
    render({ editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined })] })
    expect(host.querySelectorAll('[data-edition-locale]')).toHaveLength(1)
    expect(host.querySelector('[data-edition-locale]')?.getAttribute('data-edition-locale')).toBe('zh-CN')
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

  it('offers no edition menu on a row that has no edition to delete', () => {
    // 语言徽标照标（它说的是这一行属于哪种语言，不是"有版次"），但版次级菜单不许出现——
    // 不给读者一个"没有可删的版本"的空项。
    const onDeletePeriod = vi.fn()
    render({ editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined })], onDeletePeriod })
    const row = host.querySelector<HTMLElement>('.mi-daily-briefing__rail-row')!
    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 1, clientY: 1 }))
    })
    expect(document.querySelector('[data-delete-period]')).toBeNull()
    expect(onDeletePeriod).not.toHaveBeenCalled()
  })

  it('keeps a partial issue a data state, not a chip on the row', () => {
    render({ editions: [edition({ state: 'partial' })] })
    expect(host.querySelector('.mi-daily-briefing__rail-row')?.getAttribute('data-state')).toBe('partial')
    expect(host.querySelector('.status-pill')).toBeNull()
  })
})

describe('a collapsed day carries only day-level facts', () => {
  it('opens today and folds every other day by default, and remembers what the reader chose', () => {
    // A5.3：默认今天 ▾、其余 ▸。这条以前**没有任何用例**，所以改成"全展开"时没人红。
    render({
      editions: [
        edition({ date: '2026-11-02', periodId: 'p1' }),
        edition({ date: '2026-11-01', periodId: 'p2' }),
        edition({ date: '2026-10-31', periodId: 'p3' })
      ] as never
    })
    const heads = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.mi-daily-briefing__rail-day-head')]
    const expanded = (): string[] => heads().filter((head) => head.getAttribute('aria-expanded') === 'true')
      .map((head) => head.closest('.mi-daily-briefing__rail-day')?.getAttribute('data-day') ?? '')
    expect(expanded()).toEqual(['2026-11-02'])
    // 展开的那天，行数 = 它天头写的期数。
    const todayHead = heads().find((head) => head.closest('.mi-daily-briefing__rail-day')?.getAttribute('data-day') === '2026-11-02')!
    expect(todayHead.textContent).toContain(text.history.periodCount.replace('{count}', '1'))
    expect(host.querySelectorAll('[data-day="2026-11-02"] .mi-daily-briefing__rail-row')).toHaveLength(1)
    // 读者自己开一天、折今天：两样都记住。
    act(() => { heads().find((head) => head.closest('.mi-daily-briefing__rail-day')?.getAttribute('data-day') === '2026-11-01')!.click() })
    act(() => { heads().find((head) => head.closest('.mi-daily-briefing__rail-day')?.getAttribute('data-day') === '2026-11-02')!.click() })
    expect(expanded()).toEqual(['2026-11-01'])
  })

  it('shows the day, its count and the caret — never a period\'s clock or language', () => {
    // 折叠行代表的是"那一天"，时刻与语言是**期级**属性：挂在"这一天"上就是维度错误。
    render({
      editions: [
        edition({ date: '2026-11-04', periodId: 'p1', state: 'generated', scheduledTime: '07:00' }),
        edition({ date: '2026-11-03', periodId: 'p2', state: 'generated', scheduledTime: '07:00' })
      ] as never
    })
    // 默认只展开今天（`A5.3`），这两天是折叠的；折叠行代表"那一天"，所以不带时刻与语言。
    act(() => { host.querySelectorAll<HTMLElement>('.mi-daily-briefing__rail-day-head')[0]!.click() })
    expect(host.querySelectorAll('[data-day-summary]')).toHaveLength(0)
    expect(host.textContent).not.toContain('07:00 · 中文')
    // 天头三要素仍在：日期、共 N 期、箭头。
    expect(host.querySelectorAll('[data-day-count]').length).toBeGreaterThan(0)
    expect(host.querySelectorAll('[data-day-caret="closed"]').length).toBeGreaterThan(0)
  })
})

describe('a row is never a button inside a button', () => {
  it('keeps 重试 outside the row button, and the row holds no nested control', () => {
    // `<button>` 里套 `<button>` 是无效标记：键盘用户在无障碍树里会遇到一行两个按钮，回车到底
    // 触发"选中这一版"还是"重试"说不清。这一条断言就是那条说明的守卫。
    render({
      editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: 2 })],
      onRegeneratePeriod: vi.fn()
    })
    const row = host.querySelector<HTMLElement>('.mi-daily-briefing__rail-row')!
    expect(row.querySelectorAll('button')).toHaveLength(0)
    const item = row.closest('.mi-daily-briefing__rail-item')!
    expect(item.querySelector('[data-rail-retry]')).not.toBeNull()
    expect(item.querySelector('[data-rail-retry]')?.closest('.mi-daily-briefing__rail-row')).toBeNull()
  })

  it('keeps the row free of a ⋯, and the right-click opens exactly one edition action', () => {
    // 02 v2.40：行尾不出现 ⋯；入口是右键 + 正文顶部工具栏第五颗，两者共用同一确认框。
    // 真文案解析：键不存在时菜单项会渲染成空标签，stub 会把这个病伪装成通过。
    render({ resolveText: (key: string) => resolveProductTextKey('zh-CN', key) })
    expect(host.querySelector('[data-rail-menu]')).toBeNull()
    expect(host.textContent).not.toContain('⋯')
    act(() => { host.querySelector<HTMLElement>('.mi-daily-briefing__rail-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items).toHaveLength(1)
    expect(items[0]!.textContent).toBe(text.history.deleteEditionCurrent)
  })

  it('renders no menu at all for a row with no edition, instead of an empty floating panel', () => {
    // 空白浮层盖住列表，读者看到的是"右键出来什么都没有"。0 项时连 open 都不许成立。
    render({ editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined })] })
    act(() => { host.querySelector<HTMLElement>('.mi-daily-briefing__rail-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    expect(document.querySelector('[data-context-menu]')).toBeNull()
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(0)
  })

  it('offers one disabled reason on a generating row, never a blank panel', () => {
    render({
      // 在跑 = **这一行自己**带着 generating 语言状态（rail 不再回退抓别的行）。
      editions: [edition({ state: 'missing', availableLocales: ['zh-CN'], generatedAt: undefined, languages: [{ locale: 'zh-CN', state: 'generating' }] })],
      generatingStage: '正在生成…',
      resolveText: (key: string) => resolveProductTextKey('zh-CN', key)
    })
    act(() => { host.querySelector<HTMLElement>('.mi-daily-briefing__rail-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items).toHaveLength(1)
    expect(items[0]!.getAttribute('aria-disabled')).toBe('true')
    expect(items[0]!.textContent).toContain(text.history.deletePeriodBlocked)
  })

  it('does not block a finished row while another issue of the same day is generating', () => {
    // 旧行为：今天只要有一期在跑，今天每一行右键都弹"生成中不能删除这一期"——读者看完的那一版
    // 连删都点不了。拦的应该是**右键的那一行自己**在不在跑。
    render({
      editions: [
        edition({ periodId: 'default', languages: [{ locale: 'zh-CN', state: 'published' }] }),
        edition({ periodId: 'period_b', languages: [{ locale: 'zh-CN', state: 'generating' }] })
      ],
      resolveText: (key: string) => resolveProductTextKey('zh-CN', key)
    })
    const finished = host.querySelector<HTMLElement>('.mi-daily-briefing__rail-row[data-period-id="default"]')!
    act(() => { finished.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items).toHaveLength(1)
    expect(items[0]!.getAttribute('aria-disabled')).not.toBe('true')
    expect(items[0]!.textContent).toContain(text.history.deleteEditionCurrent)

    // 右键**正在跑**的那一行，仍然给禁用理由，不许变成"能删"。
    const running = host.querySelector<HTMLElement>('.mi-daily-briefing__rail-row[data-period-id="period_b"]')!
    act(() => { running.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const blockedItems = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(blockedItems[0]!.getAttribute('aria-disabled')).toBe('true')
    expect(blockedItems[0]!.textContent).toContain(text.history.deletePeriodBlocked)
  })

  it('right-clicking the English row deletes the English edition, not the Chinese one', () => {
    // 同一天一期两种语言是两行，身份是 `(日期, 期号, 语言)`。行身份少了语言，右键英文那行会找到
    // 中文那行：删除删到另一版上、界面却说不清，读者只会反复点。这条用例就是那个根因的守卫。
    const onDeletePeriod = vi.fn()
    render({
      editions: [
        edition({ locale: 'zh-CN', periodTime: '2026-11-02T00:00:00.000Z', summaryLine: '中文那一版的标题' }),
        edition({ locale: 'en-US', availableLocales: ['en-US'], periodTime: '2026-11-02T00:00:00.000Z', summaryLine: 'The English edition' })
      ],
      onDeletePeriod
    })
    expect(host.querySelectorAll('.mi-daily-briefing__rail-row')).toHaveLength(2)
    expect(host.querySelector('[data-edition-locale="en-US"]')).not.toBeNull()
    const englishRow = [...host.querySelectorAll<HTMLElement>('.mi-daily-briefing__rail-row')]
      .find((row) => row.querySelector('[data-edition-locale="en-US"]') !== null)!
    act(() => { englishRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const item = document.querySelector<HTMLElement>('[role="menuitem"]')!
    act(() => { item.click() })
    // 确认框点名的是这一行：日期 · 时刻 · 语言。
    expect(document.body.textContent).toContain(text.history.deleteEditionTitle.replace('{target}', '2026-11-02 · 08:00 · 英文版'))
    const confirmButton = [...document.querySelectorAll<HTMLElement>('button')]
      .find((button) => button.textContent?.trim() === text.history.deleteEditionConfirm)!
    act(() => { confirmButton.click() })
    expect(onDeletePeriod).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-11-02', periodId: 'default', locale: 'en-US' }))
  })
})

describe('the second line is never blank', () => {
  it('names the missing summary instead of leaving the row empty', () => {
    // 今天那一行曾经整条空着（列表行读不到 summaryLine），读者会以为"这一版没内容"。空着的行
    // 和"还在加载"长得一样，所以没有摘要时明说没有。
    render({ editions: [edition({ summaryLine: undefined })] })
    const title = host.querySelector('[data-rail-title="summary"]')!
    expect(title.textContent).toBe(text.history.railNoTitle)
    expect(title.textContent?.trim()).not.toBe('')
  })

  it('gives every kind of row a non-empty second line', () => {
    // 五种来源 + 生成中 + 已删除的期：第二行都必须有字。判据只认"渲染出来的第二行非空"。
    const rows = [
      edition({ summaryLine: '有标题的那一版' }),
      edition({ summaryLine: undefined }),
      edition({ state: 'missing', availableLocales: [], generatedAt: undefined }),
      edition({ state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: 2 }),
      edition({ state: 'missing', availableLocales: [], generatedAt: undefined, languages: [{ locale: 'zh-CN', state: 'missing', reason: 'run-interrupted' }] }),
      edition({ periodDeleted: true, summaryLine: '删排期之后仍在的那一版' })
    ]
    for (const row of rows) {
      render({ editions: [row], onRegeneratePeriod: vi.fn() })
      const title = host.querySelector('.mi-daily-briefing__rail-row-title')
      expect(title?.textContent?.trim(), row.summaryLine ?? row.state).not.toBe('')
    }
  })

  it('puts a deleted period chip at the head of the second line', () => {
    // `02` v2.77：第一行放不下（中文最坏 250/252、英文约 376，行是 nowrap+hidden，先被裁的就是它），
    // 所以标记挪到**第二行开头**：单行省略时裁的是标题尾巴，标记永远可见。
    render({ editions: [edition({ periodDeleted: true, summaryLine: '删掉排期之后仍然能读的正文' })] })
    const tag = host.querySelector('[data-rail-title="summary"] [data-period-deleted-tag="true"]')
    expect(tag?.textContent).toBe(text.history.deletedPeriod)
    // 第一行不出现这五个字。
    expect(host.querySelector('.mi-daily-briefing__rail-line')?.textContent).not.toContain(text.history.deletedPeriod)
  })
})

describe('a day with nothing to show keeps its head and offers one fallback item', () => {
  it('draws the head with 共 0 期 and exactly one fallback row, which opens the empty state', () => {
    // 用户拍板（`02` v2.86）：天头永远在，0 条写「共 0 期」；展开后给**一个**兜底项，
    // 它不是版次行（无时刻/窗口/方向/来源/语言），点它才把右侧切到空态。
    const onSelect = vi.fn()
    render({ editions: [], dates: ['2026-10-31'], todayDate: '2026-10-31', selectedDate: undefined, onSelect })
    const head = (): HTMLElement => host.querySelector<HTMLElement>('.mi-daily-briefing__rail-day-head')!
    expect(head()).not.toBeNull()
    expect(head().getAttribute('aria-expanded')).toBe('true')
    expect(head().querySelector('[data-day-count]')?.textContent).toBe(text.history.periodCount.replace('{count}', '0'))
    const fallback = [...host.querySelectorAll<HTMLElement>('[data-rail-fallback="true"]')]
    expect(fallback).toHaveLength(1)
    // 单行 + `›`：文字是那句完整的话，箭头是装饰（aria-hidden）。
    expect(fallback[0]!.querySelector('.mi-daily-briefing__rail-fallback-text')?.textContent).toBe(text.history.dayEmpty)
    expect(fallback[0]!.querySelector('[data-rail-fallback-caret="true"]')).not.toBeNull()
    // 不是版次行：没有这些行内事实。
    expect(fallback[0]!.querySelector('[data-run-source]')).toBeNull()
    expect(fallback[0]!.querySelector('[data-window-hours]')).toBeNull()
    expect(fallback[0]!.querySelector('[data-edition-locale]')).toBeNull()
    expect(fallback[0]!.querySelector('[data-direction]')).toBeNull()
    act(() => { fallback[0]!.click() })
    expect(onSelect).toHaveBeenCalledWith('2026-10-31')
  })

  it('offers no fallback item once the day has a real row', () => {
    render({ editions: [edition({ date: '2026-10-31' })], dates: ['2026-10-31'] })
    expect(host.querySelector('[data-rail-fallback="true"]')).toBeNull()
  })
})

describe('the day head opens the latest edition of that day', () => {
  it('picks the row with the latest nominal cutoff, and marks only that row', () => {
    // 同一天两期：点日期打开 `periodTime` 最晚的那一版（与列表排序同一口径 `A5.1`），
    // 选中态落在那一行；再点一次是收起，不改变右边在看哪一版。
    const onSelectLocale = vi.fn()
    render({
      editions: [
        edition({ date: '2026-10-31', periodId: 'p_early', periodTime: '2026-10-31T00:00:00.000Z', summaryLine: '早的那期' }),
        edition({ date: '2026-10-31', periodId: 'p_late', periodTime: '2026-10-31T05:00:00.000Z', summaryLine: '晚的那期' })
      ],
      onSelectLocale
    })
    const head = (): HTMLElement => [...host.querySelectorAll<HTMLElement>('.mi-daily-briefing__rail-day-head')]
      .find((node) => node.closest('[data-day]')?.getAttribute('data-day') === '2026-10-31')!
    act(() => { head().click() })  // 先收起
    act(() => { head().click() })  // 再展开 → 应打开最晚那版
    expect(onSelectLocale).toHaveBeenLastCalledWith({ date: '2026-10-31', periodId: 'p_late', locale: 'zh-CN' })
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
    // 已删除的期：标记是第二行开头的 chip，后面接这一版的标题，两者不混。
    render({ editions: [edition({ periodDeleted: true, summaryLine: '删掉排期之后仍然能读的正文' })] })
    const deletedLine = host.querySelector('[data-rail-title="summary"]')!
    expect(deletedLine.querySelector('[data-period-deleted-tag="true"]')?.textContent).toBe(text.history.deletedPeriod)
    expect(deletedLine.textContent).toContain('删掉排期之后仍然能读的正文')
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

  // 用户报的那条：中断行写着「可以再试一次」，行上却没有那颗按钮。
  it('puts the retry on an interrupted row of today, next to the sentence that promises it', () => {
    const onRegeneratePeriod = vi.fn()
    render({
      editions: [edition({
        state: 'missing', availableLocales: [], generatedAt: undefined,
        languages: [{ locale: 'zh-CN', state: 'missing', reason: 'run-interrupted' }]
      })],
      onRegeneratePeriod
    })
    const item = host.querySelector<HTMLElement>('[data-period-id="default"]')!.closest('.mi-daily-briefing__rail-item') as HTMLElement
    expect(item.querySelector('[data-rail-title="reason"]')?.textContent).toBe(text.history.runInterrupted)
    const retry = item.querySelector<HTMLButtonElement>('[data-rail-retry]')!
    // 文案承诺了"可以再试一次"，那颗按钮就必须在，而且用这一行自己的三样身份。
    expect(retry.textContent).toBe(text.history.retryOne)
    act(() => { retry.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onRegeneratePeriod).toHaveBeenCalledWith({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' })
  })

  it('withholds the retry from a past interrupted day and from a row that is running now', () => {
    // 历史日不支持补生成：那句"可以再试一次"只对今天成立，按钮不能跟着过去。
    render({
      editions: [edition({
        date: '2026-11-01', state: 'missing', availableLocales: [], generatedAt: undefined,
        languages: [{ locale: 'zh-CN', state: 'missing', reason: 'run-interrupted' }]
      })],
      onRegeneratePeriod: vi.fn()
    })
    expect(host.querySelector('[data-rail-retry]')).toBeNull()
    // 正在跑的那一行也不给：它已经在做了，再给一颗重试就是两个入口改同一件事。
    render({
      editions: [edition({
        state: 'missing', availableLocales: ['zh-CN'], generatedAt: undefined,
        languages: [{ locale: 'zh-CN', state: 'generating' }]
      })],
      generatingStage: 'AI 选择',
      onRegeneratePeriod: vi.fn()
    })
    expect(host.querySelector('[data-rail-retry]')).toBeNull()
  })

  // 用户问的那一句：生成中的行不能只有一个「生成中」，得说清卡在哪、跑了多久。
  it('tells the running row its stage and how long it has been going', () => {
    render({
      editions: [edition({ state: 'missing', availableLocales: ['zh-CN'], generatedAt: undefined, languages: [{ locale: 'zh-CN', state: 'generating' }] })],
      generatingStage: 'AI 选择', generatingElapsedMs: 41_000
    })
    const waiting = host.querySelector('[data-rail-title="running"]')!
    // 阶段 + 时长，一个整句；阶段名来自现有 stage 文案，时长走同一套格式化。
    expect(waiting.textContent).toBe('AI 选择 · 已 41 秒')
  })

  it('says only "generating" when the progress cannot answer, and invents neither stage nor seconds', () => {
    render({
      editions: [edition({ state: 'missing', availableLocales: ['zh-CN'], generatedAt: undefined, languages: [{ locale: 'zh-CN', state: 'generating' }] })],
      generatingStage: 'AI 选择'
    })
    const waiting = host.querySelector('[data-rail-title="running"]')!
    expect(waiting.textContent).toBe(text.generationProgress.railRunning)
    // 拿不到进度时不许出现任何时长：编一个数字比不说更糟。
    expect(waiting.textContent).not.toMatch(/\d/)
  })

  // 用户报的那条：右��是失败面板，左边列表却把那一行显示成「打开看正文」。
  // 失败的行必须说「这次没生成出来」，并给重试入口——它不是"没有内容"。
  it('shows a failed run as a failure with a retry, not as a row with nothing to read', () => {
    const onRegeneratePeriod = vi.fn()
    render({
      editions: [edition({
        state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: 1,
        languages: [{ locale: 'zh-CN', state: 'missing', reason: 'run-failed' }]
      })],
      onRegeneratePeriod
    })
    const row = host.querySelector<HTMLElement>('.mi-daily-briefing__rail-row')!
    expect(row.querySelector('[data-run-source]')?.getAttribute('data-run-source')).toBe('failed')
    expect(row.querySelector('[data-rail-title="reason"]')?.textContent).toBe(text.history.railFailedReason)
    expect(row.textContent).not.toContain(text.history.railNoTitle)
    expect(host.querySelector('[data-rail-retry]')).not.toBeNull()
  })

  // 用户 2026-11-06 举着截图问「这个 07:00 未运行是啥意思」：那一行其实是 18:11 一次**英文手动期**
  // 失败，界面语言是中文，于是按中文数 attempt 是 0，被判成「未运行」，第二行却又写着「这次没生成出来」。
  // 同一行里这两句不能同时成立：跑过并失败就是失败。
  it('calls a row failed when its run failed, even if the shown language has no attempt of its own', () => {
    render({
      editions: [edition({
        state: 'missing', availableLocales: [], generatedAt: undefined,
        languages: [{ locale: 'en-US', state: 'missing', reason: 'run-failed' }]
      })]
    })
    const row = host.querySelector<HTMLElement>('.mi-daily-briefing__rail-row')!
    expect(row.querySelector('[data-run-source]')?.getAttribute('data-run-source')).toBe('failed')
    expect(row.textContent).toContain(text.history.runFailed)
    expect(row.textContent).not.toContain(text.history.missingRun)
    expect(row.querySelector('[data-rail-title="reason"]')?.textContent).toBe(text.history.railFailedReason)
  })

  it('keeps a row that never ran saying so, with no "this time it did not come out"', () => {
    // 从没跑过的那一行（有排期、没触发、没记录）：只说没跑过，带上它自己的计划时刻。
    render({
      editions: [edition({
        state: 'missing', availableLocales: [], generatedAt: undefined,
        scheduledTime: '07:00',
        languages: [{ locale: 'zh-CN', state: 'missing', reason: 'not-published' }]
      })]
    })
    const row = host.querySelector<HTMLElement>('.mi-daily-briefing__rail-row')!
    expect(row.querySelector('[data-run-source]')?.getAttribute('data-run-source')).toBe('not-run')
    expect(row.textContent).toContain(text.history.missingRun)
    expect(row.textContent).toContain('07:00')
    expect(row.querySelector('[data-rail-title="reason"]')?.textContent).toBe(text.history.railNotRun)
    expect(row.textContent).not.toContain(text.history.railFailedReason)
  })

  // #9：行内「重试」以前只交期号与语言，手动期没有期配置可依据，重跑会落回排期时刻。
  it('retries a failed manual issue with its own cutoff and window', () => {
    const onRegeneratePeriod = vi.fn()
    render({
      editions: [edition({ state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: 1,
        periodKind: 'manual', periodTime: '2026-11-02T00:00:00.000Z', windowHours: 12 })],
      onRegeneratePeriod
    })
    const retry = host.querySelector<HTMLButtonElement>('[data-rail-retry]')!
    retry.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onRegeneratePeriod).toHaveBeenCalledWith({
      date: '2026-11-02',
      periodId: 'default',
      locale: 'zh-CN',
      generation: { asOf: '2026-11-02T00:00:00.000Z', windowHours: 12 }
    })
  })

  // 用户报的那条：生成中的行点了没反应。现在它可点，点它打开**这一期**的生成界面。
  it('opens the running issue when its row is clicked, instead of swallowing the click', () => {
    const onSelectLocale = vi.fn()
    render({
      editions: [edition({ state: 'missing', availableLocales: ['zh-CN'], generatedAt: undefined, languages: [{ locale: 'zh-CN', state: 'generating' }] })],
      generatingStage: 'AI 选择', onSelectLocale
    })
    const row = host.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row')!
    expect(row.getAttribute('aria-busy')).toBe('true')
    // 不再是"禁用"：那一行讲的是正在发生的运行，读者有权打开它。
    expect(row.getAttribute('aria-disabled')).toBeNull()
    const waiting = row.querySelector('[data-rail-title="running"]')!
    expect(waiting.textContent).toContain(text.generationProgress.railRunning)
    expect(waiting.querySelector('.loading-spinner, [class*="spinner"], svg')).not.toBeNull()

    act(() => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 点的收获必须是**这一行自己的**三样身份，而不是"当前选中那一期"。
    expect(onSelectLocale).toHaveBeenCalledWith({ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' })
  })

})

describe('a run that died is not the same sentence as a run that failed', () => {
  it('renders 上次没跑完 for a crash leftover and 这次失败 for a real failure, never both', () => {
    // `A9.11`：两种都是 `missing`，但读者要做的事不同——一个还能再试（上次没跑完），
    // 一个这次就没成。文案键是两条，这里断言的是**渲染出来**的那一句，不是键存在。
    const interrupted = edition({ periodId: 'p_int', state: 'missing', availableLocales: [], generatedAt: undefined, languages: [{ locale: 'zh-CN', state: 'missing', reason: 'run-interrupted' }] })
    const failed = edition({ periodId: 'p_fail', state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: 2, languages: [{ locale: 'zh-CN', state: 'missing', reason: 'run-failed' }] })
    render({ editions: [interrupted, failed] })
    const row = (periodId: string): HTMLElement => host.querySelector<HTMLElement>(`[data-period-id="${periodId}"]`)!
    expect(row('p_int').textContent).toContain(text.history.runInterrupted)
    expect(row('p_int').textContent).not.toContain(text.history.runFailed)
    expect(row('p_fail').textContent).toContain(text.history.runFailed)
    expect(row('p_fail').textContent).not.toContain(text.history.runInterrupted)
  })

  it('says the same two things in English, each on its own row', () => {
    const english = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing
    const interrupted = edition({ periodId: 'p_int', state: 'missing', availableLocales: [], generatedAt: undefined, languages: [{ locale: 'zh-CN', state: 'missing', reason: 'run-interrupted' }] })
    const failed = edition({ periodId: 'p_fail', state: 'missing', availableLocales: [], generatedAt: undefined, attemptCount: 2, languages: [{ locale: 'zh-CN', state: 'missing', reason: 'run-failed' }] })
    render({ editions: [interrupted, failed], text: english as never })
    const row = (periodId: string): HTMLElement => host.querySelector<HTMLElement>(`[data-period-id="${periodId}"]`)!
    expect(row('p_int').textContent).toContain(english.history.runInterrupted)
    expect(row('p_fail').textContent).toContain(english.history.runFailed)
    expect(row('p_int').textContent).not.toContain(english.history.runFailed)
    expect(row('p_fail').textContent).not.toContain(english.history.runInterrupted)
  })
})

describe('“running” is only the row that says so (2026-11-06)', () => {
  const running = (date: string, periodId: string, cutoff: string) => edition({
    date, periodId, state: 'missing', availableLocales: ['zh-CN'], generatedAt: undefined,
    languages: [{ locale: 'zh-CN', state: 'generating' }], periodTime: cutoff
  })

  // 用户报的：他跑的是 08:00 那一期，列表却把 07:00 那行画成「生成中」。
  it('marks only the row that is actually running', () => {
    render({
      editions: [
        running('2026-11-02', 'p-0800', '2026-11-02T00:00:00.000Z'),
        edition({ date: '2026-11-02', periodId: 'default', state: 'missing', availableLocales: [], generatedAt: undefined, periodTime: '2026-11-01T23:00:00.000Z' })
      ],
      generatingStage: 'AI 选择'
    })
    const rows = [...host.querySelectorAll<HTMLElement>('.mi-daily-briefing__rail-row')]
    const marked = rows.filter((row) => row.querySelector('[data-rail-title="running"]') !== null)
    expect(marked).toHaveLength(1)
    // 在跑的是 08:00 那行；07:00 那行不许跟着显示"生成中"。
    expect(marked[0]!.getAttribute('data-period-id')).toBe('p-0800')
    const sevenOClock = rows.find((row) => row.getAttribute('data-period-id') === 'default')!
    expect(sevenOClock.querySelector('[data-rail-title="running"]')).toBeNull()
  })

  it('leaves every row alone when nothing is running', () => {
    // 没有行标 generating：即使外面还传着阶段文案，也不许挑一行出来假装在跑。
    render({
      editions: [edition({ date: '2026-11-02', periodId: 'default', state: 'missing', availableLocales: [], generatedAt: undefined })],
      generatingStage: 'AI 选择'
    })
    expect(host.querySelector('[data-rail-title="running"]')).toBeNull()
  })
})
