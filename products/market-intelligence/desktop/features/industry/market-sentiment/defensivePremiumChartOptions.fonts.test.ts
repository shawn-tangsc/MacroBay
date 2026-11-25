import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CHART_FONTS_FALLBACK, readChartFonts } from './defensivePremiumChartOptions'

/**
 * 图表字号的兜底值与 token 的绑定。
 *
 * ECharts 的 option 要**数字**，CSS 变量给的是 `12px` 这样的字符串，所以这里有一层
 * 「从宿主元素读变量、读不到退回常量」。退回的那两个数（12 / 11）**不进字号棘轮**——
 * 棘轮只数 `fontSize:` 内联与 CSS 声明，看不见一个普通对象里的值。这是形状的盲区，
 * 不是令牌化干净了，所以用这条用例把它们钉住：
 *
 * - token 改了而兜底没改 → 红（无样式表环境从此用另一个号出图）；
 * - 兜底改了而 token 没改 → 红（同一件事的另一半，改的人必须两边一起改）；
 * - 变量取不到时退回兜底、取得到时用变量 → 两条路径都要有用例。
 *
 * 阅读字号三档的唯一出处是 `platform/ui/tokens/tokens.css`，这里按文本读它，不重复写数——
 * 重复写一遍就等于又多一个「同一个数、两处各写」的地方。
 */
const TOKENS_CSS = readFileSync(resolve(process.cwd(), 'platform/ui/tokens/tokens.css'), 'utf8')
const THEME_BLOCKS = TOKENS_CSS.split(':root[data-theme="light"]')

function pixelToken(block: string, name: string): number | undefined {
  const match = block.match(new RegExp(`--${name}:\\s*([\\d.]+)px`))
  return match?.[1] === undefined ? undefined : Number.parseFloat(match[1])
}

function styleOf(values: Record<string, string>): CSSStyleDeclaration {
  return { getPropertyValue: (name: string) => values[name] ?? '' } as unknown as CSSStyleDeclaration
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chart font fallback', () => {
  it('keeps the no-stylesheet fallback equal to the reading tokens in both theme blocks', () => {
    expect(THEME_BLOCKS).toHaveLength(2)
    for (const block of THEME_BLOCKS) {
      expect(pixelToken(block, 'font-body')).toBe(CHART_FONTS_FALLBACK.body)
      expect(pixelToken(block, 'font-meta')).toBe(CHART_FONTS_FALLBACK.meta)
      // 仪表圆盘里的分数用 metric 档（24），不是把 body 乘二算出来的。
      expect(pixelToken(block, 'font-metric-sm')).toBe(CHART_FONTS_FALLBACK.metricSm)
    }
  })

  it('reads the size from the host element variables instead of the fallback', () => {
    vi.stubGlobal('getComputedStyle', () => styleOf({ '--font-body': '15px', '--font-meta': '13px', '--font-metric-sm': '28px' }))
    expect(readChartFonts({} as Element)).toEqual({ body: 15, meta: 13, metricSm: 28 })
  })

  it('falls back only when the variable is empty or unreadable', () => {
    vi.stubGlobal('getComputedStyle', () => styleOf({ '--font-body': '', '--font-meta': 'not-a-size', '--font-metric-sm': '' }))
    expect(readChartFonts({} as Element)).toEqual(CHART_FONTS_FALLBACK)
  })
})