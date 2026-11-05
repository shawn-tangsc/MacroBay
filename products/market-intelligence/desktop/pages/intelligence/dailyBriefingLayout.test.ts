import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * Declaration-level checks for the page grid.
 *
 * happy-dom has no layout engine, so a rectangle assertion here would pass on any CSS at all. What
 * can be checked is what the stylesheet declares: a desktop window keeps three columns, and only a
 * genuinely narrow one stacks the audit column under the report.
 */
const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/dailyBriefing.css', 'utf8')

describe('daily briefing layout', () => {
  it('keeps the audit column beside the report at desktop widths', () => {
    expect(css).toContain('.mi-daily-briefing-page__body--with-appendix { grid-template-columns: clamp(240px, 18vw, 320px) minmax(0, 1fr) clamp(240px, 18vw, 320px);')
    // No rule may stack it at a width a normal desktop window sits in: 1450px did exactly that.
    expect(css).not.toContain('max-width: 1450px')
  })

  it('keeps a stage name on one line, even when the rail is narrower than the name', () => {
    // The stage name is a cell in a fixed column: wrapping it into two lines moved the times and the
    // row pitch with it. It may shorten, never break.
    const name = css.slice(css.indexOf('.mi-brief-steps__name {'))
    const nameRule = name.slice(0, name.indexOf('}'))
    expect(nameRule).toContain('white-space: nowrap')
    expect(nameRule).toContain('text-overflow: ellipsis')
    const detail = css.slice(css.indexOf('.mi-brief-steps__detail {'))
    expect(detail.slice(0, detail.indexOf('}'))).toContain('white-space: nowrap')
  })

  it('stacks only below a narrow window', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 980px) { .mi-daily-briefing-page__body--with-appendix'))
    expect(narrow).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(narrow).toContain('.mi-daily-briefing-page__appendix { grid-column: 1 / -1;')
  })
})

/**
 * The toolbar had five actions in five separate changes, and each change copied its own 28px/10.5px
 * skeleton — so the row grew two filled buttons and a fifth that fell back to the plain default.
 * These two counts are what that failure looks like from the stylesheet's side: one skeleton, one
 * primary. A sixth button can be added without touching either, which is the point.
 */
describe('one toolbar shape, one primary', () => {
  const pageActions = readFileSync('products/market-intelligence/desktop/pages/intelligence/DailyBriefingPageActions.tsx', 'utf8')

  it('declares the button skeleton exactly once', () => {
    const skeleton = css.match(/height: 28px; padding: 0 10px; border: 1px solid/g) ?? []
    expect(skeleton).toHaveLength(1)
  })

  it('marks exactly one action in the row as primary', () => {
    expect(pageActions.match(/mi-briefing-tool__btn--primary/g) ?? []).toHaveLength(1)
  })

  it('gives every toolbar button the shared class instead of a private one', () => {
    for (const legacy of ['mi-daily-briefing__copy', 'mi-daily-briefing__regenerate', 'mi-daily-briefing__export']) {
      expect(css).not.toContain(`.${legacy} {`)
    }
  })
})

/**
 * The row carries two small markers side by side — the window and the source. Two markers of the
 * same kind at two sizes read as an accident, so they share one geometry declaration and differ
 * only in colour. A second copy of the skeleton is how they drift apart again.
 */
describe('one rail chip shape', () => {
  it('declares the window and source geometry exactly once', () => {
    expect(css.match(/padding: 1px 4px; border-radius: 3px;/g) ?? []).toHaveLength(1)
    const shared = css.slice(css.indexOf('.mi-daily-briefing__rail-fact[data-window-hours],'))
    expect(shared.slice(0, shared.indexOf('}'))).toContain('.mi-daily-briefing__rail-source')
  })

  it('tints both chips at the same strength, set by contrast rather than taste', () => {
    // 14% measured 4.26:1 for a muted 9px word on a selected row — under the 4.5 small-text floor;
    // 10% measures 5.11 / 4.58. Equal geometry over an unequal tint is two markers that only look
    // alike, so the three chip backgrounds must carry one number.
    const chipRules = css.split('}').filter((rule) => /data-window-hours|rail-source/.test(rule))
    const tints = [...chipRules.join('}').matchAll(/\) (\d+)%, transparent\)/g)].map((match) => match[1])
    expect(new Set(tints)).toEqual(new Set(['10']))
  })

  it('turns only a failed source red, and keeps the rest neutral', () => {
    // lastIndexOf: the first `.rail-source {` in the sheet is the shared-geometry block above.
    const source = css.slice(css.lastIndexOf('.mi-daily-briefing__rail-source {'))
    expect(source.slice(0, source.indexOf('}'))).toContain('var(--mi-dashboard-muted)')
    const failed = css.slice(css.indexOf('.mi-daily-briefing__rail-source[data-run-source="failed"]'))
    const failedRule = failed.slice(0, failed.indexOf('}'))
    expect(failedRule).toContain('var(--mi-dashboard-negative)')
    // Exactly one kind carries its own colour. A second coloured kind is a new verdict, not a style
    // tweak, and a row of coloured badges turns scanning into reading — so it has to be deliberate.
    expect(tonedKinds()).toEqual(['failed'])
  })
})

