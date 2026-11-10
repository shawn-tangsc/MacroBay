// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'

import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { divergencePolicy } from '../../../../contracts/marketDivergence'
import { productText } from '../../../shared/i18n/productText'
import { DivergencePanel } from './DivergencePanel'

/**
 * 时区 provider 的 `children` 是**必填 prop**，不是 `createElement` 的第三个参数：
 * 那种写法在运行期能跑、在类型上对不上——预检钩子把包含测试文件的那棵树查一遍就红了。
 */
const scoped = (child: ReactElement): ReactElement =>
  createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: child })

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.divergence
const render = (state: Parameters<typeof DivergencePanel>[0]['state'], locale: 'zh-CN' | 'en-US' = 'zh-CN') =>
  renderToStaticMarkup(scoped(createElement(DivergencePanel, {
    state, onRetry: () => undefined, text: productText[locale].pages.intelligence.portal.dashboard.divergence
  })))

const row = {
  pairId: 'liquidity-leverage' as const,
  direction: 'bearish' as const,
  legs: [
    { id: 'stablecoin' as const, text: '−1.21%', observedAt: '2026-10-30T10:00:00.000Z' },
    { id: 'open-interest' as const, text: '+3.40%', observedAt: '2026-10-30T11:00:00.000Z' },
    { id: 'funding' as const, text: '−0.0032% / 8h', observedAt: '2026-10-30T11:00:00.000Z' }
  ]
}

/** 观察态：方向是 `unpriced`，标签走中性那句，不挂方向色。 */
const observedRow = {
  pairId: 'narrative-price' as const,
  direction: 'unpriced' as const,
  legs: [
    { id: 'sentiment' as const, text: '62%', observedAt: '2026-10-30T09:00:00.000Z' },
    { id: 'price' as const, text: '+0.07%', observedAt: '2026-10-30T11:00:00.000Z' },
    { id: 'open-interest' as const, text: '+0.4%', observedAt: '2026-10-30T11:00:00.000Z' }
  ]
}

type WithheldFixture = Parameters<typeof DivergencePanel>[0]['state'] extends infer _S ? Readonly<{
  pairId: string; reason: 'leg-missing' | 'leg-stale'; leg: 'sentiment' | 'price' | 'etf' | 'stablecoin'
}> : never

const sentimentMissing: WithheldFixture = { pairId: 'narrative-price', reason: 'leg-missing', leg: 'sentiment' }
const priceStale: WithheldFixture = { pairId: 'flows-price', reason: 'leg-stale', leg: 'price' }
const etfMissing: WithheldFixture = { pairId: 'flows-price', reason: 'leg-missing', leg: 'etf' }
const stablecoinMissing: WithheldFixture = { pairId: 'liquidity-leverage', reason: 'leg-missing', leg: 'stablecoin' }

/** 命中行带界：上界那一对，阈值从契约读，不在调用点写数字。 */
const boundRow = {
  ...row,
  bound: {
    leg: 'open-interest' as const,
    comparator: 'atLeast' as const,
    threshold: divergencePolicy.thresholds.openInterest24hUpPercent
  }
}
/** 绝对值那一对：`atMost` 且阈值为正。 */
const absoluteRow = {
  ...observedRow,
  bound: {
    leg: 'open-interest' as const,
    comparator: 'atMost' as const,
    threshold: divergencePolicy.thresholds.openInterestFlatPercent
  }
}

const answer = (rows: readonly (typeof row | typeof observedRow | typeof boundRow | typeof absoluteRow)[], withheld: readonly WithheldFixture[] = []) =>
  ({ state: 'available' as const, rows, withheld })

const sentimentReason = text.sentimentNoScoredItems.replace('{leg}', text.legs.sentiment)

/**
 * 界面设计 2026-11-09 对行 48 的边界：顺序对（先读数、再口径），但**弹窗里不许再加第二颗 ⓘ**——
 * 一张卡上两个解释入口就是又回到「一个读数两个入口」。
 */
