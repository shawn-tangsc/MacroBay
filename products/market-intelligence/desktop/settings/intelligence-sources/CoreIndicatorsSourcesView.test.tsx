// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { productText } from '../../shared/i18n/productText'
import { resolveProductTextKey } from '../../shared/i18n/productTextKey'
import { CoreIndicatorsSourcesView } from './CoreIndicatorsSourcesView'

import { MACRO_INDICATOR_CARD_KEYS, MACRO_INDICATOR_GROUPS }
  from '../../../service/intelligence/macro-calendar/macroIndicatorCardGroups'
import { valueSourcesForMetric } from '../../../service/intelligence/macro-calendar/coreIndicatorValueSources'

/**
 * 「核心指标」这一屏的四条（Chief + 架构师 2026-11-14）：
 * 行来自唯一派生点；缺配置 = 开；总闸关掉时置灰并给去处；腿全关时说「所有源已关闭」而不是「暂无数据」。
 */
const t = productText['zh-CN'].settings.intelligenceSources
const resolveText = (key: string): string => resolveProductTextKey('zh-CN', key)
const names: Record<string, string> = { narwhal: 'Narwhal 经济数据', 'fred-rates-liquidity': 'FRED', bls: 'BLS' }

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(overrides: Partial<Parameters<typeof CoreIndicatorsSourcesView>[0]> = {}): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(CoreIndicatorsSourcesView, {
    resolveText,
    sourceNameOf: (providerId: string) => names[providerId],
    sourceEnabled: () => true,
    disabled: {},
    onToggle: vi.fn(),
    ...overrides
  })))
  return host
}

describe('core indicator source page', () => {
  it('lists one card per indicator, with the legs the derivation table gives', async () => {
    const host = await render()
    /* 三组 × 四行，顺序与 `MACRO_INDICATOR_GROUPS` 完全一致——用例不自己再列一遍指标。 */
    const groups = [...host.querySelectorAll<HTMLElement>('[data-core-indicator-group]')]
    expect(groups.map((group) => group.getAttribute('data-core-indicator-group'))).toEqual(
      MACRO_INDICATOR_GROUPS.map((group) => group.id))
    const cards = [...host.querySelectorAll<HTMLElement>('[data-core-indicator]')]
    expect(cards.map((card) => card.getAttribute('data-core-indicator')))
      .toEqual([...MACRO_INDICATOR_CARD_KEYS])
    /* 用户看得见的那个数是 12：卡行数与分组表一起派生，删一行这里当场少一张。 */
    expect(cards).toHaveLength(12)
    // 每一格都必须有名字：漏一条文案键就是一格空白标题（中英都要有，见下面的用例）。
    for (const card of cards) {
      expect(card.querySelector('.business-cell__title')?.textContent?.trim(), String(card.dataset.coreIndicator))
        .not.toBe('')
    }
    // 组标题也必须有：三组的标题键取不到就是一片空白标题。
    for (const group of groups) {
      expect(group.querySelector('.business-card__title')?.textContent?.trim(), String(group.dataset.coreIndicatorGroup))
        .not.toBe('')
    }
    // 新增就业的官方腿是 BLS；其余三个是 FRED。盘口不在这一页。
    const payrolls = host.querySelector('[data-core-indicator="US.NONFARM.SA.CHANGE"]')!
    expect(payrolls.textContent).toContain('BLS')
    expect(payrolls.textContent).not.toContain('Polymarket')
    expect(host.textContent).not.toContain('Polymarket')
  })

  it('shows the switch as ON when there is no saved preference', async () => {
    const host = await render()
    const switches = [...host.querySelectorAll<HTMLElement>('[data-cell-id] .ant-switch')]
    expect(switches.length).toBeGreaterThan(0)
    for (const item of switches) expect(item.getAttribute('aria-checked')).toBe('true')
  })

  it('grays a row out when the source itself is off, and the whole row opens the source', async () => {
    const onOpenSource = vi.fn()
    const host = await render({ sourceEnabled: (providerId) => providerId !== 'narwhal', onOpenSource })
    const row = host.querySelector<HTMLElement>('[data-cell-id="US.CPI.NSA.YOY|narwhal"]')!
    // 共享行用 `data-source-disabled` 标这一行，并按看板那套改成整行是按钮（不再给名字加尾巴按钮）。
    expect(row.getAttribute('data-source-disabled')).toBe('true')
    expect(row.getAttribute('role')).toBe('button')
    const control = row.querySelector<HTMLButtonElement>('button.ant-switch')
    expect(control?.disabled).toBe(true)
    await act(async () => row.click())
    expect(onOpenSource).toHaveBeenCalledWith('narwhal')
  })

  it('says all sources are off, which is not the same sentence as having no data', async () => {
    /* 关哪几颗按派生表算：腿数会变（BLS 覆盖从 2 条扩到 5 条时这里就红过一次），
       写死两条等于每次加腿都要来改用例，而用例要守的是「全关时说哪句话」。 */
    const disabled = Object.fromEntries(
      valueSourcesForMetric('US.CPI.NSA.YOY').map((source) => [`US.CPI.NSA.YOY|${source.providerId}`, true])
    )
    const host = await render({ disabled })
    const card = host.querySelector<HTMLElement>('[data-core-indicator="US.CPI.NSA.YOY"]')!
    expect(card.textContent).toContain(t.coreIndicators.valueSourceAllClosed)
    expect(card.textContent).not.toContain(t.coreIndicators.valueSourceEmpty)
  })
})

