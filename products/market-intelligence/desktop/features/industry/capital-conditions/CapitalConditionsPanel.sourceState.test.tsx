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
 * 资金面卡的两格（稳定币 / ETF）逐格标来源状态。
 *
 * 界面设计 2026-11-11 §二 按**形态**分：这张卡是多行多值卡，两格能分别判断，所以两态**逐格**标
 * （共享行内状态 `mi-source-state`），**不叠整卡状态面**——同一张卡只许一种形态。
 * 判据：只关一格时另一格照旧；两格都关时卡不消失、两行各自标；说法互不冒充；
 * 把整卡状态面（`state-view`）加回来必须红。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.capitalConditions
const dataText = productText['zh-CN'].pages.intelligence.portal.data

type CellState = NonNullable<DashboardCapitalCellAvailability['stablecoin']>

const openSources = (): void => undefined
const disabledStablecoin: CellState = { state: 'disabled', sourceLabel: '稳定币', onOpenSources: openSources }
const disabledEtf: CellState = { state: 'disabled', sourceLabel: 'ETF', onOpenSources: openSources }
const missingEtf: CellState = { state: 'missing', onOpenSources: openSources }

/** 一次读成功的快照：稳定币有数；ETF 这一支这里给「读不到」，好让「读不到由读数自己说」也被看见。 */
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

function render(props: Readonly<{
  state?: DashboardCapitalConditionsState
  cells?: DashboardCapitalCellAvailability
}>): string {
  return renderToStaticMarkup(createElement(ShellLanguageProvider, {
    language: 'zh-CN',
    children: createElement(ShellTimeZoneProvider, {
      timeZone: 'UTC',
      children: createElement(CapitalConditionsPanel, {
        text,
        state: props.state ?? available,
        onRefresh: () => undefined,
        ...(props.cells ? { cellAvailability: props.cells } : {})
      })
    })
  }))
}

const onlyEtfOff = render({ cells: { etf: disabledEtf } })
const onlyStablecoinOff = render({ cells: { stablecoin: disabledStablecoin } })
const bothOff = render({ cells: { stablecoin: disabledStablecoin, etf: disabledEtf } })
/** 两格都关时宿主根本不发请求，读口停在等待态——卡片照样要画出两行。 */
const bothOffWhileIdle = render({ state: { state: 'loading' }, cells: { stablecoin: disabledStablecoin, etf: disabledEtf } })
const missingRow = render({ cells: { etf: missingEtf } })

describe('the two cells of the capital card speak their own source state', () => {
  it('marks only the cell that is off, and keeps the other cell reading', () => {
    // 只关 ETF：ETF 那一行说「来源都没启用（ETF）」，稳定币那张表照旧在。
    expect(onlyEtfOff).toContain(dataText.sourcesNotEnabled)
    expect(onlyEtfOff).toContain('（ETF）')
    expect(onlyEtfOff).toContain('mi-capital-conditions__stable-table')
    expect(onlyEtfOff).not.toContain(dataText.sourcesNotConfigured)
    // 只关稳定币：反过来，ETF 那张表照旧在（资金流图也跟着 ETF 那一格一起走）。
    expect(onlyStablecoinOff).toContain(dataText.sourcesNotEnabled)
    expect(onlyStablecoinOff).toContain('mi-capital-conditions__etf-table')
    expect(onlyStablecoinOff).not.toContain('mi-capital-conditions__stable-table')
  })

  it('keeps the card on screen when both cells are off, and marks each row', () => {
    // 两格都关：这一次根本不会去读（宿主关掉了读口），卡片不许变成「正在加载」，也不许消失。
    expect(bothOff).toContain(text.title)
    expect(bothOff).not.toContain('state-view')
    expect(bothOff).not.toContain('mi-capital-conditions__stable-table')
    expect(bothOff).not.toContain('mi-capital-conditions__etf-table')
    expect((bothOff.match(/data-state="disabled"/g) ?? [])).toHaveLength(2)
    expect((bothOff.match(/mi-source-state__icon/g) ?? [])).toHaveLength(2)
    // 每行恰一颗动作：去启用。
    expect((bothOff.match(/<button\b/g) ?? [])).toHaveLength(2)
    expect((bothOff.match(/去启用/g) ?? [])).toHaveLength(2)
    // 同一张卡只用一种形态：逐行标，就不许再叠整卡状态面（这条就是「加回整卡必须红」的判据）。
    expect(bothOff).not.toContain('mi-source-card')
    // 读口停在等待态（关掉来源就不会去读）时也一样：不许退回一个转圈或一句「正在加载」。
    expect(bothOffWhileIdle).not.toContain(text.loading)
    expect(bothOffWhileIdle).not.toContain('state-view')
    expect((bothOffWhileIdle.match(/data-state="disabled"/g) ?? [])).toHaveLength(2)
  })

  it('never calls a missing source an unenabled one', () => {
    expect(missingRow).toContain(dataText.sourcesNotConfigured)
    expect(missingRow).not.toContain(dataText.sourcesNotEnabled)
    expect(missingRow).toContain(dataText.configureSources)
    // 未配置与未启用都不用错误色：它们不是故障，是读者要动手的事。
    for (const markup of [onlyEtfOff, missingRow]) expect(markup).not.toContain('data-state="unreadable"')
  })

  it('leaves the read failure to the reading itself, with a retry in the row', () => {
    // 没有 `cellAvailability` 时 ETF 读不到仍由 `EtfTable` / `EtfFlow` 自己说，并带行内重试。
    const noAvailability = render({})
    expect(noAvailability).toContain('state-view')
    expect(noAvailability).not.toContain('mi-source-state')
  })
})