it('keeps exactly one help trigger on the card, and it lives inside the expanded reading', () => {
  const source = readFileSync('products/market-intelligence/desktop/features/industry/divergence/DivergencePanel.tsx', 'utf8')
  // 入口是牌子自己（原生按钮 + `aria-expanded` / `aria-controls`），卡面没有第二颗图标触发器。
  expect((source.match(/<IconButton/gu) ?? [])).toHaveLength(1)
  expect((source.match(/<Popover/gu) ?? [])).toHaveLength(1)
  expect(source).toContain('aria-expanded={expanded}')
  expect(source).toContain('aria-controls={detailId}')
  // 那颗 ⓘ 在展开区里（`data-divergence-detail` 之后），不在卡面上。
  const detailAt = source.indexOf('data-divergence-detail')
  const helpAt = source.indexOf('<IconButton')
  expect(detailAt).toBeGreaterThan(-1)
  expect(helpAt).toBeGreaterThan(detailAt)
})

/**
 * 非 UTC 读者：截至那一行只能有一个偏移。
 *
 * 旧写法先 `formatTime()` 再 `.replace(/\s*GMT$/, '')` 再补时区标签——那个正则只匹配**裸 `GMT`**，
 * 所以 UTC 之外的读者会看到「… 18:00 GMT+8 GMT+8」：同一行两遍偏移。
 *
 * 用例挂在展开之后（默认收起，收起时这一行根本不在 DOM 里），并且用 Asia/Shanghai 这个**非 UTC**
 * 的显示时区——UTC 下旧写法与正确写法输出相同，拿 UTC 测等于没测。
 */
it('prints the reader’s offset once on every as-of line', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => {
      root.render(createElement(ShellTimeZoneProvider, { timeZone: 'Asia/Shanghai', children:
        createElement(DivergencePanel, { state: answer([row], []), onRetry: () => undefined, text }) }))
    })
    const summary = container.querySelector<HTMLButtonElement>('.mi-divergence__summary')!
    await act(async () => { summary.click() })
    const line = container.querySelector('.mi-divergence__asof')?.textContent ?? ''
    expect(line).not.toContain('GMT+8 GMT+8')
    // 三条腿各一个偏移，且只有一个：多一个就是第二遍。
    expect((line.match(/GMT\+8/gu) ?? [])).toHaveLength(3)
  } finally { await act(async () => root.unmount()); container.remove() }
})

