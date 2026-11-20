// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'

import { EventDetailLayer } from './EventDetailLayer'

/**
 * 层级判据（用户 2026-11-17：同样一条详情，两个入口一上一下）。
 *
 * 根因不是「数字不够大」，是**挂载位置**：详情必须挂到 `document.body`。挂在带 `transform` 的
 * 抽屉里时，`transform` 产生层叠上下文，`position: fixed` 的子孙被锚在那一层，z-index 再大也
 * 只在抽屉内部比大小，永远压不过挂在 body 上的弹框。
 */
const css = readFileSync(resolve(process.cwd(),
  'products/market-intelligence/desktop/pages/intelligence/macroIndicatorDrawer.css'), 'utf8')

it('portals the detail to the body so no transformed ancestor can trap it', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<EventDetailLayer><p data-probe>详情</p></EventDetailLayer>))
    // 不在渲染宿主里，而在 body 上——这是「逃出 transform 祖先」的唯一办法。
    expect(host.querySelector('[data-probe]')).toBeNull()
    const layer = document.body.querySelector('[data-layer="detail"]')!
    expect(layer).not.toBeNull()
    expect(layer.className).toContain('mk-detail-overlay')
    expect(layer.textContent).toContain('详情')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('takes its z-index from one token, and the order is "later opened is higher"', () => {
  // 层级只有一组 token：弹框 1000（antd 默认）< 详情 1200 < 浮窗 1300。
  const modal = Number(/--mi-layer-modal:\s*(\d+)/u.exec(css)?.[1])
  const detail = Number(/--mi-layer-detail:\s*(\d+)/u.exec(css)?.[1])
  const floating = Number(/--mi-layer-floating:\s*(\d+)/u.exec(css)?.[1])
  expect(modal).toBe(1000)
  expect(detail).toBeGreaterThan(modal)
  expect(floating).toBeGreaterThan(detail)
  // 详情层**不许写死数字**：只认 token。
  expect(/\.mk-detail-overlay\s*\{[^}]*z-index:\s*var\(--mi-layer-detail\)/u.test(css)).toBe(true)
})
