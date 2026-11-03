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
    etf: {
      state: 'available' as const,
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
  act(() => root?.render(createElement(ShellLanguageProvider, { language: 'zh-CN' },
    createElement(ShellTimeZoneProvider, { timeZone: 'Asia/Shanghai' },
      createElement(CapitalConditionsPanel, { text: cardText(), state: value as never, onRefresh: () => undefined })))))
  return container
}

function mount(text = cardText(), rows: readonly FlowChartRow[] = plainRows) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(createElement(ShellLanguageProvider, { language: 'zh-CN' },
    createElement(ShellTimeZoneProvider, { timeZone: 'Asia/Shanghai' },
      createElement(CapitalConditionsPanel, { text, state: state(rows), onRefresh: () => undefined })))))
  return container
}


/** jsdom's `.click()` reports `detail: 0`, which reads as a keyboard activation. */
function clickLikeMouse(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
}

describe('bar-top labels', () => {
  it('labels three readings and nothing else', () => {
    const markup = renderToStaticMarkup(createElement(ShellLanguageProvider, { language: 'zh-CN' },
      createElement(CapitalConditionsPanel, { text: cardText(), state: state(plainRows) as never, onRefresh: () => undefined })))
    expect((markup.match(/data-flow-label="/g) ?? [])).toHaveLength(3)
    expect(markup).toContain('+$402.6M')
    expect(markup).toContain('-$176.2M')
  })

  it('labels one number when the last day is also the largest inflow', () => {
    const markup = renderToStaticMarkup(createElement(ShellLanguageProvider, { language: 'zh-CN' },
      createElement(CapitalConditionsPanel, { text: cardText(), state: state(overlappingRows) as never, onRefresh: () => undefined })))
    expect((markup.match(/data-flow-label="/g) ?? [])).toHaveLength(2)
  })

  it('speaks 亿 while the screen keeps M', () => {
    const markup = renderToStaticMarkup(createElement(ShellLanguageProvider, { language: 'zh-CN' },
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

  it('keeps the full scoped name in the card', () => {
    const container = mount()
    const rowName = container.querySelector('.mi-capital-conditions__stable-table tbody th')
    expect(rowName?.textContent).toBe('稳定币（USDT + USDC）')
  })
})

describe('accessible names', () => {
  it('gives each label a role that can carry a name', () => {
    const markup = renderToStaticMarkup(createElement(ShellLanguageProvider, { language: 'zh-CN' },
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

describe('daily table', () => {
  it('keeps the table out of the card until the title-row button is pressed', async () => {
    const container = mount()
    const card = container.querySelector('.mi-capital-conditions')!
    const button = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__daily-button')!
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.hasAttribute('aria-controls')).toBe(false)
    expect(document.querySelector('.mi-capital-conditions__daily-table')).toBeNull()
    // The trigger sits in the title row, above the chart.
    expect(button.closest('header')).toBe(container.querySelector('header'))

    button.focus()
    await act(async () => clickLikeMouse(button))
    const table = document.querySelector<HTMLElement>('.mi-capital-conditions__daily-table')!
    expect(table).not.toBeNull()
    expect(card.contains(table)).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-controls')).toBe(table.closest('[id]')?.id ?? '')
    expect(document.activeElement).toBe(button)

    await act(async () => clickLikeMouse(button))
    expect(document.querySelector('.mi-capital-conditions__daily-table')).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.hasAttribute('aria-controls')).toBe(false)
  })

  it('shows the same amount in the label and in the cell', async () => {
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

  it('draws the trigger as a bordered small button, not a text link', () => {
    const container = mount()
    const button = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__daily-button')!
    expect(button.className).toContain('ant-btn')
    expect(button.className).toContain('ant-btn-sm')
    expect(button.className).not.toContain('text-action')
    expect(button.closest('header')).not.toBeNull()
  })

  it('says how many days are missing instead of calling it a failure', () => {
    const container = mountWithFlow({ state: 'not-yet', availableDays: 3 }, [])
    expect(container.querySelector('.mi-capital-conditions__daily-button')).toBeNull()
    expect(container.querySelector('.mi-capital-conditions__daily-not-yet')?.textContent)
      .toBe('最近 7 天里只有 3 天有数据。')
    expect(container.textContent).not.toContain('不可用</') // not the retry surface
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