describe('divergence panel · the one summary line', () => {
  /**
   * 五态一张表（界面设计 v2 §二）：每一行给「输入 + 该出现的那句 + 该缺席的几句」。
   *
   * 为什么并成表：原来每条用例各自 mount 一次、只差输入与那一句文案；分开写时，新增一态就要复制一遍
   * 挂载与断言骨架，删一句也看不出是哪一态少了判据。表里每行仍逐条断言（出现的那句 + 缺席的几句），
   * 断言数不减：合并的是骨架，不是判据。
   */
  const summaryStates = [
    {
      name: 'A 有背离：只说这一句，且读数不上卡面',
      state: answer([row]),
      expected: text.summary.divergence,
      absent: [text.summary.quiet, text.summary.allWithheld],
      alsoAbsent: [row.legs[0]!.text],
      expandable: true
    },
    {
      name: 'B 没背离、也没有没判成的组：一句说明，不是控件',
      state: { state: 'empty', withheld: [] } as const,
      expected: text.summary.quiet,
      absent: [text.summary.divergence, text.summary.allWithheld],
      expandable: false
    },
    {
      name: 'C 有背离 + 1 组没判成（舆情腿）：冒号后是这一组的原因',
      state: answer([row], [sentimentMissing]),
      expected: `${text.summary.divergenceWithheldOne.split('{')[0]}${sentimentReason}`,
      absent: [text.summary.quiet, text.summary.divergence],
      expandable: true
    },
    {
      name: 'C 换成另一组（价格太旧）时整句跟着换，不许照抄舆情',
      state: answer([row], [priceStale]),
      expected: `${text.summary.divergenceWithheldOne.split('{')[0]}${text.withheldReasons['leg-stale'].replace('{leg}', text.legs.price).split('{at}')[0]!}`,
      absent: [sentimentReason, text.summary.quiet],
      expandable: true
    },
    {
      name: 'C 有背离 + 2 组没判成：只报数，不报原因',
      state: answer([row], [sentimentMissing, priceStale]),
      expected: text.summary.divergenceWithheldMany.replace('{count}', '2'),
      absent: [sentimentReason, text.summary.divergence],
      expandable: true
    },
    {
      name: 'D 没背离 + 1 组没判成：原因跟在后面',
      state: { state: 'empty', withheld: [sentimentMissing] } as const,
      expected: `${text.summary.quietWithheldOne.split('{')[0]}${sentimentReason}`,
      absent: [text.summary.quiet, text.summary.divergence],
      expandable: true
    },
    {
      name: 'D 没背离 + 2 组没判成：只报数',
      state: { state: 'empty', withheld: [sentimentMissing, priceStale] } as const,
      expected: text.summary.quietWithheldMany.replace('{count}', '2'),
      absent: [sentimentReason, text.summary.quiet],
      expandable: true
    },
    {
      name: 'E 三组全判不了：独立一态，不许并进「没有背离」',
      state: { state: 'empty', withheld: [sentimentMissing, stablecoinMissing, priceStale] } as const,
      expected: text.summary.allWithheld,
      absent: [text.summary.quiet, text.summary.divergence],
      expandable: true
    }
  ] as const

  it('says exactly one of the five sentences, and only the one its state calls for', () => {
    // 一条用例跑完五行：每行的断言各自带行名，失败时知道是哪一态（vitest 的消息参数会印出来）。
    for (const row of summaryStates) {
      const markup = render(row.state as never)
      // 该出现的那一句在。
      expect(markup, `${row.name} · 该出现的句子`).toContain(row.expected)
      // 其余几句一个都不许出现（逐条，不是一条近似检查）。
      for (const other of row.absent) expect(markup, `${row.name} · 不该出现：${other}`).not.toContain(other)
      if ('alsoAbsent' in row) for (const other of row.alsoAbsent) expect(markup, `${row.name} · 不该出现：${other}`).not.toContain(other)
      // 可展开的那几态是按钮；静默的一天不是控件（无 aria-expanded、无箭头）。
      if (row.expandable) expect(markup, `${row.name} · 应是可展开的按钮`).toContain('aria-expanded="false"')
      else {
        expect(markup, `${row.name} · 不该是控件`).not.toContain('aria-expanded')
        expect(markup, `${row.name} · 不该有箭头`).not.toContain('mi-divergence__summary-chevron')
      }
    }
  })

  it('is neutral and eats no default button look: transparent, borderless, one token size', () => {
    const markup = render(answer([row]))
    const summary = markup.slice(markup.indexOf('mi-divergence__summary"'), markup.indexOf('</button>'))
    /**
     * 判据：摘要行里**只有折叠箭头这一个图形**，没有任何语气/方向标记——方向色只留在展开区。
     *
     * 这条原来写的是「一个 `<svg>` 都不许有」（界面设计 v2 §四）。2026-11-10 界面设计把入口改成
     * 「左侧 14px 箭头 + 整行可点 + 悬停变色」，箭头就必须是图标组件——旧规则要守的其实是「不要让
     * 语气图形进摘要行」，不是「不许有图标」。所以判据改成：恰好一个 svg，且它是那颗 chevron。
     */
    expect(markup).toContain('class="mi-divergence__summary"')
    expect((summary.match(/<svg/gu) ?? [])).toHaveLength(1)
    expect(summary).toContain('lucide-chevron-right')
    expect(summary).not.toContain('data-tone')
    /**
     * 样式在外部表里，测试环境读不到计算样式（happy-dom 不加载 `.css`），所以这条查**规则本身**：
     * 删掉任何一条复位声明、或把字号写回像素值，这条就红。灰色实心块正是这些复位缺失时的默认外观。
     *
     * **这条的限制要写明白**：它证明的是「样式表里有这条规则」，**不证明界面上真的生效**——
     * 打包产物过期、类名对不上、别的规则盖掉它，这条都照样绿。所以这个缺陷最终还得靠读者看
     * 一眼才算关；用例只负责「别在下次重构里把复位删掉」。
     */
    const css = readFileSync('products/market-intelligence/desktop/features/industry/divergence/DivergencePanel.css', 'utf8')
    const rule = css.match(/\.mi-divergence__summary \{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toContain('background: transparent')
    expect(rule).toContain('border: 0')
    // 入口是可点的行（界面设计 2026-11-10）：左右内距 8、文字 12 那一档、正文行高，仍然零硬编码字号。
    expect(rule).toContain('padding: 0 8px')
    expect(rule).toContain('font: inherit')
    expect(rule).toContain('font-size: var(--font-body)')
    expect(rule).toContain('line-height: var(--line-body)')
    expect(rule).not.toMatch(/font-size:\s*\d/)
    expect(rule).not.toMatch(/caution|negative|warning/)
  })

  it('gets the card body size and a transparent, borderless box in computed style too', async () => {
    // 把这张卡自己的样式表注入文档再量**计算样式**：上面那条只证明「规则写对了」，
    // 这条证明「这条规则真的落到了这颗按钮上」——删掉复位或丢掉 token，它会红。
    const css = readFileSync('products/market-intelligence/desktop/features/industry/divergence/DivergencePanel.css', 'utf8')
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(scoped(createElement(DivergencePanel, { state: answer([row]), onRetry: () => undefined, text })))
    })
    const summary = container.querySelector<HTMLElement>('.mi-divergence__summary')!
    const computed = getComputedStyle(summary)
    // 灰底那半在这里量得到：这三条复位一旦缺失，浏览器就把它画成默认按钮。
    expect(computed.backgroundColor).toBe('transparent')
    expect(computed.borderTopWidth).toBe('0px')
    expect(computed.paddingTop).toBe('0px')
    /**
     * 字号只能停在规则层，不能在这一层量：happy-dom 不解析 `var()`（它会把这格读成 `inherit`），
     * 所以 `font-size` 的断言在上面那条规则用例里。**两条合起来才是完整判据**：
     * 一条证复位真的落到按钮上，一条证字号引用的是既有 token、不是写死的 px。
     */
    await act(async () => { root.unmount() })
    style.remove()
  })
})

