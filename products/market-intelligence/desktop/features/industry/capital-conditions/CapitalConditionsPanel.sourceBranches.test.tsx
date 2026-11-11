// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { CapitalConditionsPanel, type DashboardCapitalCellAvailability } from './CapitalConditionsPanel'
import type { DashboardCapitalConditionsState } from './capitalConditionsModel'

/**
 * 资金面卡的三支（用户 2026-11-11 定，Chief 转述）：
 *
 * 1. **两格都被读者关掉** → 内容区盖共享遮罩 `.mi-source-veil`、居中一颗「启用数据」、
 *    **不画表头骨架**、标题行不给动作。判据：卡内可聚焦元素恰 1 个。
 * 2. **部分缺 / 整卡读不到** → 结构全留（表头、列名、行名），数据格按原因分开画：
 *    格关掉 = **横杠 `—`**（确实没有，不许沿用旧读数）；源停 / 没配 / 状态读不到 = **留空** +
 *    一句行内词；读到了但没读成 = **留空** + 状态词，**不给按钮**（ETF 没有真重采入口）。
 * 3. **全部配好** → 正常出数，无动作。
 *
 * 四种缺读数原因与句子只在 `capitalCellBlock.ts` 写一次；这里只验摆法。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.capitalConditions
const dataText = productText['zh-CN'].pages.intelligence.portal.data
const cellState = productText['zh-CN'].pages.intelligence.portal.dashboard.cellState

type CellBlock = NonNullable<DashboardCapitalCellAvailability['stablecoin']>
const openSources = (): void => undefined
const stablecoinOff: CellBlock = { kind: 'cell-off', label: '稳定币', onAction: openSources }
const etfOff: CellBlock = { kind: 'cell-off', label: 'ETF', onAction: openSources }

/** 读到了数的快照：两格都有真实数字，用来证明「源关掉以后旧读数不许留」。 */
const withNumbers: DashboardCapitalConditionsState = {
  state: 'available',
  conclusion: 'partial',
  observedAt: '2026-08-18T07:00:00.000Z',
  currentUsd: '$1.2B',
  change1dUsd: '+$95M',
  change1dPercent: '8.6%',
  change7dUsd: '+$120M',
  change7dPercent: '11.1%',
  change30dUsd: '-$40M',
  change30dPercent: '3.2%',
  flowHistory: { state: 'available', rows: [{ tradingDate: '2026-08-18', funds: 95_000_000, btc: -95_000_000, eth: -1_300_000 }] },
  etfReading: {
    state: 'available',
    comparison: { state: 'aligned' },
    coverage: [],
    verifiedAt: '2026-08-18T07:00:00.000Z',
    btc: { asset: 'BTC', latestNetFlowUsd: '-$95M', observedAt: '2026-08-18T07:00:00.000Z', cumulative: [], rows: [] },
    eth: { asset: 'ETH', latestNetFlowUsd: '-$1.3M', observedAt: '2026-08-18T07:00:00.000Z', cumulative: [], rows: [] }
  }
}

function render(state: DashboardCapitalConditionsState, cells?: DashboardCapitalCellAvailability): string {
  return renderToStaticMarkup(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(ShellTimeZoneProvider, {
      timeZone: 'UTC',
      children: createElement(CapitalConditionsPanel, {
        text,
        state,
        onRefresh: () => undefined,
        ...(cells ? { cellAvailability: cells } : {})
      })
    })
  }))
}

describe('the capital card, branch one: no usable source at all', () => {
  const bothOff = render(withNumbers, { stablecoin: stablecoinOff, etf: etfOff })

  it('veils the content area with exactly one action and no table skeleton', () => {
    expect(bothOff).toContain('mi-source-veil')
    expect(bothOff).toContain('data-veiled="true"')
    // 不画骨架：表头一个都不渲染（骨架会让读者以为「有表、只是这次没数」）。
    expect(bothOff).not.toContain('<thead')
    expect(bothOff).not.toContain('mi-capital-conditions__stable-table')
    expect(bothOff).toContain(cellState.notEnabled)
    // 卡内可聚焦元素恰 1 个：遮罩里那颗「启用数据」。
    expect((bothOff.match(/<button\b/g) ?? [])).toHaveLength(1)
    expect(bothOff).toContain('启用数据')
    // 标题行不给动作：同一个动作只有一处入口。
    expect(bothOff).not.toContain('mi-capital-conditions__title-action')
    // 不用平台状态面顶替这一支。
    expect(bothOff).not.toContain('state-view')
    // 也从不说「还没有配置来源」：这条链上判不出「没配」，说了就是编（源是固定条目）。
    expect(bothOff).not.toContain(dataText.sourcesNotConfigured)
  })
})

describe('the capital card, branch two: part missing or unreadable', () => {
  it('draws a dash in every data cell of a switched-off cell, and keeps no old reading', () => {
    const onlyEtfOff = render(withNumbers, { etf: etfOff })
    // 结构全留：表头、两行行名都在。
    expect(onlyEtfOff).toContain('<thead')
    expect(onlyEtfOff).toContain(text.btc)
    expect(onlyEtfOff).toContain(text.eth)
    // 那一格的两行：每一格横杠，**一个旧数字都不许留**。
    const rows = [...onlyEtfOff.matchAll(/<tr data-etf-cell-off="(btc|eth)">([\s\S]*?)<\/tr>/g)].map((match) => match[2] ?? '')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).toContain('—')
      expect(row.replace(/<[^>]*>/g, '')).not.toMatch(/\d/)
    }
    expect(onlyEtfOff).not.toContain('-$$M')
    expect(onlyEtfOff).not.toContain('-1.3M')
    // 另一格照旧出数。
    expect(onlyEtfOff).toContain('$1.2B')
  })

  it('puts the card\'s only action in the title row', () => {
    const onlyEtfOff = render(withNumbers, { etf: etfOff })
    const buttons = [...onlyEtfOff.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
    expect(buttons).toHaveLength(1)
    expect(onlyEtfOff).toContain('mi-capital-conditions__title-action')
    expect(onlyEtfOff).toContain('启用数据')
    // 卡内不再有第二颗「去启用」。
    expect(onlyEtfOff).not.toContain(dataText.enableSources)
  })

  it('leaves read failures blank with a status line, never a dash', () => {
    const unreadable = render({ ...withNumbers, etfReading: { state: 'unreadable', comparison: { state: 'unaligned', reason: 'source-unreadable' }, coverage: [] } })
    // 读不到 = 拿不到：留空 + 行内一句状态词；横杠只属于「确实没有」。
    expect(unreadable).toContain('data-etf-unavailable="true"')
    expect(unreadable).toContain(dataText.temporarilyUnavailable)
    expect(unreadable).not.toContain('—')
    expect(unreadable).not.toContain('state-view')
  })
})

describe('the capital card, branch three: everything readable', () => {
  it('renders the readings and no action at all', () => {
    const ready = render(withNumbers)
    expect(ready).toContain('$1.2B')
    expect(ready).not.toContain('mi-capital-conditions__title-action')
    expect(ready).not.toContain('mi-source-state')
    expect(ready).not.toContain('—')
    // 「无动作」指的是**没有补数据那颗**（启用数据 / 再试一次）；图里的「查看每日」与 ⓘ 是读数控件。
    expect(ready).not.toContain('启用数据')
    expect(ready).not.toContain(dataText.retry)
  })
})