/**
 * 名字最多两行，但**全名必须拿得到**（界面设计 2026-11-14）：
 * 悬停看全名、读屏念全名；样式只许排布类属性，出现颜色/字号/边框就得回共享文件。
 */
describe('源名：两行截断，全名不丢', () => {
  const LONG = 'Federal Reserve Economic Data — St. Louis Fed 官方序列'

  it('keeps the full name on the element as text (the shared row does not truncate it away)', async () => {
    const host = await render({ sourceNameOf: (providerId: string) =>
      providerId === 'fred-rates-liquidity' ? LONG : names[providerId] })
    const label = host.querySelector<HTMLElement>('[data-cell-id="US.CPI.NSA.YOY|fred-rates-liquidity"] .business-card__label')!
    // 读屏念的是完整名字（DOM 文本没有被截断成两行内容）。
    expect(label.textContent).toBe(LONG)
  })

  it('keeps the full name on the row that opens the source', async () => {
    const host = await render({
      sourceNameOf: (providerId: string) => providerId === 'narwhal' ? LONG : names[providerId],
      sourceEnabled: (providerId: string) => providerId !== 'narwhal',
      onOpenSource: vi.fn()
    })
    const row = host.querySelector<HTMLElement>('[data-cell-id="US.CPI.NSA.YOY|narwhal"]')!
    expect(row.textContent).toContain(LONG)
  })

  /* 这一屏**不再有自己的样式覆盖**：那四组（行内对齐、两处 align-content、名字两行截断）
     让「结构一样、长得不一样」。文件已删，用例改成断言它不存在。 */
  it('ships no stylesheet of its own any more', () => {
    expect(existsSync(join(__dirname, 'coreIndicators.css'))).toBe(false)
  })
})

/**
 * 两条腿**并排**（用户 2026-11-14 截图：上下叠着）。
 *
 * 卡片与项容器都靠 `--cell-span` / `--cell-items` 决定占几列；漏设就是默认 1 列。
 * 判据：每张卡这两个变量都等于它的腿数（最多 3），不是 1。
 */
describe('列数：两条腿并排，不上下叠', () => {
  it('sets both column variables to the number of legs on every card', async () => {
    const host = await render()
    const cards = [...host.querySelectorAll<HTMLElement>('[data-core-indicator]')]
    expect(cards).toHaveLength(MACRO_INDICATOR_CARD_KEYS.length)
    for (const card of cards) {
      const items = card.querySelector<HTMLElement>('.business-cell__items')!
      const label = card.getAttribute('data-core-indicator') ?? ''
      // 列数＝这张卡实际有几条腿（最多 3），从派生表算，不在用例里写死。
      const legs = Math.min(valueSourcesForMetric(label).length, 3)
      expect(card.getAttribute('style') ?? '', label).toContain(`--cell-span: ${legs}`)
      expect(items.getAttribute('style') ?? '', label).toContain(`--cell-items: ${legs}`)
    }
  })
})

/**
 * 频率那一格跟其它业务页**同一套**（用户 2026-11-14：「没按照这里的源项配置还原」）。
 *
 * 判据：同一颗源在两页显示的节奏必须一致；类型标签不占频率格；只有真的没有独立排期、
 * 由产品内置作业驱动的源才写「内置频率」。
 */