describe('divergence panel · the chip is the control', () => {
  /**
   * 界面设计 2026-11-10 的判据：入口要**同时**给三个可见线索，只加一个都不够（用户实测「看不出区别」）——
   * 左侧 14px 箭头（展开转 90°）、整行 44 高且可点（文字 12 / `--font-body` / `--text`，不许 muted）、
   * 悬停整行 `--surface-soft` 且箭头变 `--text`。文案在展开后**不改**：一句事实被换成动词，行里就少一个信息。
   */
  it('draws the chevron on the left, 44 tall, focusable, and keeps the sentence when expanded', async () => {
    const css = readFileSync('products/market-intelligence/desktop/features/industry/divergence/DivergencePanel.css', 'utf8')
    const block = /\.mi-divergence__summary \{([^}]*)\}/u.exec(css)?.[1] ?? ''
    expect(block).toMatch(/height:\s*44px/u)
    expect(block).toMatch(/padding:\s*0 8px/u)
    // 可点的行不是注释：字号走 12px 那一档，颜色是正文色。
    expect(block).toMatch(/font-size:\s*var\(--font-body\)/u)
    expect(block).toMatch(/color:\s*var\(--text\)/u)
    expect(block).not.toMatch(/--muted/u)
    // 悬停整行用 surface-soft；箭头在悬停/聚焦时变正文色。
    expect(css).toMatch(/\.mi-divergence__summary:hover \{[^}]*background:\s*var\(--surface-soft\)/u)
    expect(css).toMatch(/\.mi-divergence__summary:hover \.mi-divergence__summary-chevron[^{]*\{[^}]*color:\s*var\(--text\)/u)
    // 展开时箭头转 90°，不是换形状也不是换文案。
    expect(css).toMatch(/\.mi-divergence__summary\[aria-expanded='true'\] \.mi-divergence__summary-chevron[^{]*\{[^}]*rotate\(90deg\)/u)

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(scoped(createElement(DivergencePanel, { state: answer([row]), onRetry: () => undefined, text }))) })
      const summary = container.querySelector<HTMLButtonElement>('.mi-divergence__summary')!
      // 箭头在左：它是第一个子元素，且是 14px 的 lucide 图标而不是 8px 的字符。
      const first = summary.firstElementChild
      expect(first?.tagName.toLowerCase()).toBe('svg')
      expect(first?.classList.contains('mi-divergence__summary-chevron')).toBe(true)
      expect(first?.getAttribute('width')).toBe('14')
      expect(first?.getAttribute('height')).toBe('14')
      expect(summary.querySelector('.mi-divergence__summary-chevron + .mi-divergence__summary-text')).not.toBeNull()
      // 可聚焦、可切换，展开后焦点不跑。
      expect(summary.getAttribute('aria-expanded')).toBe('false')
      summary.focus()
      expect(document.activeElement).toBe(summary)
      const sentence = summary.textContent
      await act(async () => { summary.click() })
      expect(summary.getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(summary)
      // 文案不改：还是那一句事实，不是「收起」。
      expect(summary.textContent).toBe(sentence)
    } finally { await act(async () => root.unmount()) }
  })
})

