// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'

import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { DivergencePanel } from './DivergencePanel'

/**
 * 时区 provider 的 `children` 是**必填 prop**，不是 `createElement` 的第三个参数：
 * 那种写法在运行期能跑、在类型上对不上——预检钩子把包含测试文件的那棵树查一遍就红了。
 */
const scoped = (child: ReactElement): ReactElement =>
  createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: child })

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.divergence
const render = (state: Parameters<typeof DivergencePanel>[0]['state'], locale: 'zh-CN' | 'en-US' = 'zh-CN') =>
  renderToStaticMarkup(scoped(createElement(DivergencePanel, {
    state, onRetry: () => undefined, text: productText[locale].pages.intelligence.portal.dashboard.divergence
  })))

const row = {
  pairId: 'liquidity-leverage' as const,
  direction: 'bearish' as const,
  legs: [
    { id: 'stablecoin' as const, text: '−1.21%', observedAt: '2026-10-30T10:00:00.000Z' },
    { id: 'open-interest' as const, text: '+3.40%', observedAt: '2026-10-30T11:00:00.000Z' },
    { id: 'funding' as const, text: '−0.0032% / 8h', observedAt: '2026-10-30T11:00:00.000Z' }
  ]
}

/** 观察态：方向是 `unpriced`，标签走中性那句，不挂方向色。 */
const observedRow = {
  pairId: 'narrative-price' as const,
  direction: 'unpriced' as const,
  legs: [
    { id: 'sentiment' as const, text: '62%', observedAt: '2026-10-30T09:00:00.000Z' },
    { id: 'price' as const, text: '+0.07%', observedAt: '2026-10-30T11:00:00.000Z' },
    { id: 'open-interest' as const, text: '+0.4%', observedAt: '2026-10-30T11:00:00.000Z' }
  ]
}

type WithheldFixture = Parameters<typeof DivergencePanel>[0]['state'] extends infer _S ? Readonly<{
  pairId: string; reason: 'leg-missing' | 'leg-stale'; leg: 'sentiment' | 'price' | 'etf' | 'stablecoin'
}> : never

const sentimentMissing: WithheldFixture = { pairId: 'narrative-price', reason: 'leg-missing', leg: 'sentiment' }
const priceStale: WithheldFixture = { pairId: 'flows-price', reason: 'leg-stale', leg: 'price' }
const etfMissing: WithheldFixture = { pairId: 'flows-price', reason: 'leg-missing', leg: 'etf' }
const stablecoinMissing: WithheldFixture = { pairId: 'liquidity-leverage', reason: 'leg-missing', leg: 'stablecoin' }

const answer = (rows: readonly (typeof row | typeof observedRow)[], withheld: readonly WithheldFixture[] = []) =>
  ({ state: 'available' as const, rows, withheld })

const sentimentReason = text.sentimentNoScoredItems.replace('{leg}', text.legs.sentiment)

