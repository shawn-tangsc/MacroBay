// @vitest-environment happy-dom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { PositioningPanel } from './PositioningPanel'

import type { DashboardFundingRateHistoryState } from '../../../pages/intelligence/dashboardFundingRateHistoryModel'
import type { DashboardPositioningViewState } from '../../../pages/intelligence/dashboardOpenInterestModel'

/**
 * 图必须按**量到的像素**画（用户 2026-11-24）：量到的框就是坐标系，svg 不再靠 viewBox 缩放整幅。
 *
 * happy-dom 没有排版，宽高一律 0；这里只给 `.mi-positioning-panel__chart-body` 报一个尺寸，
 * 等于替浏览器回答 ResizeObserver 会答的那个数。断言取的是宽度相关的量（绘图区右缘、svg 宽高），
 * 兜底那套 1000 宽的坐标系在这里是 992 / 没有 width 属性，一眼能分开。
 */
const measured = (width: number, height: number): void => {
  const sizeOf = (node: Element): number => node.classList.contains('mi-positioning-panel__chart-body') ? 0 : -1
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) { return sizeOf(this) === 0 ? width : 0 }
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) { return sizeOf(this) === 0 ? height : 0 }
  })
}

const at = (minutesAgo: number): string => new Date(Date.UTC(2026, 9, 29, 0, 0) - minutesAgo * 60_000).toISOString()

const funding: DashboardFundingRateHistoryState = {
  state: 'available',
  btc: [8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: 0.0062, paymentDirection: 'long-pays-short' as const })),
  eth: [8, 0].map(hours => ({ observedAt: at(hours * 60), ratePercent: -0.0031, paymentDirection: 'short-pays-long' as const }))
}

const positioning: DashboardPositioningViewState = {
  state: 'available',
  window: '24h',
  btc: [at(120), at(0)].map((observedAt, index) => ({ observedAt, notionalUsd: 8.9e9 - index * 1e7 })),
  eth: [at(120), at(0)].map((observedAt, index) => ({ observedAt, notionalUsd: 2.4e9 + index * 1e7 })),
  hints: [],
  hiddenHits: 0,
  signal: { state: 'hidden' },
  onReload: () => undefined
}

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.positioning
const roots: ReturnType<typeof createRoot>[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => { root.unmount() })
  document.body.innerHTML = ''
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
})

describe('the chart is drawn in measured pixels', () => {
  it('uses the measured box as the coordinate system instead of a 1000-wide canvas', async () => {
    measured(600, 210)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: createElement(PositioningPanel, {
        funding, positioning, window: '24h', onWindowChange: () => undefined, text
      }) }))
    })
    const svg = container.querySelector('.mi-positioning-panel__chart svg')!
    expect(svg).not.toBeNull()
    // svg 的宽高就是量到的像素：没有 viewBox，就没有「整幅等比缩小」。
    expect(svg.getAttribute('width')).toBe('600')
    expect(svg.getAttribute('height')).toBe('210')
    expect(svg.hasAttribute('viewBox')).toBe(false)
    // 绘图区右缘 = 600 − 8；兜底那套会是 992，这条能分开两条路。
    expect(svg.querySelector('.mi-positioning-panel__zero')!.getAttribute('x2')).toBe('592')
  })
})