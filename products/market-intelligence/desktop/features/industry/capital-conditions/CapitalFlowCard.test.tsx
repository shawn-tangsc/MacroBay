// @vitest-environment happy-dom
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
  row('10-27', -176_000_000, -132_000_000, -60_000_000),
  row('10-28', 402_600_000, 297_000_000, 176_000_000)
]

const plainRows: FlowChartRow[] = [
  row('10-26', 312_400_000, 204_100_000, 96_800_000),
  row('10-27', -176_200_000, -132_800_000, -60_500_000),
  row('10-28', 402_600_000, 297_400_000, 176_300_000),
  row('10-29', 221_500_000, 184_000_000, 88_100_000)
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

function mount(text = cardText(), rows: readonly FlowChartRow[] = plainRows) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(createElement(ShellLanguageProvider, { language: 'zh-CN' },
    createElement(ShellTimeZoneProvider, { timeZone: 'Asia/Shanghai' },
      createElement(CapitalConditionsPanel, { text, state: state(rows), onRefresh: () => undefined })))))
  return container
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

describe('daily table', () => {
  it('renders nothing until the button is pressed, and keeps focus on the button', async () => {
    const container = mount()
    const button = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__daily-button')!
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.hasAttribute('aria-controls')).toBe(false)
    expect(container.querySelector('.mi-capital-conditions__daily-table')).toBeNull()

    button.focus()
    await act(async () => button.click())
    const table = container.querySelector('.mi-capital-conditions__daily-table')!
    expect(table).not.toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-controls')).toBe(container.querySelector('.mi-capital-conditions__daily-table')?.closest('[id]')?.id ?? '')
    expect(document.activeElement).toBe(button)

    await act(async () => button.click())
    expect(container.querySelector('.mi-capital-conditions__daily-table')).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.hasAttribute('aria-controls')).toBe(false)
  })

  it('shows the same amount in the label and in the cell', async () => {
    const container = mount()
    const button = container.querySelector<HTMLButtonElement>('.mi-capital-conditions__daily-button')!
    const labels = [...container.querySelectorAll<HTMLElement>('[data-flow-label]')].map((node) => node.textContent)
    await act(async () => button.click())
    const rows = [...container.querySelectorAll<HTMLElement>('.mi-capital-conditions__daily-table tbody tr')]
    const cells = rows.map((rowNode) => rowNode.querySelectorAll('td')[0]?.textContent ?? '')
    for (const label of labels) expect(cells).toContain(label)
  })

  it('names every cell with amount and scope', async () => {
    const container = mount()
    await act(async () => container.querySelector<HTMLButtonElement>('.mi-capital-conditions__daily-button')!.click())
    const cell = container.querySelector<HTMLElement>('.mi-capital-conditions__daily-table tbody td')!
    expect(cell.getAttribute('aria-label')).toBe('净流入 3.124 亿美元，全部美元稳定币')
    expect(cell.textContent).toBe('+$312.4M')
  })

  it('gives no button when there is nothing to show', () => {
    const container = mount(cardText(), [])
    expect(container.querySelector('.mi-capital-conditions__daily-button')).toBeNull()
    expect(container.querySelector('.mi-capital-conditions__daily-empty')?.textContent).toBe(zhText.dailyEmpty)
  })
})

describe('the two notes', () => {
  it('are the same string and quote the row by the row key', () => {
    const container = mount()
    const chartNote = container.querySelector('.mi-capital-conditions__not-comparable')!
    expect(chartNote.textContent).toBe('与卡片「稳定币（USDT + USDC）」行不可相互核对：那行含今天。')
    expect(chartNote.textContent).not.toContain('{row}')
  })

  it('follow the row name when it changes', async () => {
    const container = mount(cardText({ stablecoin: '稳定币（测试行名）' }))
    await act(async () => container.querySelector<HTMLButtonElement>('.mi-capital-conditions__daily-button')!.click())
    const chartNote = container.querySelector('.mi-capital-conditions__not-comparable')?.textContent
    const tableNote = container.querySelector('.mi-capital-conditions__daily-note')?.textContent
    expect(chartNote).toBe('与卡片「稳定币（测试行名）」行不可相互核对：那行含今天。')
    expect(tableNote).toBe(chartNote)
  })
})
