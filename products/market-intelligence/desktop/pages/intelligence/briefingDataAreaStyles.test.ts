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
  it('keeps the heading a heading, and the three words the sheet names', () => {
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

describe('the exported sheet is its own palette', () => {
  it('uses no theme variable anywhere', () => {
    // The poster is printed on paper: its colours must not follow the app's light/dark theme, or the same
    // edition exports two different images. One `var(--mi-…)` is enough to break that promise.
    expect(css.includes('var(--mi-')).toBe(false)
  })

  it("keeps the positioning amount in the sheet's own ink", () => {
    expect(declaration(rule('.mi-brief-poster__leverage-amount'), 'color')).toBe('#1b1d18')
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