describe('divergence panel · the details behind the line', () => {
  const mount = async (state: Parameters<typeof DivergencePanel>[0]['state']) => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(scoped(createElement(DivergencePanel, { state, onRetry: () => undefined, text })))
    })
    return { container, root }
  }

  it('opens on the summary line and shows each pair’s own as-of instant', async () => {
    const { container, root } = await mount(answer([row], [sentimentMissing, priceStale]))
    const summary = container.querySelector<HTMLButtonElement>('.mi-divergence__summary')!
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-divergence-detail]')).toBeNull()
    await act(async () => { summary.click() })
    expect(summary.getAttribute('aria-expanded')).toBe('true')
    const detail = container.querySelector('[data-divergence-detail]')!
    // 每条腿各自的截至时刻：一条腿的「截至」不能替另一条腿作证。
    const line = detail.querySelector('.mi-divergence__asof')!.textContent ?? ''
    // 每条腿的日期跟着它自己（短名 + 截至 + 完整时刻 + 偏移），两腿日期不同就各写一遍。
    expect(line).toContain(`${text.legNames.stablecoin} ${text.chipAsOf.replace('{at}', '2026-10-30 10:00 GMT')}`)
    expect(line).toContain(`${text.legNames['open-interest']} ${text.chipAsOf.replace('{at}', '2026-10-30 11:00 GMT')}`)
    // 窗口不在这行重复（腿行里已有），偏移必须在，且不许只留一个日期头。
    expect(line).not.toContain('7 天')
    expect(line).not.toContain('24 小时')
    expect(line.match(/截至/g)).toHaveLength(3)
    // 方向标签与机制句也只在展开区。
    expect(detail.querySelector('[data-direction="bearish"]')?.textContent).toContain(text.directions.bearish)
    expect(detail.textContent).toContain(text.pairs['liquidity-leverage'].mechanism)
    // 没判成的组排在最上面，组名 + 原因。
    expect(detail.textContent).toContain(text.pairNames['narrative-price'])
    expect(detail.textContent).toContain(sentimentReason)
    // 收起：焦点还在摘要行上（展开/收起不移动焦点）。
    await act(async () => { summary.click() })
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-divergence-detail]')).toBeNull()
    await act(async () => { root.unmount() })
  })

  it('calls the observed state by its neutral label, and its old sentences are gone', async () => {
    const { container, root } = await mount(answer([observedRow]))
    const summary = container.querySelector<HTMLButtonElement>('.mi-divergence__summary')!
    await act(async () => { summary.click() })
    const detail = container.querySelector('[data-divergence-detail]')!
    // 观察态挂的是中性标签，不是方向标签（「偏空」二字只作为那句中性话的一部分出现）。
    expect(detail.querySelector('[data-direction="unpriced"] .mi-divergence__direction')?.textContent).toBe(text.observedLabel)
    // 界面设计 2026-11-08 §九：旧两句字随实现同笔删，别让两套说法并存。
    expect(Object.keys(text.directions)).toEqual(['bearish', 'bullish'])
    expect('mechanism' in text.pairs['narrative-price']).toBe(false)
    await act(async () => { root.unmount() })
  })
})

