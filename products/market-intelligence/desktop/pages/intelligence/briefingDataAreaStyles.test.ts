import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { policyGaugePaints, policyGaugeTrackPaint } from './policyGaugePaint'

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

/**
 * The line that says why a section has nothing in it. Two cases, one look: unreadable and genuinely
 * empty are the same sentence shape to a reader, and neither is a failure — so no warning ink, no icon,
 * no retry. It keeps a macro row's rhythm so the block does not collapse under its own heading.
 */
describe('the macro section says why it is empty', () => {
  it('keeps the spacing on the row and never draws its top line', () => {
    // The row is the grid's direct child, and it exists only when there are no event rows — so it is
    // always the first thing under the heading and must not open with a divider.
    const row = rule('.mi-brief-poster__macro-row-empty')
    expect(declaration(row, 'padding')).toBe('9px 0')
    expect(declaration(row, 'border-top')).toBe('0')
  })

  it('spans both columns in the section\'s secondary ink', () => {
    const empty = rule('.mi-brief-poster__macro-empty')
    // A line confined to the 112px date column reads as a missing date, not as an empty section.
    expect(declaration(empty, 'grid-column')).toBe('1 / -1')
    expect(declaration(empty, 'color')).toBe('#625f55')
    expect(declaration(empty, 'font-size')).toBe('12px')
    expect(declaration(empty, 'line-height')).toBe('1.5')
    // The row owns the spacing: carrying it here too would double the gap.
    expect(declaration(empty, 'padding')).toBeUndefined()
    expect(declaration(empty, 'border-top')).toBeUndefined()
  })

  it('does not look like a failure', () => {
    const empty = rule('.mi-brief-poster__macro-empty')
    expect(empty).not.toContain('#9f2d21')
    expect(empty).not.toContain('#8a5a12')
    expect(empty).not.toContain('background')
    expect(empty).not.toContain('border-left')
  })
})

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
    // The asset name sits where the rate card puts its title — the same corner, the same size and the
    // same warm ink — so the three cards read as one row of labelled readings rather than two different
    // conventions. It is out of the flow, so the figure must not move with it: hence the lead column's
    // compensating padding below.
    expect(declaration(rule('.mi-brief-poster__price-label'), 'font-size')).toBe('11px')
    expect(declaration(rule('.mi-brief-poster__price-label'), 'color')).toBe('#8a5a12')
    expect(declaration(rule('.mi-brief-poster__price-label'), 'position')).toBe('absolute')
    expect(declaration(rule('.mi-brief-poster__price-label'), 'top')).toBe('10px')
    expect(declaration(rule('.mi-brief-poster__price-label'), 'left')).toBe('14px')
    expect(declaration(rule('.mi-brief-poster__price-card'), 'position')).toBe('relative')
    // The figure rises 9px with the label gone, and that is the accepted result — padding it back
    // would reserve empty space to preserve a position the reader never memorised.
    expect(declaration(rule('.mi-brief-poster__price-lead'), 'padding-bottom')).toBeUndefined()
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
  // The named set from the acceptance: every rule allowed to draw a divider on the sheet. Scoped rather
  // than "all border-top", because card shells are borders on a card ground, not dividers — and
  // `.leverage-card` carries a tone, so pulling it in would make the judge's own input data-dependent.
  const DIVIDER_SELECTORS = [
    'news', 'number', 'next', 'foot', 'basis', 'footnotes',
    'news-section', 'data-section', 'macro', 'figure-line', 'next-row', 'overturn'
  ] as const

  it('draws every divider in the named set in one colour, solid and dashed alike', () => {
    // Comments are stripped first: a commented-out rule must not answer for a live one.
    const live = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const colours = new Set<string>()
    const missing: string[] = []
    for (const name of DIVIDER_SELECTORS) {
      const selector = `mi-brief-poster__${name}`
      const bodies = [...live.matchAll(new RegExp(`[^{}]*\\.${selector}[^{}]*\\{([^}]*)\\}`, 'g'))]
        .map((match) => match[1] ?? '')
      const found = bodies
        .flatMap((body) => [...body.matchAll(/border-(?:top|bottom)\s*:\s*1px\s+(?:solid|dashed)\s+(#[0-9a-fA-F]{3,8})/g)])
        .map((match) => match[1] as string)
      if (found.length === 0) missing.push(name)
      for (const colour of found) colours.add(colour)
    }
    // A renamed selector must red here, not vanish from the set: a divider nobody counts is a divider
    // nobody keeps visible, which is exactly how the dashed one was missed by three people at once.
    expect(missing).toEqual([])
    expect([...colours]).toEqual(['#c9bda3'])
  })

})

describe('the dial colour has one value on both sides', () => {
  /**
   * 用户 2026-11-06：导出图里那条弧是灰蓝的、页面是橙的——类名与内联描边各判一次，就必然分叉。
   * 现在颜色只写在 `policyGaugePaints`，这里逐条比对样式表：改配色时只改一处，另一处漏改就红。
   */
  it('matches every paint entry against its stylesheet rule', () => {
    for (const [tone, paint] of Object.entries(policyGaugePaints)) {
      expect(declaration(rule(`.${paint.className}`), 'stroke'), `${tone} 的描边`).toBe(paint.stroke)
      // Swatch（页面那侧的色块）也读同一个值：同一个类名，不许两种颜色说法。
      expect(declaration(rule(`.mi-brief-poster__policy-swatch.${paint.className}`), 'background'), `${tone} 的色块`)
        .toBe(paint.stroke)
    }
  })

  it('matches the track against its stylesheet rule too', () => {
    const track = rule('.mi-brief-poster__gauge-track')
    expect(declaration(track, 'stroke')).toBe(policyGaugeTrackPaint.stroke)
    expect(Number(declaration(track, 'opacity'))).toBe(policyGaugeTrackPaint.opacity)
  })
})
