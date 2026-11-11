// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { cellOffLabel } from '../../../pages/intelligence/dashboardCellOff'
import { decideCellRead } from '../../../pages/intelligence/dashboardCellEnabled'
import { CapitalConditionsPanel, type DashboardCapitalCellAvailability } from './CapitalConditionsPanel'
import type { DashboardCapitalConditionsState } from './capitalConditionsModel'

/**
 * 资金面卡的三支（用户 2026-11-11 定，Chief 转述）：
 *
 * 1. **这块没有任何可用的源**（两格都没启用）→ 内容区盖共享遮罩 `.mi-source-veil`、居中一颗
 *    「启用数据」、**不画表头骨架**、标题行不给动作。判据：卡内可聚焦元素恰 1 个。
 * 2. **部分缺 / 整卡读不到** → 结构全留（表头、列名、行名），数据格按两种缺失分开画：
 *    源未启用 = **横杠 `—`**（确实没有，读者自己关的，不许沿用旧读数）；
 *    读不到 = **留空** + 表头下第一行一句状态 + 一颗动作。
 * 3. **全部配好** → 正常出数，无动作。
 *
 * 「源从未配置过」判不出来（源是 `dashboardSourceModules.ts` 的固定条目，读者不能删源，
 * `decideCellRead` 把「没配」并进 `not-enabled`），所以第一支的判据是「两格都未启用」。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.capitalConditions
const dataText = productText['zh-CN'].pages.intelligence.portal.data

type CellOff = NonNullable<DashboardCapitalCellAvailability['stablecoin']>
const openSources = (): void => undefined
const stablecoinOff: CellOff = { sourceLabel: '稳定币', onOpenSources: openSources }
const etfOff: CellOff = { sourceLabel: 'ETF', onOpenSources: openSources }

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
    expect(bothOff).toContain(dataText.sourcesNotEnabled)
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

  it('names the off source or cell in the header row, instead of leaving only a dash', () => {
    // 用户现场（2026-11-12）：「ETF 的项我虽然开着，但是源关掉了，页面也没感知」——
    // 宿主已经把判定 kind 折成一句话的素材，卡片必须把它打出来：
    // `source-disabled` 给的是**源显示名**，`not-enabled` 给的是**格名**，这里两种都钉。
    const sourceOff: CellOff = { sourceLabel: '0xRouter 聚合行情', onOpenSources: openSources }
    const etfSourceOff = render(withNumbers, { etf: sourceOff })
    const row = /<tr[^>]*data-status-row="cell-off"[^>]*>([\s\S]*?)<\/tr>/.exec(etfSourceOff)?.[1] ?? ''
    expect(row).toContain(dataText.sourcesNotEnabled)
    expect(row).toContain('0xRouter 聚合行情')
    // 状态行不带按钮：这张卡的补数据动作只在标题行那一颗。
    expect(row).not.toContain('<button')
    expect((etfSourceOff.match(/<button\b/g) ?? [])).toHaveLength(1)

    const stablecoinCellOff = render(withNumbers, { stablecoin: stablecoinOff })
    const stableRow = /<tr[^>]*data-status-row="cell-off"[^>]*>([\s\S]*?)<\/tr>/.exec(stablecoinCellOff)?.[1] ?? ''
    expect(stableRow).toContain('稳定币')
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

describe('the label the card prints comes from the decision kind, not from a boolean', () => {
  // 这一条把宿主那一步（判定 kind → 那句话素材）与卡片那一步（把它打出来）接起来跑：
  // `source-disabled` 必须落到**源的显示名**，`not-enabled` 落到**格名**。
  // 谁把「看 kind」压回布尔（例如两种都返回格名），源名就消失，这条红。
  const sourceNames: Record<string, string> = { '0xrouter-aggregate-provider': '0xRouter 聚合行情' }
  const labelFor = (cells: Record<string, boolean>, sources: Record<string, boolean>): string | undefined => cellOffLabel({
    decision: decideCellRead({ moduleId: 'capital', cellKey: 'etf', cells, selections: {}, sources }),
    cellLabel: 'ETF',
    sourceName: (sourceId) => sourceNames[sourceId] ?? sourceId
  })

  it('names the source when the source is off', () => {
    const label = labelFor({}, { '0xrouter-aggregate-provider': false })
    const markup = render(withNumbers, { etf: { sourceLabel: label ?? '', onOpenSources: openSources } })
    expect(markup).toContain('0xRouter 聚合行情')
  })

  it('names the cell when the cell itself is off', () => {
    const label = labelFor({ 'capital:etf': false }, { '0xrouter-aggregate-provider': true })
    const markup = render(withNumbers, { etf: { sourceLabel: label ?? '', onOpenSources: openSources } })
    const row = /<tr[^>]*data-status-row="cell-off"[^>]*>([\s\S]*?)<\/tr>/.exec(markup)?.[1] ?? ''
    expect(row).toContain(dataText.sourcesNotEnabled)
    expect(row).toContain('ETF')
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
