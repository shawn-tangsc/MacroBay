// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { CapitalConditionsPanel } from './CapitalConditionsPanel'
import type { FlowChartRow } from './capitalFlowRows'

const zhText = productText['zh-CN'].pages.intelligence.portal.dashboard.capitalConditions

const row = (tradingDate: string, funds: number, btc = 0, eth = 0): FlowChartRow => ({ tradingDate, funds, btc, eth })

/** The largest inflow is the last day here, so two roles share one label. */
const overlappingRows: FlowChartRow[] = [
  row('10-26', 312_000_000, 204_000_000, 96_000_000),
  row('2026-10-27', -176_000_000, -132_000_000, -60_000_000),
  row('2026-10-28', 402_600_000, 297_000_000, 176_000_000)
]

const plainRows: FlowChartRow[] = [
  row('2026-10-26', 312_400_000, 204_100_000, 96_800_000),
  row('2026-10-27', -176_200_000, -132_800_000, -60_500_000),
  row('2026-10-28', 402_600_000, 297_400_000, 176_300_000),
  row('2026-10-29', 221_500_000, 184_000_000, 88_100_000)
]

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  if (typeof document !== 'undefined') document.body.replaceChildren()
})

function cardText(overrides: Partial<typeof zhText> = {}) {
  return { ...zhText, ...overrides }
}

function state(rows: readonly FlowChartRow[]) {
  return {
    state: 'available' as const,
    conclusion: 'partial' as const,
    observedAt: '2026-11-02T07:00:00.000Z',
    currentUsd: '$254.9B',
    change1dUsd: '+$128.6M',
    change1dPercent: '+0.05%',
    change7dUsd: '+$312.4M',
    change7dPercent: '+0.12%',
    change30dUsd: '-$88.2M',
    change30dPercent: '-0.03%',
    flowHistory: { state: 'available' as const, rows },
    // 过渡：模型侧还没去掉 `etf`，这里只满足类型；展示层已不再读它。
    etf: 'unavailable' as const,
    etfReading: {
      state: 'available' as const,
      comparison: { state: 'aligned' as const },
      // 快照的校验时刻：`DashboardEtfFlow` 要求它在，缺了整张卡的类型都不成立。
      verifiedAt: '2026-11-02T07:00:00.000Z',
      coverage: [{ windowDays: 5, coveredDays: 5, complete: true }, { windowDays: 20, coveredDays: 20, complete: true }],
      btc: { asset: 'BTC' as const, latestNetFlowUsd: '+$297.4M', observedAt: '2026-11-02T07:00:00.000Z', cumulative: [{ windowDays: 5, coveredDays: 5, netFlowUsd: '+$1B', complete: true }, { windowDays: 20, coveredDays: 20, netFlowUsd: '+$2B', complete: true }], rows: [] },
      eth: { asset: 'ETH' as const, latestNetFlowUsd: '+$176.3M', observedAt: '2026-11-02T07:00:00.000Z', cumulative: [{ windowDays: 5, coveredDays: 5, netFlowUsd: '+$500M', complete: true }, { windowDays: 20, coveredDays: 20, netFlowUsd: '+$900M', complete: true }], rows: [] }
    }
  }
}


/** Same card, but with the flow history forced into one of its non-chart states. */
function mountWithFlow(flowHistory: unknown, rows: readonly FlowChartRow[]): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const value = { ...state(rows), flowHistory }
  act(() => root?.render(scopedLang(
    scopedTz(
      createElement(CapitalConditionsPanel, { text: cardText(), state: value as never, onRefresh: () => undefined })))))
  return container
}

function mount(text = cardText(), rows: readonly FlowChartRow[] = plainRows) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(scopedLang(
    scopedTz(
      createElement(CapitalConditionsPanel, { text, state: state(rows), onRefresh: () => undefined })))))
  return container
}


/** jsdom's `.click()` reports `detail: 0`, which reads as a keyboard activation. */
function clickLikeMouse(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
}

/** 语言与时区都是必填 props；包一层，调用点只写 scopedLang(scopedTz(child))。 */
const scopedLang = (children: React.ReactElement): React.ReactElement =>
  createElement(ShellLanguageProvider, { language: 'zh-CN', children })
const scopedTz = (children: React.ReactElement): React.ReactElement =>
  createElement(ShellTimeZoneProvider, { timeZone: 'Asia/Shanghai', children })