describe('divergence panel · the one summary line', () => {
  it('A: one pair points opposite ways — and says only that', () => {
    const markup = render(answer([row]))
    expect(markup).toContain(text.summary.divergence)
    expect(markup).not.toContain(text.summary.quiet)
    expect(markup).not.toContain(text.summary.allWithheld)
    // 读数不在卡面上：三个数字进展开区。
    expect(markup).not.toContain(row.legs[0]!.text)
  })

  it('B: a quiet day that compared everything — a paragraph, not a control', () => {
    const markup = render({ state: 'empty', withheld: [] })
    expect(markup).toContain(text.summary.quiet)
    expect(markup).not.toContain(text.summary.divergence)
    // 不可展开：不是按钮、没有 aria-expanded、没有箭头。
    expect(markup).not.toContain('aria-expanded')
    expect(markup).not.toContain('mi-divergence__summary-chevron')
  })

  it('C: the unjudged pair names its own leg and reason, not a fixed sentence', () => {
    const sentimentCase = render(answer([row], [sentimentMissing]))
    expect(sentimentCase).toContain(`${text.summary.divergenceWithheldOne.split('{')[0]}${sentimentReason}`)
    // 换成另一组时整句跟着换：照抄成「舆情」就会在这里红。
    const priceCase = render(answer([row], [priceStale]))
    expect(priceCase).toContain(`${text.summary.divergenceWithheldOne.split('{')[0]}${text.withheldReasons['leg-stale'].replace('{leg}', text.legs.price).split('{at}')[0]!}`)
    expect(priceCase).not.toContain(sentimentReason)
  })

  it('C with two unjudged, D with one, D with two, E with all three', () => {
    expect(render(answer([row], [sentimentMissing, priceStale])))
      .toContain(text.summary.divergenceWithheldMany.replace('{count}', '2'))
    expect(render({ state: 'empty', withheld: [sentimentMissing] }))
      .toContain(`${text.summary.quietWithheldOne.split('{')[0]}${sentimentReason}`)
    expect(render({ state: 'empty', withheld: [sentimentMissing, priceStale] }))
      .toContain(text.summary.quietWithheldMany.replace('{count}', '2'))
    const allWithheld = render({ state: 'empty', withheld: [sentimentMissing, stablecoinMissing, priceStale] })
    expect(allWithheld).toContain(text.summary.allWithheld)
    // 五条互斥：E 里不许再出现「没有背离」。
    expect(allWithheld).not.toContain(text.summary.quiet)
  })

  it('is neutral and eats no default button look: transparent, borderless, one token size', () => {
    const markup = render(answer([row]))
    const summary = markup.slice(markup.indexOf('mi-divergence__summary"'), markup.indexOf('</button>'))
    // 判据：摘要行里没有图标组件、没有语气标记——方向色只留在展开区。
    expect(markup).toContain('class="mi-divergence__summary"')
    expect(summary).not.toContain('<svg')
    expect(summary).not.toContain('data-tone')
    /**
     * 样式在外部表里，测试环境读不到计算样式（happy-dom 不加载 `.css`），所以这条查**规则本身**：
     * 删掉任何一条复位声明、或把字号写回像素值，这条就红。灰色实心块正是这些复位缺失时的默认外观。
     *
     * **这条的限制要写明白**：它证明的是「样式表里有这条规则」，**不证明界面上真的生效**——
     * 打包产物过期、类名对不上、别的规则盖掉它，这条都照样绿。所以这个缺陷最终还得靠读者看
     * 一眼才算关；用例只负责「别在下次重构里把复位删掉」。
     */
    const css = readFileSync('products/market-intelligence/desktop/features/industry/divergence/DivergencePanel.css', 'utf8')
    const rule = css.match(/\.mi-divergence__summary \{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toContain('background: transparent')
    expect(rule).toContain('border: 0')
    expect(rule).toContain('padding: 0')
    expect(rule).toContain('font: inherit')
    expect(rule).toContain('font-size: var(--mi-reading-note-size)')
    expect(rule).toContain('line-height: var(--mi-reading-note-line-height)')
    expect(rule).not.toMatch(/font-size:\s*\d/)
    expect(rule).not.toMatch(/caution|negative|warning/)
  })
})

describe('divergence panel · the details behind the line', () => {
  const mount = async (state: Parameters<typeof DivergencePanel>[0]['state']) => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(scoped(createElement(DivergencePanel, { state, onRetry: () => undefined, text })))
    })
    return { container, root }
  }

  it('opens on the summary line and shows each pair’s own as-of instant', async () => {
    const { container, root } = await mount(answer([row], [sentimentMissing, priceStale]))
    const summary = container.querySelector<HTMLButtonElement>('.mi-divergence__summary')!
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-divergence-detail]')).toBeNull()
    await act(async () => { summary.click() })
    expect(summary.getAttribute('aria-expanded')).toBe('true')
    const detail = container.querySelector('[data-divergence-detail]')!
    // 每条腿各自的截至时刻：一条腿的「截至」不能替另一条腿作证。
    expect(detail.textContent).toContain(`${text.legs.stablecoin} ${text.chipAsOf.replace('{at}', '2026-10-30 10:00 GMT')}`)
    expect(detail.textContent).toContain(`${text.legs['open-interest']} ${text.chipAsOf.replace('{at}', '2026-10-30 11:00 GMT')}`)
    // 方向标签与机制句也只在展开区。
    expect(detail.querySelector('[data-direction="bearish"]')?.textContent).toContain(text.directions.bearish)
    expect(detail.textContent).toContain(text.pairs['liquidity-leverage'].mechanism)
    // 没判成的组排在最上面，组名 + 原因。
    expect(detail.textContent).toContain(text.pairNames['narrative-price'])
    expect(detail.textContent).toContain(sentimentReason)
    // 收起：焦点还在摘要行上（展开/收起不移动焦点）。
    await act(async () => { summary.click() })
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-divergence-detail]')).toBeNull()
    await act(async () => { root.unmount() })
  })

  it('calls the observed state by its neutral label, and its old sentences are gone', async () => {
    const { container, root } = await mount(answer([observedRow]))
    const summary = container.querySelector<HTMLButtonElement>('.mi-divergence__summary')!
    await act(async () => { summary.click() })
    const detail = container.querySelector('[data-divergence-detail]')!
    // 观察态挂的是中性标签，不是方向标签（「偏空」二字只作为那句中性话的一部分出现）。
    expect(detail.querySelector('[data-direction="unpriced"] .mi-divergence__direction')?.textContent).toBe(text.observedLabel)
    // 界面设计 2026-11-08 §九：旧两句字随实现同笔删，别让两套说法并存。
    expect(Object.keys(text.directions)).toEqual(['bearish', 'bullish'])
    expect('mechanism' in text.pairs['narrative-price']).toBe(false)
    await act(async () => { root.unmount() })
  })
})

describe('divergence panel · the states around the line', () => {
  it('shows only the loading state before the first read, without a summary', () => {
    const markup = render({ state: 'loading' })
    expect(markup).toContain(text.loading)
    expect(markup).not.toContain('mi-divergence__summary')
    expect(markup).not.toContain(text.summary.quiet)
  })

  it('keeps a failed read out of the summary line', () => {
    const markup = render({ state: 'unavailable', reason: 'query-failed', missing: [] })
    expect(markup).toContain(text.unavailableTrace)
    expect(markup).not.toContain('mi-divergence__summary')
  })

  it('renders the summary in the reader language', () => {
    const english = productText['en-US'].pages.intelligence.portal.dashboard.divergence
    const markup = render(answer([row]), 'en-US')
    expect(markup).toContain(english.summary.divergence)
    expect(markup).not.toContain(text.summary.divergence)
  })
})
