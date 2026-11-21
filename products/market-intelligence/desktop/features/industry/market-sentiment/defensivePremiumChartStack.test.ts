import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { GaugeChart, LineChart } from 'echarts/charts'
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

import { CHART_MODULES } from './DefensivePremiumCharts'
import { CHART_PALETTE_FIXTURE } from './defensivePremiumChartPalette.fixture'

const root = process.cwd()
const OPTIONS_FILE = 'products/market-intelligence/desktop/features/industry/market-sentiment/defensivePremiumChartOptions.ts'
const CHARTS_FILE = 'products/market-intelligence/desktop/features/industry/market-sentiment/DefensivePremiumCharts.tsx'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    // 用例文件要 import 模块本体来比身份，不算「运行时引用面」。
    if (/\.test\.(ts|tsx)$/.test(entry)) return []
    return /\.(ts|tsx)$/.test(entry) ? [full] : []
  })
}

/** 仓库里所有 `echarts` 的 import / require（只认代码行，不认注释与字符串断言）。 */
function echartsImporters(): string[] {
  const roots = ['apps', 'platform', 'products'].map(name => resolve(root, name))
  const hit = new Set<string>()
  for (const directory of roots) {
    for (const file of sourceFiles(directory)) {
      const source = readFileSync(file, 'utf8')
      for (const line of source.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue
        // 整包 `from 'echarts'` 与子路径 `echarts/xxx` 都算；`import type` 也算（类型面同样只许这两处）。
        if (/\bfrom\s+['"]echarts(\/[a-z-]+)?['"]/.test(line) || /\brequire\(\s*['"]echarts(\/[a-z-]+)?['"]\s*\)/.test(line)) {
          hit.add(file.slice(root.length + 1))
        }
      }
    }
  }
  return [...hit].sort()
}

describe('the chart stack of this card', () => {
  it('imports echarts from exactly these two files', () => {
    // 第二个引用文件出现即判失败：这个依赖只服务这张卡。
    expect(echartsImporters()).toEqual([CHARTS_FILE, OPTIONS_FILE].sort())
  })

  it('never imports the whole package', () => {
    for (const file of [CHARTS_FILE, OPTIONS_FILE]) {
      const source = readFileSync(resolve(root, file), 'utf8')
      // 整包入口（不带子路径）一个都不许有：`echarts/core` 之类是具名入口。
      expect(source, file).not.toMatch(/from\s+['"]echarts['"]/)
      expect(source, file).not.toMatch(/import \* as echarts from ['"]echarts['"]/)
    }
    // 组件里用的是四个具名入口（core / charts / components / renderers）。
    expect(readFileSync(resolve(root, CHARTS_FILE), 'utf8')).toContain("from 'echarts/core'")
  })

  it('registers exactly these six modules', () => {
    // 多注册一个、少注册一个、换个顺序都会红：这就是「按需注册没退化」的判据。
    expect(CHART_MODULES).toHaveLength(6)
    expect([...CHART_MODULES]).toEqual([
      LineChart, GaugeChart, GridComponent, TooltipComponent, MarkLineComponent, SVGRenderer
    ])
  })

  it('keeps no colour literal in the option module', () => {
    // 颜色只从宿主的 CSS 变量读：浅色主题下 `--mi-dashboard-lime` 是 color-mix 串，
    // 任何写死的 hex / rgba 都会在浅色下变成第二份品牌色。
    const source = readFileSync(resolve(root, OPTIONS_FILE), 'utf8')
    const line = source.split('\n').findIndex(text => /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(text))
    expect(line === -1 ? '' : `第 ${line + 1} 行: ${source.split('\n')[line]!.trim()}`).toBe('')
  })

  it('matches the portal palette token by token (the fixture is the only copy in tests)', () => {
    const tokens = readFileSync(resolve(root, 'platform/ui/tokens/tokens.css'), 'utf8')
    const portal = readFileSync(resolve(root, 'products/market-intelligence/desktop/pages/intelligence/sampleMode.css'), 'utf8')
    const dashboard = readFileSync(resolve(root, 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'), 'utf8')

    // 线、正文、静音、网格、轴、底板：六个色都来自这几张样式表，fixture 与它们逐项相等。
    expect(portal).toContain(`--mi-dashboard-lime: ${CHART_PALETTE_FIXTURE.line};`)
    expect(portal).toContain(`--mi-dashboard-text: ${CHART_PALETTE_FIXTURE.text};`)
    expect(portal).toContain(`--mi-dashboard-surface: ${CHART_PALETTE_FIXTURE.surface};`)
    expect(dashboard).toContain(`--mi-dashboard-sentiment-extreme-fear: ${CHART_PALETTE_FIXTURE.bands[0]};`)
    expect(dashboard).toContain(`--mi-dashboard-sentiment-fear: ${CHART_PALETTE_FIXTURE.bands[1]};`)
    expect(dashboard).toContain(`--mi-dashboard-sentiment-neutral: ${CHART_PALETTE_FIXTURE.bands[2]};`)
    expect(dashboard).toContain(`--mi-dashboard-sentiment-greed: ${CHART_PALETTE_FIXTURE.bands[3]};`)
    expect(dashboard).toContain(`--mi-dashboard-sentiment-extreme-greed: ${CHART_PALETTE_FIXTURE.bands[4]};`)
    // 两处派生色（muted / grid / axis 都是 color-mix / 变量）只判「在样式表里有定义」。
    expect(portal).toContain('--mi-dashboard-muted:')
    expect(portal).toContain('--mi-dashboard-line:')
    expect(tokens).toContain('--font-body:')
  })
})
