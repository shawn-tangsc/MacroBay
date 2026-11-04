import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The data region's design values, read from the stylesheet itself.
 *
 * A DOM without layout cannot measure a font size, so "12px/600, 9.5px window, 11px level" used to be
 * checked by whoever opened the exported image — which is how a wrong size survives three reviews. These
 * are constants in a stylesheet, not behaviour: reading the file and comparing the value is the only
 * mechanical check there is, and it is a design-token test, not a source scan.
 *
 * What stays with the exported image and the eye: whether anything overlaps, wraps or runs out of its
 * box. Those are marked excluded and never claimed as verified here.
 */
const css = readFileSync(join(__dirname, 'dailyBriefingShareCard.css'), 'utf8')

/** The declarations of one top-level rule, by exact selector. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)
  if (!match) throw new Error(`no rule for ${selector}`)
  return match[1]!
}

function declaration(body: string, property: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'm').exec(body)
  return match?.[1]?.trim()
}

describe('the cell change is a number, sized to be read as one', () => {
  it('sizes the change, its window and the level to the sheet', () => {
    // The change is the figure the reader came for: one step up from the level, and bolder.
    expect(declaration(rule('.mi-brief-poster__figure-change b'), 'font-size')).toBe('12px')
    expect(declaration(rule('.mi-brief-poster__figure-change b'), 'font-weight')).toBe('600')
    // The window is the qualifier, so it is the smallest thing in the cell.
    expect(declaration(rule('.mi-brief-poster__figure-window'), 'font-size')).toBe('9.5px')
    // The level keeps its size and stays untinted.
    expect(declaration(rule('.mi-brief-poster__figure'), 'font-size')).toBe('11px')
  })

  it('tints the change and nothing else in the cell', () => {
    expect(declaration(rule(".mi-brief-poster__figure-change b[data-tone='up']"), 'color')).toBe('#1f5b32')
    expect(declaration(rule(".mi-brief-poster__figure-change b[data-tone='down']"), 'color')).toBe('#8f2a1d')
    // A tone on the cell itself would colour the level with it — the rule that did that is gone.
    expect(css.includes('.mi-brief-poster__figure[data-tone=')).toBe(false)
  })
})

describe('the positioning card leads with the amount, and the ring keeps its number inside', () => {
  it('sizes the amount as the trunk and the change beside it', () => {
    // 26/750 in body colour: the change carries the colour, so the amount must not be tinted.
    expect(declaration(rule('.mi-brief-poster__leverage-amount'), 'font-size')).toBe('26px')
    expect(declaration(rule('.mi-brief-poster__leverage-amount'), 'font-weight')).toBe('750')
    expect(declaration(rule('.mi-brief-poster__leverage-change'), 'font-size')).toBe('14px')
    expect(declaration(rule('.mi-brief-poster__leverage-change'), 'font-weight')).toBe('600')
    expect(declaration(rule(".mi-brief-poster__leverage-card[data-tone='up'] .mi-brief-poster__leverage-change"), 'color')).toBe('#1f5b32')
    expect(declaration(rule(".mi-brief-poster__leverage-card[data-tone='down'] .mi-brief-poster__leverage-change"), 'color')).toBe('#8f2a1d')
    // Nothing tints the card's own `b`: the amount is a level.
    expect(css.includes(".mi-brief-poster__leverage-card[data-tone='up'] b {")).toBe(false)
  })

  it("keeps the ring's number inside the bore, at the size that fits", () => {
    // 15px at top 27 is the one pair that satisfies both bounds: the widest bore row AND the chord line
    // at y=44. At 16px the number's bottom edge lands at 46 and hangs outside the arc.
    expect(declaration(rule('.mi-brief-poster__policy-probability'), 'top')).toBe('27px')
    expect(declaration(rule('.mi-brief-poster__policy-probability'), 'font-size')).toBe('15px')
    expect(declaration(rule('.mi-brief-poster__policy-probability'), 'line-height')).toBe('1')
  })

  it('never lets the change group shrink', () => {
    // The label may be clipped; the number may not. Without this the inline-flex is only protected by an
    // implicit `min-width: auto`, and one later `min-width: 0` would start cutting values.
    expect(declaration(rule('.mi-brief-poster__figure-change'), 'flex')).toBe('0 0 auto')
  })
})

describe('the block headings and the row lines', () => {
  it('keeps the heading a heading, in three words that say what the block holds', () => {
    // A heading differs from the body by hue and tracking, not by size.
    expect(declaration(rule('.mi-brief-poster__block-title'), 'font-size')).toBe('10px')
    expect(declaration(rule('.mi-brief-poster__block-title'), 'font-weight')).toBe('700')
    expect(declaration(rule('.mi-brief-poster__block-title'), 'letter-spacing')).toBe('.1em')
    expect(declaration(rule('.mi-brief-poster__block-title'), 'color')).toBe('#8a5a35')
    // The positioning block's heading follows the same rule — two headings, one style.
    expect(declaration(rule('.mi-brief-poster__leverage-title'), 'font-size')).toBe('10px')
    expect(declaration(rule('.mi-brief-poster__leverage-title'), 'letter-spacing')).toBe('.1em')
    expect(declaration(rule('.mi-brief-poster__leverage-title'), 'color')).toBe('#8a5a35')
  })

  it('draws the row line on the row, in a colour that shows on the paper', () => {
    expect(declaration(rule('.mi-brief-poster__figure-line'), 'column-gap')).toBe('32px')
    expect(declaration(rule('.mi-brief-poster__figure-line'), 'border-bottom')).toBe('1px solid #c9bda3')
    // Three fixed columns that may shrink: `1fr` alone would let the longest cell widen its column.
    expect(declaration(rule('.mi-brief-poster__figure-line'), 'grid-template-columns')).toBe('repeat(3, minmax(0, 1fr))')
    // The block's last row closes by the space after it, not by a line above the next heading.
    expect(css.includes('.mi-brief-poster__market-block > .mi-brief-poster__figure-line:last-of-type')).toBe(true)
  })
})

describe('the amplitude label lives on the plot, not in the drawing', () => {
  it('sizes it as the smallest label and pins it to the corner the area does not use', () => {
    expect(declaration(rule('.mi-brief-poster__amplitude'), 'font-size')).toBe('9.5px')
    expect(declaration(rule('.mi-brief-poster__amplitude'), 'color')).toBe('#6b695f')
    // HTML over the plot: an `svg` <text> would break the card's zero-text rule.
    expect(declaration(rule('.mi-brief-poster__price-plot > .mi-brief-poster__amplitude'), 'position')).toBe('absolute')
    expect(declaration(rule('.mi-brief-poster__price-plot > .mi-brief-poster__amplitude'), 'right')).toBe('3px')
    expect(declaration(rule('.mi-brief-poster__price-plot > .mi-brief-poster__amplitude'), 'bottom')).toBe('3px')
    // A rising window fills above the axis, so the label moves to the free side.
    expect(declaration(rule(".mi-brief-poster__price-plot > .mi-brief-poster__amplitude[data-side='above']"), 'top')).toBe('3px')
    // The text column is two lines and centred, not three lines spread out.
    expect(declaration(rule('.mi-brief-poster__price-lead'), 'justify-content')).toBe('center')
  })
})

describe('the fear-and-greed band word has its own tone', () => {
  it('tints the judgement in the move palette, and nothing else', () => {
    // Neutral is a judgement too: without its own ink it inherits the score's body colour and reads as
    // part of the number. The two tone rules below override this one.
    expect(declaration(rule('.mi-brief-poster__figure-band'), 'color')).toBe('#6b695f')
    expect(declaration(rule(".mi-brief-poster__figure-band[data-tone='down']"), 'color')).toBe('#8f2a1d')
    expect(declaration(rule(".mi-brief-poster__figure-band[data-tone='up']"), 'color')).toBe('#1f5b32')
    // The cell itself still carries no tone: the score keeps the body ink.
    expect(css.includes('.mi-brief-poster__figure[data-tone=')).toBe(false)
  })
})

describe('blocks are separated by space, not by a line', () => {
  it('keeps one distance between blocks and draws nothing between them', () => {
    // 12 is the distance the sheet had before it was widened; the lines inside a block separate rows.
    expect(declaration(rule('.mi-brief-poster__data'), 'gap')).toBe('12px')
    // The positioning block was rewritten into two cards and an older rule kept a `border-top` plus its own
    // margin — that leftover rule was the line the reader saw above 持仓与费率.
    expect(css.match(/\.mi-brief-poster__leverage\s*\{/g) ?? []).toHaveLength(1)
    expect(declaration(rule('.mi-brief-poster__leverage'), 'border-top')).toBeUndefined()
    expect(declaration(rule('.mi-brief-poster__leverage'), 'margin-top')).toBeUndefined()
    // Rows inside a block still have their line; only the block's last row drops it.
    expect(declaration(rule('.mi-brief-poster__figure-line'), 'border-bottom')).toBe('1px solid #c9bda3')
    // The group rule that drops the block's last row line is asserted where it is written (two selectors,
    // one declaration), rather than through a single-selector lookup.
    expect(css).toContain('.mi-brief-poster__funds-block > .mi-brief-poster__figure-line:last-of-type')
  })
})

describe('the price card leads with the level, and the move is the only tinted thing', () => {
  it('sizes the level, the move, the label and the proxy mark to the sheet', () => {
    // 26px is the size that fits the 178px text column; 30px needed 187 and pushed the label over.
    expect(declaration(rule('.mi-brief-poster__price-value'), 'font-size')).toBe('26px')
    expect(declaration(rule('.mi-brief-poster__price-value'), 'font-weight')).toBe('750')
    // The level never takes the card's tone: that colour belongs to the move beside it.
    expect(declaration(rule('.mi-brief-poster__price-value'), 'color')).toBe('#1b1d18')
    expect(declaration(rule('.mi-brief-poster__price-change'), 'font-size')).toBe('14px')
    expect(declaration(rule('.mi-brief-poster__price-change'), 'font-weight')).toBe('600')
    expect(declaration(rule(".mi-brief-poster__price-change[data-tone='up']"), 'color')).toBe('#1f5b32')
    expect(declaration(rule(".mi-brief-poster__price-change[data-tone='down']"), 'color')).toBe('#8f2a1d')
    // The label is a qualifier, and the proxy mark matches it rather than shouting.
    expect(declaration(rule('.mi-brief-poster__price-label'), 'font-size')).toBe('11px')
    expect(declaration(rule('.mi-brief-poster__price-label'), 'color')).toBe('#6b695f')
    expect(declaration(rule('.mi-brief-poster__price-proxy'), 'font-size')).toBe('11px')
    expect(declaration(rule('.mi-brief-poster__price-proxy'), 'font-weight')).toBe('400')
    expect(declaration(rule('.mi-brief-poster__price-proxy'), 'color')).toBe('#6b695f')
    // No stored close: the dash and its reason, in the card's muted ink.
    // The dash keeps the level's ink (it stands in the level's place); only the reason is a small grey
    // comment. Writing the dash grey as well made it read as an annotation rather than a value.
    expect(declaration(rule('.mi-brief-poster__price-missing'), 'color')).toBe('#6b695f')
    expect(declaration(rule('.mi-brief-poster__price-missing'), 'font-size')).toBe('9.5px')
  })
})

describe('the dial colours follow the lead, not the segment name', () => {
  it('keeps four colours in the palette and paints each arc from its role', () => {
    expect(declaration(rule('.mi-brief-poster__gauge-hike'), 'stroke')).toBe('#c2410c')
    expect(declaration(rule('.mi-brief-poster__gauge-cut'), 'stroke')).toBe('#1f5b32')
    expect(declaration(rule('.mi-brief-poster__gauge-hold'), 'stroke')).toBe('#3f6d8f')
    expect(declaration(rule('.mi-brief-poster__gauge-other'), 'stroke')).toBe('#8c8474')
    // The old role-named colours are gone: two names for the same arc is how a dial ends up painted
    // one colour and keyed another.
    expect(css.includes('.mi-brief-poster__gauge-event')).toBe(false)
    expect(css.includes('.mi-brief-poster__gauge-rest')).toBe(false)
    // The swatch beside a share takes the arc's own class, so it cannot drift from the drawing.
    expect(declaration(rule('.mi-brief-poster__policy-swatch'), 'width')).toBe('8px')
    expect(declaration(rule('.mi-brief-poster__policy-swatch.mi-brief-poster__gauge-hold'), 'background')).toBe('#3f6d8f')
    expect(declaration(rule('.mi-brief-poster__policy-swatch.mi-brief-poster__gauge-other'), 'background')).toBe('#8c8474')
    // The target range moved into the reading column, small and grey, on the meeting's own line.
    expect(declaration(rule('.mi-brief-poster__policy-range-line'), 'font-size')).toBe('9.5px')
    expect(declaration(rule('.mi-brief-poster__policy-range-line'), 'color')).toBe('#6b695f')
  })
})

describe('the money cell leads with its one real number', () => {
  it('tints a signed flow in the primary slot, and leaves a level untinted', () => {
    // The ETF row's only figure is the day's net flow: it takes the primary slot and carries a sign, so
    // it uses the change palette. A level (a price, a stock) still prints in the body ink.
    expect(declaration(rule(".mi-brief-poster__figure > b[data-tone='up']"), 'color')).toBe('#1f5b32')
    expect(declaration(rule(".mi-brief-poster__figure > b[data-tone='down']"), 'color')).toBe('#8f2a1d')
  })
})

describe('the paper has one divider colour', () => {
  it('keeps every 1px row divider the same colour, and only that colour', () => {
    // One colour for every divider: two depths on the same sheet beat nothing — the reader cannot tell
    // what the deeper one means, and it becomes the next "why is this line darker" question. The value
    // lives in 07-style-values.md; here only the count of distinct values is judged.
    const dividers = [...css.matchAll(/border-top:\s*1px solid\s*(#[0-9a-fA-F]{3,8})/g)].map((match) => match[1])
    expect(dividers.length).toBeGreaterThan(0)
    expect([...new Set(dividers)]).toEqual(['#c9bda3'])
  })
})

/**
 * 注释里不许出现「当前值的写法」。
 *
 * 定值是常量，不是行为：现值只许住在 `07-style-values.md` 和本文件里，注释里复述一份就必然过期——
 * 今晚已经有两处与规则相反（环心字号/位置、卡底那句），而且都是偶然翻到的。
 *
 * 只禁「当前值的写法」，不禁数值：`font-size: 15px`、`#ded4c2` 判红，而 `≥2px`、`< 114px` 这类**约束**
 * 放行。注释说不了约束就只能删掉，删掉的是一段理由，那比一个过期的数更贵。
 */
describe('the comments state constraints, not current values', () => {
  const blocks = (text: string): readonly string[] => text.match(/\/\*[\s\S]*?\*\//g) ?? []
  const currentValue = /(?:^|[^\w-])(top|right|bottom|left|font-size|line-height|width|height|gap|color|background)\s*:/i
  const colour = /#[0-9a-fA-F]{3,8}\b/

  it('carries no property-value pair and no colour literal', () => {
    expect(blocks(css).filter((block) => currentValue.test(block) || colour.test(block))).toEqual([])
  })

  it('would catch a restated value, and still lets a constraint speak', () => {
    // 没人见它红过的校验，可能根本不会红。
    expect(blocks('/* the ring sits at top: 25 with 16px type */').filter((block) => currentValue.test(block))).toHaveLength(1)
    expect(blocks('/* the hairline is #ded4c2 */').filter((block) => colour.test(block))).toHaveLength(1)
    expect(blocks('/* keeps ≥2px of clearance inside a 114px bore */').filter((block) => currentValue.test(block) || colour.test(block))).toHaveLength(0)
  })
})
