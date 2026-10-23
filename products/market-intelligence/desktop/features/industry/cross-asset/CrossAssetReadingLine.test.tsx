// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'

import type { CrossAssetReading } from '../../../../contracts/crossAssetObservationContracts'
import { productText } from '../../../shared/i18n/productText'
import { CrossAssetReadingLine } from './CrossAssetReadingLine'

/**
 * 图下那条判读脚注（设计 142 §6，读者选 B1）。
 *
 * 这里钉三件读者会依赖的事：五句话说得出口、**ρ 只在 24H 出现**（它在别的窗口就是把两个周期混进一句话）、
 * 以及判不出来时**说清是哪条腿**而不是硬判。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
const reading = (overrides: Partial<CrossAssetReading> = {}): CrossAssetReading => ({
  state: 'judged', window: '24h', scenario: 'risk-off',
  legs: [
    { leg: 'dxy', direction: 'up', returnPercent: 0.42 }, { leg: 'gold', direction: 'up', returnPercent: 0.86 },
    { leg: 'index', direction: 'down', returnPercent: -1.12 }, { leg: 'btc', direction: 'down', returnPercent: -1.84 }
  ],
  refuted: [{ scenario: 'discount-rate', leg: 'gold' }],
  correlation: { state: 'available', value: 0.68, sampleCount: 288, expectedCount: 288, window: '24h', interval: '5m' },
  relativeReturns: { btcMinusIndex: -0.72, ethMinusBtc: -0.47 }, notices: [],
  ...overrides
} as CrossAssetReading)

/** 组件的其余测试都用真实挂载；这里同样，避免把断言建立在另一套渲染器上。 */
async function host(value: CrossAssetReading): Promise<HTMLDivElement> {
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  await act(async () => root.render(createElement(CrossAssetReadingLine, { reading: value, text })))
  return element
}

it('says the verdict in plain words, with the scenario the reader would name', async () => {
  const body = await host(reading())
  expect(body.querySelector('[data-reading-scenario]')?.textContent)
    .toBe(`${text.reading.verdict.split('{scenario}')[0]}${text.reading.scenarios['risk-off']}${text.reading.verdict.split('{scenario}')[1].split('{story}')[0]}${text.reading.stories['risk-off']}`)
  expect(body.querySelector('[data-reading-scenario]')?.textContent).toContain('美元和黄金被买')
})

it('names the leg that does not fit, with its own number', async () => {
  const item = (await host(reading())).querySelector('[data-reading-refuted="discount-rate"]')
  expect(item?.textContent).toContain(text.reading.scenarios['discount-rate'])
  expect(item?.textContent).toContain(text.reading.legs.gold)
  // 方向已经由「涨了」说出来，数字不再带符号（评审 ⑤）。
  expect(item?.textContent).toContain('0.86%')
  expect(item?.textContent).not.toContain('+0.86%')
})

it('carries the correlation with its own horizon, and says when there is no backing', async () => {
  const backed = (await host(reading())).querySelector('[data-reading-correlation]')
  expect(backed?.textContent).toBe('ρ 0.68 · 24h·5m · 288/288')
  const unbacked = (await host(reading({ correlation: { state: 'unavailable', reason: 'insufficient' } } as never))).querySelector('[data-reading-correlation]')
  expect(unbacked?.textContent).toBe(text.reading.correlationUnavailable)
})

it('says what the legs were substituted with', async () => {
  expect((await host(reading({ notices: ['index-proxy'] }))).querySelector('[data-reading-notice="index-proxy"]')?.textContent)
    .toBe(text.reading.notices['index-proxy'])
})

it('refuses outside 24h, and shows no correlation beside a window it does not belong to', async () => {
  // ρ 恒为 24h·5m：放在 1H/7D 判读旁边就是混周期，所以这里连它都不显示。
  const body = await host({ state: 'undetermined', reason: 'window-not-judged', refuted: [] })
  expect(body.querySelector('[data-reading-reason="window-not-judged"]')?.textContent).toBe(text.reading.undetermined['window-not-judged'])
  expect(body.querySelector('[data-reading-correlation]')).toBeNull()
})

it('refuses with the leg named when a leg has no value, and when none fits', async () => {
  const missing = await host({ state: 'undetermined', reason: 'legs-missing', leg: 'gold', refuted: [] })
  expect(missing.querySelector('[data-reading-reason="legs-missing"]')?.textContent).toContain(text.reading.legs.gold)
  const stale = await host({ state: 'undetermined', reason: 'stale', leg: 'btc', refuted: [] })
  expect(stale.querySelector('[data-reading-reason="stale"]')?.textContent).toContain(text.reading.legs.btc)
  const noMatch = await host({ state: 'undetermined', reason: 'no-match', refuted: [{ scenario: 'risk-on', leg: 'dxy' }] })
  expect(noMatch.querySelector('[data-reading-reason="no-match"]')?.textContent).toBe(text.reading.undetermined['no-match'])
  // 认不出组合时要说清**最接近**的剧本与**是哪条腿没走成**：只点名字读起来像半句话（读者 10-16 反馈）。
  const nearest = noMatch.querySelector('[data-reading-nearest="risk-on"]')?.textContent ?? ''
  expect(nearest).toContain(text.reading.scenarios['risk-on'])
  expect(nearest).toContain(text.reading.legs.dxy)
  expect(noMatch.querySelector('[data-reading-refuted]')).toBeNull()
})

