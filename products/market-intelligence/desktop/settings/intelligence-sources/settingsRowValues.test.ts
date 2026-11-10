import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** 行高只有三档；间距只有主档六个值；标签列只有 160。多一个数就是有人又拧了一格。 */
const ROW_HEIGHTS = new Set([44, 60, 84])
const MAIN_STEPS = new Set([4, 6, 8, 10, 12, 16])
const LABEL_WIDTH = 160
/**
 * 既有例外（**不是这次合并引入的**，也不是我们放宽判据）：`.notification-row` 的上下内距里有 2px。
 * 记在这里而不是从判据里删掉 2 的合法性——新增的 2px 仍然会红，只是这一处老的先记账。
 */
const PRE_EXISTING_OFF_STEP = new Set([2])

const css = readFileSync(join(__dirname, 'intelligence-sources.css'), 'utf8')
// 用工作区相对路径读壳层样式：deep relative 从本文件数出去容易数错一层。
const shellCss = readFileSync(
  join(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/settings/notifications/notificationSettings.css'),
  'utf8'
)

/** 取指定选择器的规则体（够用就行：这些类名在本文件里唯一）。 */
function rulesFor(source: string, selectorPart: string): string[] {
  const out: string[] = []
  for (const match of source.matchAll(/([^{}]+)\{([^}]*)\}/gu)) {
    const selector = match[1]!.trim()
    if (!selector.includes(selectorPart)) continue
    // 只取**这一层自己**的规则：`.notification-row` 命中 `.notification-row-copy` 会把子元素的内距
    // 一起算进来，那是另一条约束（子元素有自己的取值），不该被行级守卫判红。
    if (!new RegExp(`(^|\\s)\\.${selectorPart.replace('.', '')}(?![\\w-])`, 'u').test(selector)) continue
    out.push(match[2]!)
  }
  return out
}

function pxValues(body: string, property: string): number[] {
  const re = new RegExp(`${property}\\s*:\\s*([^;]+)`, 'gu')
  return [...body.matchAll(re)]
    .flatMap((m) => [...m[1]!.matchAll(/(-?\d+(?:\.\d+)?)px/gu)].map((v) => Number(v[1])))
}

describe('settings row values stay on their steps', () => {
  it('actually matches the rules it thinks it is checking', () => {
    // 「读不到也算通过」是这类守卫最常见的假绿：选择器被改名或搬文件后，匹配 0 条仍然绿。
    // 所以先钉住匹配条数——低于预期就红，而不是安静地通过。
    expect(rulesFor(css, 'intelligence-setting-row').length).toBeGreaterThanOrEqual(1)
    expect(rulesFor(css, 'intelligence-setting-label').length).toBeGreaterThanOrEqual(1)
    expect(rulesFor(shellCss, 'notification-row').length).toBeGreaterThanOrEqual(1)
  })

  it('keeps the row height on 44 / 60 / 84 and never invents a fourth', () => {
    // 合并只换结构来源，不改数：这三档是三处设置行共同的口径。
    const bodies = rulesFor(css, 'intelligence-setting-row')
    const heights = bodies.flatMap((body) => [...pxValues(body, 'min-height'), ...pxValues(body, 'height')])
    for (const height of heights) expect(ROW_HEIGHTS.has(height)).toBe(true)
  })

  it('keeps the label column at 160', () => {
    const bodies = rulesFor(css, 'intelligence-setting-label')
    const widths = bodies.flatMap((body) => pxValues(body, 'width'))
    for (const width of widths) expect(width).toBe(LABEL_WIDTH)
  })

  it('keeps spacing on the six main steps', () => {
    const bodies = [
      ...rulesFor(css, 'intelligence-setting-row'),
      ...rulesFor(css, 'source-provider-detail__row'),
      ...rulesFor(shellCss, 'notification-row')
    ]
    for (const body of bodies) {
      for (const property of ['gap', 'column-gap', 'row-gap', 'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom']) {
        for (const value of pxValues(body, property)) {
          expect(MAIN_STEPS.has(value) || PRE_EXISTING_OFF_STEP.has(value)).toBe(true)
        }
      }
    }
  })
})

describe('one horizontal centre line per row', () => {
  it('centres the row items and keeps the switch and the 高级 button off the edges', () => {
    // 用户 2026-11-10：名字 / meta / 高级 / 开关「高高低低」。判据落在 CSS 上（计算中线要无头浏览器量，
    // 那属于人看）：行容器 `align-items: center`，开关不留 margin，两颗行内控件同为 24 高。
    for (const body of rulesFor(css, 'source-provider-detail__row')) {
      expect(body).toContain('align-items: center')
      expect(body).not.toContain('align-items: start')
    }
    for (const body of rulesFor(css, 'ant-switch')) {
      expect(body).not.toMatch(/margin-top\s*:\s*[1-9]/u)
    }
    for (const selector of ['source-provider-detail__advanced', 'source-provider-detail__name-action']) {
      // 同一选择器还有 :hover 等规则，只要求「基础规则里有一颗 24 高的」。
      expect(rulesFor(css, selector).some((body) => body.includes('height: 24px'))).toBe(true)
    }
  })
})