describe('divergence panel · the states around the line', () => {
  it('shows only the loading state before the first read, without a summary', () => {
    const markup = render({ state: 'loading' })
    expect(markup).toContain(text.loading)
    expect(markup).not.toContain('mi-divergence__summary')
    expect(markup).not.toContain(text.summary.quiet)
  })

  it('keeps a failed read out of the summary line', () => {
    const markup = render({ state: 'unavailable', reason: 'query-failed', missing: [] })
    expect(markup).toContain(text.unavailableTrace)
    expect(markup).not.toContain('mi-divergence__summary')
  })

  it('renders the summary in the reader language', () => {
    const english = productText['en-US'].pages.intelligence.portal.dashboard.divergence
    const markup = render(answer([row]), 'en-US')
    expect(markup).toContain(english.summary.divergence)
    expect(markup).not.toContain(text.summary.divergence)
  })
})

describe('divergence panel · the rule clause on the muted line', () => {
  const mount = async (state: Parameters<typeof DivergencePanel>[0]['state']) => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(scoped(createElement(DivergencePanel, { state, onRetry: () => undefined, text })))
    })
    await act(async () => { container.querySelector<HTMLButtonElement>('.mi-divergence__summary')!.click() })
    return { container, root }
  }

  it('writes the rule after the as-of instants, reading the threshold from the contract', async () => {
    const { container, root } = await mount(answer([boundRow]))
    const line = container.querySelector('.mi-divergence__asof')!.textContent ?? ''
    const threshold = divergencePolicy.thresholds.openInterest24hUpPercent
    // 子句恰好一次，顺序固定：截至在前、规则在后。
    expect(line.match(new RegExp(text.boundAtLeast.split('{')[0]!.trim(), 'g'))).toHaveLength(1)
    expect(line.indexOf('截至')).toBeLessThan(line.indexOf('规则'))
    // 阈值只能来自契约：写死 +3 之类的数字会在这里对不上。
    expect(line).toContain(`规则 ≥ +${threshold}%`)
    // 今天投影层没有「还差」，所以不显示——规则是已知事实，距离不是。
    expect(line).not.toContain('还差')
    expect(line).not.toContain('|')
    await act(async () => { root.unmount() })
  })

  it('says 变动不超过 for an absolute bound instead of drawing bars', async () => {
    const { container, root } = await mount(answer([absoluteRow]))
    const line = container.querySelector('.mi-divergence__asof')!.textContent ?? ''
    const threshold = divergencePolicy.thresholds.openInterestFlatPercent
    expect(line).toContain(`规则 变动不超过 ${threshold}%`)
    // 判据：绝对值那条不出现 `|`，也不出现 abs(。
    expect(line).not.toContain('|')
    expect(line).not.toContain('abs(')
    await act(async () => { root.unmount() })
  })

  it('keeps every threshold and distance decision out of the renderer', () => {
    // 渲染层不许出现阈值字面量、也不许自己做百分比换算或取绝对值：那会变成规则的第二份实现。
    const raw = readFileSync('products/market-intelligence/desktop/features/industry/divergence/DivergencePanel.tsx', 'utf8')
    // 注释里的例子（「≥ +3%」）不算实现：只看真正会执行的代码。
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(source).not.toMatch(/\+3|−3|\b1%/)
    expect(source).not.toContain('toFixed')
    expect(source).not.toContain('Math.abs')
    expect(source).not.toMatch(/\*\s*100/)
    // `|` 只在**文案**里禁：源码里的联合类型天生带竖线，那不是在给读者看记号。
    expect(text.boundAtLeast).not.toContain('|')
    expect(text.boundAtMostNegative).not.toContain('|')
    expect(text.boundAtMostAbsolute).not.toContain('|')
    expect(text.boundAtMostAbsolute).not.toContain('abs(')
  })
})