describe('频率格：与看板同一套读数，类型不占这一格', () => {
  const CADENCE = (intervalSeconds: number) => ({
    registration: 'registered' as const,
    mode: 'interval' as const,
    intervalSeconds,
    nextRunAt: '2026-12-01T06:30:00.000Z',
    lastRunAt: '2026-12-01T06:15:00.000Z',
    running: false
  })

  it('shows FRED real interval (it is an adjustable source), not the builtin label', async () => {
    const host = await render({
      presetOf: () => 'balanced',
      cadenceOf: (providerId: string) => providerId === 'fred-rates-liquidity' ? CADENCE(6 * 60 * 60) : undefined,
      cadenceAvailable: true,
      builtinCadenceOf: (providerId: string) => providerId === 'narwhal'
    })
    const fredRow = host.querySelector<HTMLElement>('[data-cell-id="US.CPI.NSA.YOY|fred-rates-liquidity"]')!
    expect(fredRow.textContent).toContain('间隔 6 小时')
    expect(fredRow.textContent).not.toContain(t.collectionPolicy.builtinCadence)
    expect(fredRow.querySelector('[data-preset-builtin="true"]')).toBeNull()
  })

  it('keeps the builtin label only for the product-owned leg (Narwhal)', async () => {
    const host = await render({
      presetOf: () => 'balanced',
      cadenceOf: () => undefined,
      cadenceAvailable: true,
      builtinCadenceOf: (providerId: string) => providerId === 'narwhal'
    })
    const narwhalRow = host.querySelector<HTMLElement>('[data-cell-id="US.CPI.NSA.YOY|narwhal"]')!
    expect(narwhalRow.querySelector('[data-preset-builtin="true"]')).not.toBeNull()
    expect(narwhalRow.textContent).toContain(t.collectionPolicy.builtinCadence)
  })

  /* 类型微标（`官方 / 数据商`）随共享行取消：看板那一行没有，两屏要一致就不能只有这屏有。 */
})

/**
 * 文案齐全 + 布局不另设计（2026-11-14 用户：「同样的分组、同样的卡，照看板抄」）。
 *
 * 两条各自能红的真情况：① 新增一个指标却忘了加名字键 → 那一格变成空白标题；
 * ② 有人又给这一屏加 `auto-fit` / `minmax` / 断点 → 看板没有这些，这一屏就不该有。
 * 注意：第二条是**棘轮**（断言某类规则不存在），它挡新增，不证明现行排布就等于看板。
 */