it('describes what the legs actually did when no scenario fits, instead of only saying it cannot tell', async () => {
  const leg = (id: string, direction: string, returnPercent: number) => ({ leg: id, direction, returnPercent })
  // 四条腿都在平常波动里（读者 2026-10-16 的那一屏）：说明"没有东西在推"，而不是"我不知道"。
  const none = await host({ state: 'undetermined', reason: 'no-match', refuted: [], legs: [
    leg('dxy', 'flat', -0.01), leg('gold', 'flat', 0.27), leg('index', 'flat', 0.21), leg('btc', 'flat', 0.54)] } as never)
  expect(none.querySelector('[data-reading-fallback="0"]')?.textContent).toBe(text.reading.noDriverNone)
  // 只有一条在走：把它连名字带幅度说出来（方向短语里已经含幅度，不再重复）。
  const one = await host({ state: 'undetermined', reason: 'no-match', refuted: [], legs: [
    leg('dxy', 'flat', -0.01), leg('gold', 'flat', 0.27), leg('index', 'up', 0.52), leg('btc', 'flat', 0.54)] } as never)
  const oneText = one.querySelector('[data-reading-fallback="1"]')?.textContent ?? ''
  expect(oneText).toContain(text.reading.legs.index)
  expect(oneText).toContain('0.52%')
  // 有几条各自在走：列出明细。
  const several = await host({ state: 'undetermined', reason: 'no-match', refuted: [], legs: [
    leg('dxy', 'down', -0.35), leg('gold', 'flat', 0.27), leg('index', 'up', 0.60), leg('btc', 'down', -1.60)] } as never)
  const severalText = several.querySelector('[data-reading-fallback="3"]')?.textContent ?? ''
  expect(severalText).toContain(text.reading.legs.dxy)
  expect(severalText).toContain('0.35%')
  expect(severalText).toContain('0.60%')
  // 没有腿集可描述时（缺腿/停更/非 24H）不编：不渲染兜底描述。
  const noLegs = await host({ state: 'undetermined', reason: 'window-not-judged', refuted: [] })
  expect(noLegs.querySelector('[data-reading-fallback]')).toBeNull()
})

it('is one footnote spanning the panel, not a card, and the correlation closes it at the right edge', async () => {
  // happy-dom 没有版面：几何只能断言成 CSS 规则与 DOM 顺序（设计 142 §7.11）。
  const css = readFileSync('products/market-intelligence/desktop/features/industry/cross-asset/CrossAssetObservationPanel.css', 'utf8')
  const rule = css.slice(css.indexOf('.mi-cross-asset__reading {')).split('}')[0]!
  expect(rule).toContain('grid-column: 1 / -1')
  expect(rule).toContain('border-top: 1px solid var(--mi-cross-asset-line)')
  expect(rule).not.toContain('border-radius')
  expect(rule).not.toContain('background')
  const correlation = css.slice(css.indexOf('.mi-cross-asset__reading-correlation')).split('}')[0]!
  expect(correlation).toContain('margin-left: auto')
  // 顺序就是 DOM 顺序：这块不再用 order 覆盖，否则"看起来的顺序"会和读屏/测试看到的顺序不一致（评审 ②）。
  expect(rule).not.toContain('order:')
  expect(css).not.toContain('.mi-cross-asset__reading-verdict { order:')
  expect(css).not.toContain('[data-reading-notice] { order:')
  // 原型里的强调：剧本名带强调色，而强调色必须是命名的 token（本文件不许出现字面色值）。
  const emphasis = css.slice(css.indexOf('.mi-cross-asset__reading-verdict b')).split('}')[0]!
  expect(emphasis).toContain('color: var(--mi-cross-asset-accent)')
  expect(css).toContain('--mi-cross-asset-accent: var(--mi-dashboard-lime)')
  expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  const body = await host(reading())
  const section = body.querySelector('[data-cross-asset-region="reading"]')
  expect(section?.tagName).toBe('SECTION')
  expect([...section!.children].map(child => child.className))
    .toEqual(['', 'mi-cross-asset__reading-verdict', 'mi-cross-asset__reading-refuted', 'mi-cross-asset__reading-relative', 'mi-cross-asset__reading-correlation'])
})

it('keeps every word in the product text, so no sentence is baked into the component', () => {
  const source = readFileSync('products/market-intelligence/desktop/features/industry/cross-asset/CrossAssetReadingLine.tsx', 'utf8')
  // The component may not contain Chinese literals: the copy lives in `productText`, both locales.
  expect(source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).not.toMatch(/[\u4e00-\u9fa5]/)
})