describe('the source-filter row wraps instead of scrolling', () => {
  it('overrides the segmented row locally so no width shows a horizontal scrollbar', () => {
    // 平台 `Segmented` 默认 `nowrap + overflow-x: auto`；这一行在产品样式里覆写成换行。
    // 判据落在规则本体（happy-dom 量不到滚动条）：wrap + 不 overflow-x:auto，且选择器带产品前缀。
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)]
      .filter((match) => match[1]!.includes('.intelligence-catalog-filters .segmented')
        && !match[1]!.includes('__item'))
      .map((match) => match[2]!)
    expect(rules.length).toBeGreaterThan(0)
    expect(rules.some((body) => body.includes('flex-wrap: wrap'))).toBe(true)
    expect(rules.some((body) => body.includes('overflow: visible'))).toBe(true)
    // 覆写里不许再出现横向滚动。
    for (const body of rules) expect(body).not.toContain('overflow-x: auto')
  })
})

describe('business cards: the source column keeps a usable width', () => {
  it('gives the source name the remaining width and forbids wrapping it', () => {
    // 真机第一次渲染就把源名压成 0 宽（逐字竖排）。判据落在规则本体（happy-dom 量不到计算宽度）：
    // 行现在是「源名（1fr）/ 行尾开关（auto）」——行标签就是源名（用户 2026-11-11），没有值列。
    const row = rulesFor(css, 'business-card__row').join('\n')
    expect(row).toContain('minmax(0, 1fr)')
    expect(row).toContain('auto')
    const label = rulesFor(css, 'business-card__label').join('\n')
    expect(label).toContain('white-space: nowrap')
    expect(label).toContain('min-width: 0')
    expect(label).not.toMatch(/(?:^|[;{\s])width\s*:\s*0/u)
    // 旧的「格名 / 源名」两列值列不许回来：两套渲染并存就会又出现一列被压成 0 宽。
    expect(css).not.toContain('business-card__value')
  })
})

describe('business cards keep their padding', () => {
  it('reserves 16 around the content and 12 inside each row', () => {
    // 用户 2026-11-11：卡片贴边、行文字贴描边。判据落在规则本体（类级），删掉就红。
    const content = rulesFor(css, 'business-settings__content').join('\n')
    expect(content).toContain('padding: 16px')
    // 同一个选择器还有 :hover 规则，只要求「基础规则里有一行是 0 12」。
    const row = rulesFor(css, 'business-card__row')
    expect(row.some((body) => /padding\s*:\s*0\s+12px/u.test(body))).toBe(true)
    // 两列：源名（1fr）+ 行尾开关（auto）。少了 `auto` 那列，开关就掉到第二行（那次事故的判据）。
    expect(row.some((body) => /grid-template-columns\s*:[^;]*minmax\(0,\s*1fr\)[^;]*auto/u.test(body))).toBe(true)
    // 两层卡片 + 自适应（用户 2026-11-11）：三列基准，一张数据卡片按自己的源项个数占列，
    // 所以 1 个源的卡占 1/3、2 个源占 2/3，能并进同一行；放不下就换行。
    // 第一层模块卡也自适应：三列基准，模块按内部源项数占列（上限 3）。
    const moduleGrid = rulesFor(css, 'business-module-grid').join('\n')
    expect(moduleGrid).toMatch(/grid-template-columns\s*:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u)
    expect(css).toMatch(/grid-column:\s*span var\(--module-span/u)
    const cellGrid = rulesFor(css, 'business-cell-grid').join('\n')
    expect(cellGrid).toContain('repeat(var(--module-span')
    const cell = rulesFor(css, 'business-cell').join('\n')
    expect(cell).toContain('grid-column: span var(--cell-span')
    const items = rulesFor(css, 'business-cell__items').join('\n')
    expect(items).toContain('repeat(var(--cell-items')
    // 每张数据卡片占几列 = 它有几个源项（最多 3）；这条在视图侧断言，见 BusinessSettingsView.test.tsx。
    // 一行是**圆角描边的整行容器**（照源行那套）：把描边/圆角删掉变成通栏行就红。
    expect(row.some((body) => /border\s*:\s*1px solid/u.test(body))).toBe(true)
    expect(row.some((body) => /border-radius\s*:\s*8px/u.test(body))).toBe(true)
  })
})
