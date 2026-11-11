// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { CapitalConditionsPanel } from './CapitalConditionsPanel'
import type { DashboardCapitalConditionsState } from './capitalConditionsModel'

/**
 * 「整卡读不到」时的形态（用户 2026-11-11）：
 * **表格结构照常渲染，数据格空着，状态句 + 一颗动作放在表头下面的第一行**——
 * 不是把整张表拿掉换成一块状态面。用户的原话是「右边的图表可以继续显示，就是显示没数据的空表而已」。
 *
 * 判据全是 DOM 结构，不断言像素（本仓没有排版引擎，也不许各线自起应用量）：
 * 有数据态与空态渲染的是同一套骨架容器，谁把其中一张表换回状态面，这几条就红。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.capitalConditions
const dataText = productText['zh-CN'].pages.intelligence.portal.data

const available: DashboardCapitalConditionsState = {
  state: 'available',
  conclusion: 'partial',
  observedAt: '2026-08-18T07:00:00.000Z',
  currentUsd: '$1B',
  change1dUsd: '$0',
  change1dPercent: '0.00%',
  change7dUsd: '$0',
  change7dPercent: '0.00%',
  change30dUsd: '$0',
  change30dPercent: '0.00%',
  etfReading: { state: 'unreadable', comparison: { state: 'unaligned', reason: 'source-unreadable' }, coverage: [] }
}

function render(state: DashboardCapitalConditionsState): string {
  return renderToStaticMarkup(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(ShellTimeZoneProvider, {
      timeZone: 'UTC',
      children: createElement(CapitalConditionsPanel, { text, state, onRefresh: () => undefined })
    })
  }))
}

const unavailable = render({ state: 'unavailable', reason: 'query-failed' })
const readable = render(available)

/** 一张表里表头那几列的文字（列名清单）。 */
function headerLabels(markup: string, tableClass: string): string[] {
  const table = new RegExp(`<table[^>]*${tableClass}[^>]*>[\\s\\S]*?<thead>([\\s\\S]*?)</thead>`).exec(markup)?.[1] ?? ''
  // 括号里是读数（有数据态才有），列名本身不变，所以比的是去掉括号之后的文字。
  return [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map((match) => (match[1] ?? '').replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, '').trim())
}

describe('the capital card keeps its tables when the whole card cannot read', () => {
  it('renders both tables with the same column labels as the readable card', () => {
    for (const tableClass of ['mi-capital-conditions__stable-table', 'mi-capital-conditions__etf-table']) {
      expect(headerLabels(unavailable, tableClass), `${tableClass} header must survive`).toEqual(headerLabels(readable, tableClass))
    }
    // 行名也留着：稳定币（含范围）、BTC、ETH。
    expect(unavailable).toContain(text.stablecoin)
    expect(unavailable).toContain(text.btc)
    expect(unavailable).toContain(text.eth)
  })

  it('renders the same layout containers as the readable card, so the card cannot shrink', () => {
    // 空态缩水的形态就是「没有 content-row / 没有 flow 块」——骨架容器相同，宽度才有同一套来源。
    for (const container of ['mi-capital-conditions__content-row', 'mi-capital-conditions__summary', 'mi-capital-conditions__etf-flow']) {
      expect(unavailable, `${container} must render`).toContain(container)
      expect(readable, `${container} must render`).toContain(container)
    }
    expect((unavailable.match(/<table\b/g) ?? [])).toEqual((readable.match(/<table\b/g) ?? []))
  })

  it('leaves the data cells empty instead of filling them with dashes or a status word each', () => {
    // 数据格留空：不写破折号（那是「确实没有」），也不逐格写状态词。
    expect(unavailable).not.toContain('—')
    const occurrences = unavailable.split(dataText.temporarilyUnavailable).length - 1
    expect(occurrences).toBe(1)
    // 稳定币那一行的数值格是空的。
    const stableRow = /<tr>\s*<th scope="row">[\s\S]*?<\/tr>/.exec(unavailable)?.[0] ?? ''
    expect(stableRow).toContain(text.stablecoin)
    const cells = [...stableRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => (match[1] ?? '').trim())
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every((cell) => cell === '')).toBe(true)
  })

  it('puts one status sentence and one action in the first row under the header', () => {
    const row = /<tr[^>]*data-status-row="unavailable"[^>]*>([\s\S]*?)<\/tr>/.exec(unavailable)?.[0] ?? ''
    expect(row).not.toBe('')
    expect(/colSpan="5"|colspan="5"/.test(row)).toBe(true)
    expect(row).toContain(dataText.temporarilyUnavailable)
    expect((row.match(/<button\b/g) ?? [])).toHaveLength(1)
    expect(row).toContain(dataText.retry)
    // 它是表头下面的第一行：在 tbody 开头、状态行之前没有别的行。
    expect(unavailable.indexOf('data-status-row="unavailable"') < unavailable.indexOf('<th scope="row"')).toBe(true)
  })

  it('keeps the version/shape mismatch on its own action, without a retry', () => {
    const mismatch = render({ state: 'unavailable', reason: 'contract-mismatch' })
    expect(mismatch).toContain(text.contractMismatch)
    expect(mismatch).not.toContain(dataText.retry)
    expect(mismatch).toContain('data-status-row="unavailable"')
  })

  it('gives the wiring causes a re-collection action rather than a dead retry', () => {
    const clock = render({ state: 'unavailable', reason: 'invalid-clock' })
    expect(clock).toContain(text.refresh)
    expect(clock).not.toContain(dataText.retry)
  })
})