describe('divergence panel · the explanation sits behind one icon', () => {
  const mount = async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(scoped(createElement(DivergencePanel, { state: answer([boundRow]), onRetry: () => undefined, text })))
    })
    return { container, root }
  }

  it('renders the icon only while expanded, and keeps the four sentences out of the body', async () => {
    const { container, root } = await mount()
    const icon = () => container.querySelector(`button[aria-label="${text.helpLabel}"]`)
    // 收起时 0 颗；正文里四句命中 0。
    expect(icon()).toBeNull()
    for (const sentence of text.notes) expect(container.textContent).not.toContain(sentence)
    await act(async () => { container.querySelector<HTMLButtonElement>('.mi-divergence__summary')!.click() })
    // 展开时恰好 1 颗，正文里仍然 0 句。
    expect(container.querySelectorAll(`button[aria-label="${text.helpLabel}"]`)).toHaveLength(1)
    for (const sentence of text.notes) expect(container.textContent).not.toContain(sentence)
    await act(async () => { root.unmount() })
  })

  it('puts the icon right after a title, never at the row end and never on a bare row', () => {
    // 界面 2026-11-08：展开区的 ⓘ 必须紧跟一行有文字的标题；推到行尾或放进没有文字的行都判红。
    const css = readFileSync('products/market-intelligence/desktop/features/industry/divergence/DivergencePanel.css', 'utf8')
    const head = css.match(/\.mi-divergence__detail-head \{([^}]*)\}/)?.[1] ?? ''
    expect(head).toContain('display: flex')
    expect(head).toContain('gap: 4px')
    expect(head).toContain('flex-wrap: nowrap')
    // 两种被否掉的写法一个都不许出现。
    expect(head).not.toContain('flex-end')
    expect(head).not.toContain('margin-left: auto')
    const title = css.match(/\.mi-divergence__detail-title \{([^}]*)\}/)?.[1] ?? ''
    expect(title).toContain('font-size: var(--mi-reading-note-size)')
    expect(title).not.toMatch(/font-size:\s*\d/)
  })

  it('renders the title text in the same row as the icon', async () => {
    const { container, root } = await mount()
    await act(async () => { container.querySelector<HTMLButtonElement>('.mi-divergence__summary')!.click() })
    const head = container.querySelector('.mi-divergence__detail-head')!
    // 同一个父容器里既有标题文字、也有那颗 ⓘ——不是两个块级兄弟。
    expect(head.querySelector('.mi-divergence__detail-title')?.textContent).toBe(text.detailTitle)
    expect(head.querySelector(`button[aria-label="${text.helpLabel}"]`)).not.toBeNull()
    await act(async () => { root.unmount() })
  })

  it('holds all four sentences in the popover, one per line', async () => {
    const { container, root } = await mount()
    await act(async () => { container.querySelector<HTMLButtonElement>('.mi-divergence__summary')!.click() })
    const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${text.helpLabel}"]`)!
    await act(async () => { trigger.focus() })
    await vi.waitFor(() => {
      const bubble = document.querySelector('[data-popover-content]')
      expect(bubble).not.toBeNull()
      expect([...(bubble?.querySelectorAll('[data-popover-line]') ?? [])].map(line => line.textContent))
        .toEqual([...text.notes])
    })
    await act(async () => { root.unmount() })
  })
})