/**
 * The two-line row is a shape, and a shape is exactly what "restore it as drawn" has to be checked
 * against: a fixed row height, a wrapping title or a language pushed to the far right each look
 * plausible on their own and all three break the pitch of the list. These are the design numbers.
 */
describe('two-line rail row', () => {
  it('lets the content set the row height instead of fixing it', () => {
    const row = rule('.mi-daily-briefing__rail-row {')
    expect(row).not.toContain('height:')
    expect(row).toContain('padding: 4px 6px;')
  })

  it('keeps the title on one line under a name of its own', () => {
    // `__rail-title` is the rail's heading; sharing it would give the heading a row's clipping.
    expect(css).not.toContain('.mi-daily-briefing__rail-title { font-size: 10.5px')
    const title = rule('.mi-daily-briefing__rail-row-title {')
    expect(title).toContain('white-space: nowrap')
    expect(title).toContain('text-overflow: ellipsis')
    expect(title).toContain('font-size: 10.5px')
    expect(title).toContain('line-height: 1.4')
  })

  it('sits the language right after the source instead of pushing it to the edge', () => {
    expect(rule('.mi-daily-briefing__rail-lang {')).toContain('margin-left: 0;')
  })

  it('separates facts by space, not by a dot between every pair', () => {
    expect(css).not.toContain('.mi-daily-briefing__rail-fact + .mi-daily-briefing__rail-fact::before')
  })
})

/**
 * The day rhythm is 4 / 1 / 8 — 4px inside a row, 1px between rows, 8px between days — and the
 * heading sits 10px above the first day. These are the numbers the reference is drawn on, so they
 * are checked here rather than left to whoever reads the sheet next.
 */
describe('day rhythm and the row menu trigger', () => {
  it('spaces a day 8px above and below, with one hairline between days', () => {
    const day = rule('.mi-daily-briefing__rail-day {')
    expect(day).toContain('padding: 8px 0;')
    expect(day).toContain('border-top: 1px solid var(--mi-dashboard-line)')
  })

  it('keeps the heading 10px above the first day and the day head flush to its padding', () => {
    expect(rule('.mi-daily-briefing__rail-title {')).toContain('margin: 0 0 10px')
    expect(rule('.mi-daily-briefing__rail-day-head {')).toContain('padding: 0 6px 6px')
    expect(rule('.mi-daily-briefing__rail-day-count {')).toContain('margin-left: auto')
  })

  it('draws the selected row from tokens, at the measured tint', () => {
    // 4% and 22% are measured, not chosen: 5% leaves the source chip at 4.46:1 on a selected row.
    const selected = rule('.mi-daily-briefing__rail-row[aria-current="true"] {')
    expect(selected).toContain('color-mix(in srgb, var(--mi-dashboard-lime) 4%, transparent)')
    expect(selected).toContain('color-mix(in srgb, var(--mi-dashboard-lime) 22%, transparent)')
    expect(selected).toContain('inset 2px 0 var(--mi-dashboard-lime)')
    // The radius must not change with selection: a row that changes shape when picked reads as a
    // different kind of row rather than the same row, marked.
    expect(selected).toContain('border-radius: 6px;')
    expect(selected).not.toMatch(/#[0-9a-f]{3,8}/i)
  })

  it('hides the menu trigger until the row is hovered or focused', () => {
    // The drawn list has no ⋯: a permanent slot would shorten every title against the reference.
    expect(rule('.mi-daily-briefing__rail-item-menu {')).toContain('opacity: 0')
    expect(css).toContain('.mi-daily-briefing__rail-item:focus-within .mi-daily-briefing__rail-item-menu')
  })
})

/** The declarations of one rule, keyed by its selector. */
function rule(selector: string): string {
  const start = css.indexOf(selector)
  expect(start).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

/** Which source kinds carry a colour of their own. */
function tonedKinds(): string[] {
  const kinds = [...css.matchAll(/\[data-run-source="([a-z-]+)"\]/g)].map((match) => match[1] as string)
  return [...new Set(kinds)].sort()
}