/** 同一张卡，只换 ETF 那一段（每支各说各的）。 */
function mountReading(overrides: Record<string, unknown>): HTMLElement {
  const base = state(plainRows) as ReturnType<typeof state> & { etfReading: Record<string, unknown> }
  const value = { ...base, etfReading: { ...base.etfReading, ...overrides } }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(scopedLang(
    scopedTz(createElement(CapitalConditionsPanel, { text: cardText(), state: value as never, onRefresh: () => undefined })))))
  return container
}

describe('ETF 两支各说各的', () => {
  it('shows the asset that has a value and says 未知 with the reason for the one that does not', () => {
    // 「ETH 晚一天 → 整份作废」就是这条要防的：一支没值不该把另一支一起撤掉。
    const container = mountReading({ missing: { eth: 'value-missing' }, eth: undefined })
    const content = container.textContent ?? ''
    expect(content).toContain('+$297.4M')          // BTC 照常显示数字
    expect(content).toContain('未知')
    expect(content).toContain('有行，但最新一行缺净流入')  // 具体原因，不是「原因未记录」
    expect(content).toContain('BTC ETF')
    expect(content).toContain('ETH ETF')
  })

  it('shows zero as zero instead of borrowing the other asset', () => {
    const base = state(plainRows) as ReturnType<typeof state> & { etfReading: Record<string, unknown> }
    const btc = (base.etfReading.btc as { latestNetFlowUsd: string })
    const container = mountReading({ btc: { ...btc, latestNetFlowUsd: '$0' } })
    const content = container.textContent ?? ''
    expect(content).toContain('$0')
    // 0 是有值：不许因为另一边有数字就把这一支写成「未知」。
    expect(content).not.toContain('未知')
  })

  it('says the comparison does not hold without hiding either number when the windows differ', () => {
    const container = mountReading({
      comparison: { state: 'unaligned', reason: 'latest-trading-day-differs', lagging: 'eth', laggingDays: 1 }
    })
    const content = container.textContent ?? ''
    expect(content).toContain('对比列不可比')
    expect(content).toContain('落后 1 个交易日')
    // 两份数字都还在：不可比说的是对比列，不是「没数据」。
    expect(content).toContain('+$297.4M')
    expect(content).toContain('+$176.3M')
  })
})

