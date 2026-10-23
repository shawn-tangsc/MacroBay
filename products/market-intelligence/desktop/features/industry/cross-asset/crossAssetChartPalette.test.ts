import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 同起点收益率那张图的**五条线必须两两分得清**。
 *
 * 读者 2026-10-16 的原话：「btc 和黄金颜色怎么一样的，要区分一下」——当时 BTC 是 `#e5ae43`（琥珀）、
 * 黄金是 `#d8b45a`（暗一点的琥珀）：色相差 3°、明度差 2 个百分点，1.6px 的线宽上就是同一条线。
 *
 * 所以调色板有一份**唯一 owner**（`cryptoDashboard.css` 的 `--mi-dashboard-chart-*`），并且这一条
 * 测试按数值断言"分得清"：任两条线只要色相、明度、饱和度三项都靠得太近，这里就红。谁以后再调颜色，
 * 先过这一关。
 *
 * happy-dom 算不出真实渲染颜色，所以这里读的是样式源码——它正是这几条线颜色的 owner。
 */
const palettePolicy = Object.freeze({
  /** 色相差（度）到这个数就算分得清。 */
  minimumHueSeparationDegrees: 18,
  /** 或者明度差（百分点）到这个数：一深一浅的琥珀在 1.6px 上也是两条线。 */
  minimumLightnessSeparation: 18,
  /** 或者饱和度差（百分点）：饱和的琥珀 vs 灰扑扑的沙金。 */
  minimumSaturationSeparation: 25
})

/** 五条线的名字：三条加密 + 两条宏观参照，顺序与图例一致。 */
const lineIds = ['qqq', 'btc', 'eth', 'dxy', 'gold'] as const
/** 面板自己那五个名字（第一条在资产那边叫 `index`，在调色板里叫 `qqq`）。 */
const panelIds = ['index', 'btc', 'eth', 'dxy', 'gold'] as const

const css = (path: string): string => readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop', path), 'utf8')

/** `--mi-dashboard-chart-btc: #e5ae43;` → `#e5ae43` */
function tokenValue(source: string, name: string): string | undefined {
  return new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(source)?.[1]?.toLowerCase()
}

type Hsl = Readonly<{ hue: number; lightness: number; saturation: number }>

function hsl(hex: string): Hsl {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16) / 255) as [number, number, number]
  const [red, green, blue] = channels
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { hue: 0, lightness: lightness * 100, saturation: 0 }
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  const raw = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4
  return { hue: (raw * 60 + 360) % 360, lightness: lightness * 100, saturation: saturation * 100 }
}

function separation(left: Hsl, right: Hsl): Readonly<{ hue: number; lightness: number; saturation: number }> {
  const delta = Math.abs(left.hue - right.hue)
  return {
    hue: Math.min(delta, 360 - delta),
    lightness: Math.abs(left.lightness - right.lightness),
    saturation: Math.abs(left.saturation - right.saturation)
  }
}

function distinguishable(left: Hsl, right: Hsl): boolean {
  const gap = separation(left, right)
  return gap.hue >= palettePolicy.minimumHueSeparationDegrees ||
    gap.lightness >= palettePolicy.minimumLightnessSeparation ||
    gap.saturation >= palettePolicy.minimumSaturationSeparation
}

const dashboard = css('pages/intelligence/cryptoDashboard.css')
const panel = css('features/industry/cross-asset/CrossAssetObservationPanel.css')

describe('the same-anchor chart palette', () => {
  it('owns one explicit colour per line, and the panel names those and nothing else', () => {
    const colors = lineIds.map(id => tokenValue(dashboard, `--mi-dashboard-chart-${id}`))
    for (const [index, id] of lineIds.entries()) {
      expect(colors[index], `--mi-dashboard-chart-${id} must exist in cryptoDashboard.css`).toMatch(/^#[0-9a-f]{6}$/)
    }
    // 五个值互不相同：两个名字指向同一个颜色，等于图上还是同一条线。
    expect(new Set(colors).size).toBe(lineIds.length)
    // 面板只**命名**它们：`--mi-cross-asset-*` 一律映射到那份调色板，不允许就地写一个颜色。
    const panelTokens = [...panel.matchAll(/--mi-cross-asset-(index|btc|eth|dxy|gold):\s*var\((--mi-dashboard-chart-[a-z]+)\)/g)]
    expect(panelTokens.map(match => `${match[1]}→${match[2]}`)).toEqual(panelIds.map((id, index) => `${id}→--mi-dashboard-chart-${lineIds[index]}`))
  })

  it('keeps every pair of lines visually apart (hue, lightness or saturation)', () => {
    const measured = new Map(lineIds.map(id => [id, hsl(tokenValue(dashboard, `--mi-dashboard-chart-${id}`)!)]))
    const collisions: string[] = []
    for (const [index, left] of lineIds.entries()) {
      for (const right of lineIds.slice(index + 1)) {
        const gap = separation(measured.get(left)!, measured.get(right)!)
        if (!distinguishable(measured.get(left)!, measured.get(right)!)) {
          collisions.push(`${left}/${right}: 色相 ${gap.hue.toFixed(1)}° · 明度 ${gap.lightness.toFixed(1)}pp · 饱和度 ${gap.saturation.toFixed(1)}pp`)
        }
      }
    }
    expect(collisions, `两条线在图上分不开：\n${collisions.join('\n')}`).toEqual([])
  })

  it('states the rule it enforces, so a future colour change knows what it is up against', () => {
    expect(palettePolicy.minimumHueSeparationDegrees).toBe(18)
    expect(palettePolicy.minimumLightnessSeparation).toBe(18)
    expect(palettePolicy.minimumSaturationSeparation).toBe(25)
    // BTC 是饱和的琥珀，黄金是淡得多的一档：这一对就是读者指出的那次撞色。
    const btc = hsl(tokenValue(dashboard, '--mi-dashboard-chart-btc')!)
    const gold = hsl(tokenValue(dashboard, '--mi-dashboard-chart-gold')!)
    expect(separation(btc, gold).lightness).toBeGreaterThanOrEqual(palettePolicy.minimumLightnessSeparation)
  })
})
