// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../../shared/i18n/productText'
import {
  chartLinesHiddenBy,
  CrossAssetReturnChart,
  type CrossAssetChartLineId
} from './CrossAssetReturnChart'

const text = {
  ...productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset,
  // 面板在调用点补上宏观两条线的名字（真实调用点同样如此）。
  macroAssets: { dxy: '美元', gold: '黄金' }
}
const point = (at: string, returnPercent: number) => ({ at, returnPercent })
const curve = [point('2026-07-16T01:00:00.000Z', 0), point('2026-07-16T02:00:00.000Z', 0.4)]
const curves = { index: curve, btc: curve, eth: curve } as never
const macroCurves = { dxy: curve, gold: curve } as never

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function render(hiddenLines: readonly CrossAssetChartLineId[]) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      createElement(ShellTimeZoneProvider, {
        timeZone: 'UTC',
        children: createElement(CrossAssetReturnChart, {
          curves,
          macroCurves,
          hiddenLines,
          text
        } as never)
      })
    )
  })
  return host
}

describe('cross-asset chart follows the cells that feed it', () => {
  it('draws every line when no cell is off', () => {
    const host = render([])
    expect([...host.querySelectorAll('.mi-cross-asset__legend button')].map((button) => button.textContent)).toEqual([
      text.assets.index,
      text.assets.btc,
      text.assets.eth,
      text.macroAssets.dxy,
      text.macroAssets.gold
    ])
  })

  it('drops the line and its legend entry together, and keeps the others', () => {
    const host = render(['index'])
    expect(host.querySelector('[data-asset-line="index"]')).toBeNull()
    expect(host.querySelector('.mi-cross-asset__legend [data-asset="index"]')).toBeNull()
    expect(host.querySelector('[data-asset-line="btc"]')).not.toBeNull()
    expect(host.querySelector('[data-asset-line="eth"]')).not.toBeNull()
  })

  it('keeps a composite line while any cell behind it is still on', () => {
    // 美元那条线背后是主源 + 备用源两个格：只有两个都关掉才会出现在 `hiddenLines` 里。
    // 传进来的行 id 只有真正关掉的；这里钉两件事——线能按 id 去掉，映射不把非曲线行算进来。
    expect(chartLinesHiddenBy(['us10y', 'realRate'])).toEqual([])
    expect(chartLinesHiddenBy(['dxy'])).toEqual(['dxy'])
    const host = render(chartLinesHiddenBy(['dxy']))
    expect(host.querySelector('[data-asset-line="dxy"]')).toBeNull()
    expect(host.querySelector('[data-asset-line="gold"]')).not.toBeNull()
    expect(host.querySelector('[data-asset-line="index"]')).not.toBeNull()
  })
})
