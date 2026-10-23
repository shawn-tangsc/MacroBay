// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CrossAssetReturnChart } from './CrossAssetReturnChart'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

/** 展示时区由窗口级 provider 提供；测试固定 UTC，断言才与宿主时区无关。 */
const ScopedCrossAssetReturnChart = (props: Parameters<typeof CrossAssetReturnChart>[0]): React.ReactElement =>
  createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(CrossAssetReturnChart, props))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const points = [0, 1, 2].map(index => ({ at: `2026-09-14T12:${String(index * 5).padStart(2, '0')}:00.000Z`, returnPercent: index }))
const text = {
  chart: '收益率', assets: { index: '纳斯达克 100', btc: 'BTC', eth: 'ETH' },
  macroAssets: { dxy: '美元 DXY', gold: '黄金 XAU' }, noData: '无数据', forming: '实时未闭合',
  eventLine: '事件', eventsCollapsed: '已折叠 {count} 条'
}
describe('cross-asset return chart', () => {
  it('keeps solid lines and forming dots without persistent labels, and inspects the tail with the keyboard', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetReturnChart, { text, curves: { index: points, btc: points, eth: points }, forming: { index: { at: '2026-09-14T12:15:00.000Z', returnPercent: 1.5 } } })))
      expect([...host.querySelectorAll('[data-asset-line]')].every(path => !path.hasAttribute('stroke-dasharray'))).toBe(true)
      expect(host.querySelector('[data-forming-line] circle')).not.toBeNull()
      expect(host.querySelector('[data-forming-line] title')?.textContent).toBe(text.forming)
      expect(host.querySelector('[data-end-label]')).toBeNull()
      expect(host.querySelector('[data-cross-asset-plot] button')).toBeNull()
      const plot = host.querySelector<HTMLElement>('[data-cross-asset-plot]')!
      plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 } as DOMRect)
      await act(async () => plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
      expect(host.querySelector('[role="tooltip"]')?.textContent).toContain('2026-09-14 12:15:00 GMT')
      expect(host.querySelector('[role="tooltip"]')?.textContent).toContain('+1.50%')
      expect(host.querySelector<HTMLElement>('[data-crosshair]')?.style.left).toBe('100%')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
  it('draws the dollar and gold beside the crypto rows, and never hides the last line standing', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const macroCurves = { dxy: points.map((point, index) => ({ ...point, returnPercent: index - 1 })), gold: points }
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetReturnChart, { text, curves: { index: points, btc: points, eth: points }, macroCurves })))

      // Five lines, the two macro references named exactly as the 市场状态 rows beside them are.
      const legend = [...host.querySelectorAll('[data-asset]')].map(button => button.textContent)
      expect(legend).toEqual(['纳斯达克 100', 'BTC', 'ETH', '美元 DXY', '黄金 XAU'])
      expect([...host.querySelectorAll('[data-asset-line]')].map(path => path.getAttribute('data-asset-line')))
        .toEqual(['index', 'btc', 'eth', 'dxy', 'gold'])
      // The macro legs publish closes, not streams: no live tail is drawn for them.
      expect(host.querySelector('[data-forming-line="dxy"]')).toBeNull()

      // Hiding one line leaves the others, and the last one standing cannot be hidden.
      await act(async () => host.querySelector<HTMLElement>('[data-asset="dxy"]')?.click())
      expect(host.querySelector('[data-asset-line="dxy"]')).toBeNull()
      expect(host.querySelector('[data-asset="dxy"]')?.getAttribute('aria-pressed')).toBe('false')
      expect(host.querySelector('[data-asset-line="gold"]')).not.toBeNull()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('draws three lines when the wire carries no macro curves', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetReturnChart, { text, curves: { index: points, btc: points, eth: points } })))
      expect([...host.querySelectorAll('[data-asset]')].map(button => button.textContent)).toEqual(['纳斯达克 100', 'BTC', 'ETH'])
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('inspects each genuine forming timestamp without filling other assets', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetReturnChart, { text, curves: { index: points, btc: points, eth: points }, forming: {
        index: { at: '2026-09-14T12:11:01.123Z', returnPercent: 2 },
        btc: { at: '2026-09-14T12:12:02.456Z', returnPercent: 2 },
        eth: { at: '2026-09-14T12:13:03.789Z', returnPercent: 2 }
      } })))
      const plot = host.querySelector<HTMLElement>('[data-cross-asset-plot]')!
      plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 180 } as DOMRect)
      await act(async () => plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
      let tooltip = host.querySelector<HTMLElement>('[role="tooltip"]')!
      expect(tooltip.textContent).toContain('12:13:03 GMT')
      expect(tooltip.textContent).toContain(text.forming)
      expect(tooltip.querySelector('[data-asset="eth"]')?.textContent).toContain('+2.00%')
      expect(tooltip.querySelector('[data-asset="btc"]')?.textContent).toContain(text.noData)
      expect(parseFloat(tooltip.style.left)).toBeLessThanOrEqual(182)
      await act(async () => plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
      tooltip = host.querySelector<HTMLElement>('[role="tooltip"]')!
      expect(tooltip.textContent).toContain('12:12:02 GMT')
      await act(async () => plot.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 0, bubbles: true })))
      expect(host.querySelector('[role="tooltip"]')?.textContent).toContain('12:13:03 GMT')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
  it('does not round a nonzero return to a false zero and uses themed controls', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const small = points.map(point => ({ ...point, returnPercent: .001 }))
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetReturnChart, { text, curves: { index: small, btc: small, eth: small } })))
      expect(host.textContent).toContain('+<0.01%')
      expect(host.textContent).not.toContain('+0.00%')
      expect(host.querySelectorAll('.ant-btn[aria-pressed]')).toHaveLength(3)
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('renders all asset lines, preserves gaps and keeps at least one legend visible', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetReturnChart, { text, curves: { index: points, btc: points.map((point, index) => ({ ...point, returnPercent: index === 1 ? null : point.returnPercent })), eth: points } })))
      expect(host.querySelectorAll('[data-asset-line]')).toHaveLength(3)
      expect([...host.querySelectorAll('[data-asset-line]')].every(path => !path.hasAttribute('stroke-dasharray'))).toBe(true)
      expect(host.querySelector('[data-asset-line="btc"]')?.getAttribute('d')?.match(/M/g)).toHaveLength(2)
      const buttons = [...host.querySelectorAll<HTMLButtonElement>('[aria-pressed]')]
      await act(async () => { buttons[0].click(); buttons[1].click() })
      expect(buttons[2].disabled).toBe(true)
      expect(host.textContent).toContain('2026-09-14')
      expect(host.textContent).toContain('GMT')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('clamps a right-edge tooltip while keeping the crosshair on the actual row and supports keyboard inspection', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetReturnChart, { text, curves: { index: points, btc: points, eth: points } })))
      const plot = host.querySelector<HTMLElement>('[data-cross-asset-plot]')!
      plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 } as DOMRect)
      await act(async () => plot.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 199, bubbles: true })))
      expect(host.querySelector<HTMLElement>('[data-crosshair]')?.style.left).toBe('100%')
      const tooltip = host.querySelector<HTMLElement>('[role="tooltip"]')!
      expect(parseFloat(tooltip.style.left)).toBeLessThanOrEqual(182)
      expect(parseFloat(tooltip.style.top)).toBeLessThanOrEqual(64)
      expect(tooltip.textContent).toContain('12:10')
      await act(async () => plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
      expect(host.querySelector('[role="tooltip"]')?.textContent).toContain('12:05')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('keeps every sample across the entire plot with no reserved label area', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetReturnChart, { text, curves: { index: points, btc: points, eth: points } })))
      const plot = host.querySelector<HTMLElement>('[data-cross-asset-plot]')!
      plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 } as DOMRect)
      const path = host.querySelector('[data-asset-line="index"]')!.getAttribute('d')!
      const coordinates = [...path.matchAll(/[ML]([\d.]+),/g)].map(match => Number(match[1]) / 1000 * 400)
      expect(coordinates).toEqual([0, 200, 400])
      expect([...host.querySelectorAll<HTMLElement>('.mi-cross-asset__ticks time')].map(tick => tick.style.left)).toEqual(['0%', '50%', '100%'])
      await act(async () => plot.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, bubbles: true })))
      expect(host.querySelector('[role="tooltip"]')?.textContent).toContain('12:05')
      await act(async () => plot.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, bubbles: true })))
      expect(host.querySelector('[role="tooltip"]')?.textContent).toContain('12:10')
      expect(host.querySelector<HTMLElement>('[data-crosshair]')?.style.left).toBe('100%')
      expect(host.querySelector('[data-end-label]')).toBeNull()
      await act(async () => plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
      expect(host.querySelector('[role="tooltip"]')?.textContent).toContain('12:00')
      await act(async () => plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
      expect(host.querySelector('[role="tooltip"]')?.textContent).toContain('12:05')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('gives edge ticks a bounded label box instead of shrink-to-fit width', () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      act(() => root.render(createElement(ScopedCrossAssetReturnChart, { text, curves: { index: points, btc: points, eth: points } })))
      const ticks = [...host.querySelectorAll<HTMLElement>('.mi-cross-asset__ticks time')]
      expect(ticks).toHaveLength(3)
      expect(ticks.map(tick => tick.style.left)).toEqual(['0%', '50%', '100%'])
      expect(ticks.at(-1)?.textContent).toContain('12:10')
    } finally { act(() => root.unmount()); host.remove() }
  })

  it('protects the production tick width rule against max-width-only regression', () => {
    const css = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/industry/cross-asset/CrossAssetObservationPanel.css'), 'utf8')
    const rule = css.match(/\.mi-cross-asset__ticks time\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toContain('box-sizing: border-box')
    expect(rule).toContain('width: calc(100% / var(--mi-cross-asset-tick-count))')
    expect(rule).not.toContain('max-width:')
  })

  it('does not right-anchor a closed tick that is left of a late forming tail', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const short = points.slice(0, 2)
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetReturnChart, { text, curves: { index: short, btc: short, eth: short }, forming: { index: { at: '2026-09-14T13:03:03.789Z', returnPercent: 3 } } })))
      const ticks = [...host.querySelectorAll<HTMLElement>('.mi-cross-asset__ticks time')]
      expect(ticks.length).toBeLessThan(2)
      expect(ticks.every(tick => tick.style.transform !== 'translateX(-100%)')).toBe(true)
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it.each([1, 2])('maps %s closed samples and the actual closed tick independently of a later forming point', async count => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const short = points.slice(0, count)
    try {
      await act(async () => root.render(createElement(ScopedCrossAssetReturnChart, { text, curves: { index: short, btc: short, eth: short } })))
      expect(host.querySelector('[data-asset-line="index"]')?.getAttribute('d')).toContain(count === 1 ? 'M500,' : 'L1000,')
      await act(async () => root.render(createElement(ScopedCrossAssetReturnChart, { text, curves: { index: short, btc: short, eth: short }, forming: { index: { at: points[2].at, returnPercent: 3 } } })))
      expect(host.querySelector('[data-forming-line="index"] circle')?.getAttribute('cx')).toBe('1000')
      const ticks = [...host.querySelectorAll<HTMLElement>('.mi-cross-asset__ticks time')]
      expect(ticks.at(-1)?.style.left).toBe(count === 1 ? '0%' : '50%')
      expect(ticks.at(-1)?.textContent).toContain(count === 1 ? '12:00' : '12:05')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
