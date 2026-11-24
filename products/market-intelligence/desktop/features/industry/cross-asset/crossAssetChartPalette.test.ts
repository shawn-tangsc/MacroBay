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

/**
 * 浅色那一套是**对比度缺陷的修复**，不是另一个配色稿：深色五条线在白底只有 1.29–2.75:1，
 * 非文字要求 3:1，cream 那条几乎看不见（同起点收益率那张图今天同样中招）。
 *
 * 所以这里断言三件事：浅色确实重定义了全部五条；每一条对白底都过 3:1；3M 与 30Y 靠明度分开
 * ——两个都取中间值会在 1.6px 的线上撞成同一条（界面设计第一稿的毛病）。
 */
describe('chart palette in light theme', () => {
  const lightBlock = (() => {
    const source = css('pages/intelligence/cryptoDashboard.css')
    const start = source.indexOf(":root[data-theme='light'] .mi-crypto-dashboard {")
    expect(start).toBeGreaterThanOrEqual(0)
    return source.slice(start, source.indexOf('}', start))
  })()

  /**
   * 比的是**画在什么底上**：`--surface` 的浅色值住在平台壳的样式表里，不在这里抄一份 #ffffff。
   * 抄一份的话，浅色底哪天改成灰的，这几条线仍然按白底算分——算出来的绿是假的。
   */
  const surface = (() => {
    const source = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
    const block = /:root\[data-theme=['"]light['"]\]\s*\{([^}]*)\}/.exec(source)?.[1]
    expect(block, '壳样式表里要能找到 :root[data-theme="light"] 那一块').toBeTruthy()
    const value = /--surface:\s*(#[0-9a-fA-F]{6})/.exec(block!)?.[1]?.toLowerCase()
    expect(value, '浅色 --surface 必须是一个六位十六进制色').toMatch(/^#[0-9a-f]{6}$/)
    return value!
  })()

  const luminance = (hex: string): number => {
    const channels = [0, 2, 4].map((index) => Number.parseInt(hex.replace('#', '').slice(index, index + 2), 16) / 255)
    return channels
      .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
  }
  /** 对比度按两条亮度算，底是读到的 `--surface`，不是写死的白。 */
  const contrastOnSurface = (hex: string): number => {
    const [high, low] = [luminance(hex), luminance(surface)].sort((left, right) => right - left) as [number, number]
    return (high + 0.05) / (low + 0.05)
  }

  it('redefines every line, each at least 3:1 on the light surface', () => {
    const light = lineIds.map((id) => tokenValue(lightBlock, `--mi-dashboard-chart-${id}`))
    for (const [index, value] of light.entries()) {
      expect(value, `${lineIds[index]} 在浅色下没有重映射`).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrastOnSurface(value!), `${lineIds[index]} ${value} 对浅色底 ${surface} 不足 3:1`).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps 3M and 30Y apart by brightness, not by a hue nobody can see at 1.6px', () => {
    // 浅色照抄深色那套「一亮一暗」的关系：一个 4.90:1、一个 8.93:1（差 1.8 倍）。
    // 判据用对比度差，不用 HSL 明度差——取中间值时两条线的对比度会落到同一档，那才是撞成一条线的条件。
    const threeMonth = contrastOnSurface(tokenValue(lightBlock, '--mi-dashboard-chart-gold')!)
    const thirtyYear = contrastOnSurface(tokenValue(lightBlock, '--mi-dashboard-chart-btc')!)
    const [bright, dark] = threeMonth < thirtyYear ? [threeMonth, thirtyYear] : [thirtyYear, threeMonth]
    expect(dark / bright).toBeGreaterThanOrEqual(1.7)
  })

  it('still keeps all five lines distinguishable from each other in light', () => {
    const colors = lineIds.map((id) => hsl(tokenValue(lightBlock, `--mi-dashboard-chart-${id}`)!))
    for (let left = 0; left < colors.length; left += 1) {
      for (let right = left + 1; right < colors.length; right += 1) {
        const gap = separation(colors[left]!, colors[right]!)
        // 浅色下多一条判据：对比度差 ≥ 2（一个 4.9:1、一个 8.9:1 的两条线，在 1.6px 上不会看成一件事）。
        const contrastGap = Math.abs(
          contrastOnSurface(tokenValue(lightBlock, `--mi-dashboard-chart-${lineIds[left]}`)!) -
          contrastOnSurface(tokenValue(lightBlock, `--mi-dashboard-chart-${lineIds[right]}`)!)
        )
        expect(
          gap.hue >= palettePolicy.minimumHueSeparationDegrees ||
          gap.lightness >= palettePolicy.minimumLightnessSeparation ||
          gap.saturation >= palettePolicy.minimumSaturationSeparation ||
          contrastGap >= 2,
          `${lineIds[left]} 与 ${lineIds[right]} 在浅色下分不清：${JSON.stringify({ ...gap, contrastGap })}`
        ).toBe(true)
      }
    }
  })
})