describe('三组十二项：文案齐全、不另设计布局', () => {
  it('names all three groups and every metric in both languages, with no two the same', async () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const resolve = (key: string) => resolveProductTextKey(language, key)
      const host = await render({ resolveText: resolve })
      const titles = [...host.querySelectorAll<HTMLElement>('[data-core-indicator] .business-cell__title')]
        .map((node) => node.textContent?.trim() ?? '')
      expect(titles, language).toHaveLength(MACRO_INDICATOR_CARD_KEYS.length)
      for (const title of titles) expect(title, language).not.toBe('')
      expect(new Set(titles).size, `${language} 有重名`).toBe(titles.length)

      const groups = [...host.querySelectorAll<HTMLElement>('[data-core-indicator-group] .business-card__title')]
        .map((node) => node.textContent?.trim() ?? '')
      expect(groups, language).toHaveLength(MACRO_INDICATOR_GROUPS.length)
      for (const title of groups) expect(title, language).not.toBe('')
    }
  })

  /**
   * M3 的判据：**腿数只从 catalog 读**。这条挡「改回自己派生」或「加一层兜底」——
   * 兜底会让换码演练永远看起来绿，而旧路还活着。
   */
  /**
   * 12 个码在设置页**没有第二份清单**：显示名跟着分组行走（`metricNameKey`），码本身从分组表派生。
   *
   * 这条挡两件事：① 有人再在设置页列一遍 12 个码（改名时必漏一处，今晚出现过）；② 某行名键
   * 在文案表里没有对应句子——那会渲染成一张空白标题的卡，读者看不出来但它就是坏的。
   * 中英两套都要有：只补一套时另一种语言下那一格是空的。
   */
  it('takes the twelve display names from the group rows, in both languages', () => {
    for (const language of Object.keys(productText) as Array<keyof typeof productText>) {
      const names = productText[language].settings.intelligenceSources.coreIndicators.metricNames
      for (const group of MACRO_INDICATOR_GROUPS) {
        for (const row of group.rows) {
          const name = (names as Record<string, string | undefined>)[row.metricNameKey]
          expect(name, `${language}: ${row.metricKey} → ${row.metricNameKey}`).toBeTruthy()
        }
      }
      expect(Object.keys(names), language).toHaveLength(MACRO_INDICATOR_CARD_KEYS.length)
    }
    /* 反向：设置页自己不再按码建表——源码里出现码字面量就是又一份清单。 */
    const view = readFileSync(join(__dirname, 'CoreIndicatorsSourcesView.tsx'), 'utf8')
    for (const key of MACRO_INDICATOR_CARD_KEYS) expect(view, key).not.toContain(`'${key}'`)
  })

  it('reads the legs from the catalog and never derives them itself', () => {
    const view = readFileSync(join(__dirname, 'CoreIndicatorsSourcesView.tsx'), 'utf8')
    expect(view).toContain('metricCatalog()')
    expect(view).not.toContain('valueSourcesForMetric(')
  })

  /**
   * 宽度从哪里来（2026-11-22 用户截图：这一屏每个指标卡被压成窄条、频率一字一行）。
   *
   * 模块卡占几列由 `.business-module-grid > .business-card { grid-column: span var(--module-span) }`
   * 决定——**靠结构，不靠属性**。原来的选择器是 `.business-card[data-business-card]`，这一屏漏了
   * 那个属性，组卡就落回 1 列（1/3 宽），而 `--module-span: 3` 还在喂组内的 cell-grid，
   * 结果是每张指标卡只剩 1/9 宽。两条一起钉：
   * 1. 结构：每张组卡必须是 `.business-module-grid` 的**直接子元素**（中间加一层就红）；
   * 2. 规则：占列的判据是结构选择器，属性选择器不许回来（改回属性就红）。
   */
  it('keeps each group card a direct child of the module grid', async () => {
    const host = await render()
    const groups = [...host.querySelectorAll<HTMLElement>('[data-core-indicator-group]')]
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) {
      expect(group.className, String(group.dataset.coreIndicatorGroup)).toContain('business-card')
      expect(group.parentElement?.className, String(group.dataset.coreIndicatorGroup)).toContain('business-module-grid')
    }
  })

  it('takes the module width from the structure, not from a data attribute', () => {
    const css = readFileSync(join(__dirname, 'intelligence-sources.css'), 'utf8')
    expect(css).toContain('.business-module-grid > .business-card {')
    /* 属性选择器不许再承担宽度：它今天还兼着「跳到某个模块」的定位，但**宽度**只能来自结构。 */
    expect(css).not.toContain('.business-card[data-business-card] {')
  })

  it('cannot make the frequency readout collapse into a column of single characters', () => {
    /* 一字一行不是「不好看」，是坏状态：容器窄到 11px 时 `overflow-wrap: anywhere` 会逐字折。
       结构上禁掉它——父级可换行、读数有 6ch 下限，于是放不下时整条读数落到第二行。 */
    const layout = readFileSync(join(__dirname, 'intelligence-sources.css'), 'utf8')
    const preset = layout.slice(layout.indexOf('.business-card__preset {'))
    const presetRule = preset.slice(0, preset.indexOf('}'))
    expect(presetRule).toContain('flex-wrap: wrap')
    expect(presetRule).toContain('row-gap: 4px')

    const readout = readFileSync(join(__dirname, 'frequencyReadout.css'), 'utf8')
    const scoped = readout.slice(readout.indexOf('.business-card__preset > .business-card__preset-readout {'))
    const scopedRule = scoped.slice(0, scoped.indexOf('}'))
    expect(scopedRule).toContain('min-width: 6ch')
    expect(scopedRule).toContain('flex: 1 1 6ch')
  })

  it('carries no layout rule the dashboard does not have', () => {
    /* 只剩视图一个文件可查：这一屏自己的 css 已经删了（上一组用例断言它不存在）。 */
    const view = readFileSync(join(__dirname, 'CoreIndicatorsSourcesView.tsx'), 'utf8')
    for (const source of [view]) {
      expect(source).not.toContain('auto-fit')
      expect(source).not.toContain('minmax(')
      expect(source).not.toContain('grid-template-columns')
      expect(source).not.toMatch(/@media/)
    }
  })
})
