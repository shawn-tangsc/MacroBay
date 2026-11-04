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