describe('bar-top labels', () => {
  it('labels three readings and nothing else', () => {
    const markup = renderToStaticMarkup(scopedLang(
      createElement(CapitalConditionsPanel, { text: cardText(), state: state(plainRows) as never, onRefresh: () => undefined })))
    expect((markup.match(/data-flow-label="/g) ?? [])).toHaveLength(3)
    expect(markup).toContain('+$402.6M')
    expect(markup).toContain('-$176.2M')
  })

  it('labels one number when the last day is also the largest inflow', () => {
    const markup = renderToStaticMarkup(scopedLang(
      createElement(CapitalConditionsPanel, { text: cardText(), state: state(overlappingRows) as never, onRefresh: () => undefined })))
    expect((markup.match(/data-flow-label="/g) ?? [])).toHaveLength(2)
  })

  it('speaks 亿 while the screen keeps M', () => {
    const markup = renderToStaticMarkup(scopedLang(
      createElement(CapitalConditionsPanel, { text: cardText(), state: state(plainRows) as never, onRefresh: () => undefined })))
    expect(markup).toContain('aria-label="净流入 4.026 亿美元，全部美元稳定币"')
    expect(markup).not.toContain('402.6 亿美元')
  })
})

describe('the stablecoin row name', () => {
  it('wraps inside its own column instead of running over the numbers', () => {
    // jsdom has no layout: `scrollWidth <= clientWidth` there is 0 <= 0 and would pass on a
    // broken card. The facts that can be checked here are the CSS decisions and the full name —
    // the pixel check belongs to the real window.
    const css = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'), 'utf8')
    const stableTable = css.slice(css.indexOf('.mi-capital-conditions__stable-table {'))
    expect(stableTable).toContain('table-layout: auto')
    expect(stableTable).toContain('white-space: normal')
    expect(stableTable).toContain('line-height: 1.25')
    // The number cells keep their single line: only the name column may wrap.
    expect(css).toMatch(/\.mi-capital-conditions__etf-table tbody td \{[^}]*white-space: nowrap/)
  })

  it('draws the scope on its own line, one size down, and still speaks the full name', () => {
    const container = mount()
    const rowName = container.querySelector('.mi-capital-conditions__stable-table tbody th')!
    // Two lines, but one spoken name: the concatenation is what a screen reader reads.
    expect(rowName.textContent).toBe('稳定币（USDT + USDC）')
    expect(rowName.querySelector('.mi-capital-conditions__asset-name')?.textContent).toBe('稳定币')
    expect(rowName.querySelector('.mi-capital-conditions__asset-scope')?.textContent).toBe('（USDT + USDC）')
  })
})

describe('accessible names', () => {
  it('gives each label a role that can carry a name', () => {
    const markup = renderToStaticMarkup(scopedLang(
      createElement(CapitalConditionsPanel, { text: cardText(), state: state(plainRows) as never, onRefresh: () => undefined })))
    expect((markup.match(/role="img"/g) ?? [])).toHaveLength(3)
    expect(markup).toContain('role="img" aria-label="净流入 4.026 亿美元，全部美元稳定币"')
  })

  it('speaks 万 for an amount below one hundred million', () => {
    const small: FlowChartRow[] = [row('2026-10-27', -45_200_000, -1_000_000, -1_000_000), row('2026-10-28', 82_400_000, 1_000_000, 1_000_000)]
    const container = mount(cardText(), small)
    const second = container.querySelector<HTMLElement>('[data-flow-label="1"]')!
    expect(second.getAttribute('aria-label')).toBe('净流入 8240 万，全部美元稳定币')
  })

  it('says there is no net inflow when the day is flat', () => {
    const flat: FlowChartRow[] = [row('2026-10-27', -45_200_000), row('2026-10-28', 0)]
    const container = mount(cardText(), flat)
    expect(container.querySelector<HTMLElement>('[data-flow-label="1"]')?.getAttribute('aria-label'))
      .toBe('没有净流入，全部美元稳定币')
  })
})

describe('the labels on the user-reported card', () => {
  // Exactly the window the reader sent: the largest outflow is also the largest magnitude, so the
  // axis prints the same number it labels. Three labels, not four.
  const reported: FlowChartRow[] = [
    row('2026-10-16', -314_500_000, -82_400_000, -69_700_000),
    row('2026-10-19', -31_200_000, 526_700_000, -103_300_000),
    row('2026-10-20', -883_700_000, 23_200_000, -26_100_000),
    row('2026-10-21', -199_500_000, 524_800_000, 14_900_000),
    row('2026-10-22', 149_100_000, -635_600_000, -110_600_000),
    row('2026-10-23', -438_700_000, -137_900_000, 4_400_000),
    row('2026-10-26', -317_400_000, 110_300_000, -88_600_000)
  ]

  it('labels three readings, and the repeated number is the axis, not a second label', () => {
    const markup = renderToStaticMarkup(scopedLang(
      createElement(CapitalConditionsPanel, { text: cardText(), state: state(reported) as never, onRefresh: () => undefined })))
    const labels = [...markup.matchAll(/data-flow-label="\d+"[^>]*>([^<]+)</g)].map((match) => match[1])
    expect(labels).toHaveLength(3)
    expect(labels).toContain('-$883.7M') // largest outflow
    expect(labels).toContain('+$149.1M') // largest inflow
    expect(labels).toContain('-$317.4M') // last day
    // The second `-$883.7M` on screen is the axis floor: the axis scales to the largest magnitude.
    expect(markup).toContain('<span>-$883.7M</span>')
  })
})

describe('labels versus the date band', () => {
  it('labels three readings and nothing else on the reported window', () => {
    const markup = renderToStaticMarkup(scopedLang(
      createElement(CapitalConditionsPanel, { text: cardText(), state: state(plainRows) as never, onRefresh: () => undefined })))
    expect((markup.match(/data-flow-label="/g) ?? [])).toHaveLength(3)
  })
})

describe('daily values dialog', () => {
  it('opens the platform dialog from the title row', async () => {
    const container = mount()
    const button = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__daily-button')!
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button.hasAttribute('aria-expanded')).toBe(false)
    expect(button.hasAttribute('aria-controls')).toBe(false)
    expect(button.closest('header')).not.toBeNull()
    expect(document.querySelector('.mi-capital-conditions__daily-table')).toBeNull()

    await act(async () => clickLikeMouse(button))
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.querySelector('.mi-capital-conditions__chart')).not.toBeNull()
    expect(dialog.querySelector('.mi-capital-conditions__daily-table')).not.toBeNull()
  })

  it('shows the same amount in a bar label and in its table cell', async () => {
    const container = mount()
    const labels = [...container.querySelectorAll<HTMLElement>('[data-flow-label]')].map((node) => node.textContent)
    await act(async () => clickLikeMouse(container.querySelector<HTMLButtonElement>('.mi-capital-conditions__daily-button')!))
    const rows = [...document.querySelectorAll<HTMLElement>('.mi-capital-conditions__daily-table tbody tr')]
    const cells = rows.map((rowNode) => rowNode.querySelectorAll('td')[0]?.textContent ?? '')
    for (const label of labels) expect(cells).toContain(label)
  })

  it('names every cell with amount and scope', async () => {
    const container = mount()
    await act(async () => clickLikeMouse(container.querySelector<HTMLButtonElement>('.mi-capital-conditions__daily-button')!))
    const cell = document.querySelector<HTMLElement>('.mi-capital-conditions__daily-table tbody td')!
    expect(cell.getAttribute('aria-label')).toBe('净流入 3.124 亿美元，全部美元稳定币')
    expect(cell.textContent).toBe('+$312.4M')
    const dateCell = document.querySelector<HTMLElement>('.mi-capital-conditions__daily-table tbody th')!
    expect(dateCell.textContent).toBe('10-26')
    expect(dateCell.getAttribute('data-trading-date')).toBe('2026-10-26')
  })

  it('leaves the card markup alone while the dialog is open', async () => {
    const container = mount()
    const card = container.querySelector('.mi-capital-conditions')!
    const before = card.outerHTML
    const button = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__daily-button')!

    await act(async () => clickLikeMouse(button))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    // The dialog is portalled, so opening it changes nothing inside the card itself — which is
    // also why the card's height cannot move. Escape and returning focus belong to the platform
    // Modal (its own suite asserts both); the real-window pass confirmed them here.
    expect(card.outerHTML).toBe(before)
  })

  it('names the three series inside the dialog, in the same order as the card', async () => {
    const container = mount()
    const cardOrder = [...container.querySelectorAll('.mi-capital-conditions__chart-legend span')].map((node) => node.textContent)
    expect(cardOrder).toEqual([zhText.fundsColumn, zhText.btc, zhText.eth])

    await act(async () => clickLikeMouse(container.querySelector<HTMLButtonElement>('.mi-capital-conditions__daily-button')!))
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const dialogOrder = [...dialog.querySelectorAll('.mi-capital-conditions__chart-legend span')].map((node) => node.textContent)
    expect(dialogOrder).toEqual(cardOrder)
  })

  it('draws the trigger as its own bordered button, not a text link', () => {
    const container = mount()
    const button = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__daily-button')!
    expect(button.tagName).toBe('BUTTON')
    expect(button.className).not.toContain('text-action')
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button.closest('header')).not.toBeNull()
    expect(button.textContent).toBe('查看逐日数据')
  })

  it('says how many days are missing instead of calling it a failure', () => {
    const container = mountWithFlow({ state: 'not-yet', availableDays: 3 }, [])
    expect(container.querySelector('.mi-capital-conditions__daily-button')).toBeNull()
    expect(container.querySelector('.mi-capital-conditions__daily-not-yet')?.textContent)
      .toBe('最近 7 天里只有 3 天有数据。')
  })

  it('says there is no usable data when no day lines up', () => {
    const container = mountWithFlow({ state: 'not-yet', availableDays: 0 }, [])
    expect(container.querySelector('.mi-capital-conditions__daily-button')).toBeNull()
    expect(container.querySelector('.mi-capital-conditions__daily-not-yet')?.textContent).toBe(zhText.flowNoDays)
  })

  it('keeps the retry surface for undelivered sources', () => {
    const container = mountWithFlow(undefined, [])
    expect(container.querySelector('.mi-capital-conditions__daily-button')).toBeNull()
    expect(container.querySelector('[data-etf-flow="unavailable"]')).not.toBeNull()
    expect(container.querySelector('.mi-capital-conditions__daily-not-yet')).toBeNull()
  })
})

describe('the explanation lives in the title info bubble', () => {
  it('keeps no sentence in the card body', () => {
    const container = mount()
    const body = container.textContent ?? ''
    expect(body).not.toContain(zhText.chartScopeNoteMain)
    expect(body).not.toContain(zhText.columnScopeNote)
    expect(body).not.toContain('不可相互核对')
  })

  it('names the info button for screen readers', () => {
    const container = mount()
    const info = container.querySelector<HTMLButtonElement>('header button[aria-label]')
    expect(info?.getAttribute('aria-label')).toBe(zhText.infoAria)
  })
})
