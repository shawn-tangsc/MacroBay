import { readdirSync, readFileSync } from 'node:fs'

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

  it('ends every row with the language in the same column', () => {
    // The language pushes itself right: the whitespace between facts and language is the alignment.
    expect(rule('.mi-daily-briefing__rail-lang {')).toContain('margin-left: auto;')
    // Never compressed: the row gives up characters of its own tail first.
    expect(rule('.mi-daily-briefing__rail-lang {')).toContain('flex: 0 0 auto;')
    expect(rule('.mi-daily-briefing__rail-fact {')).toContain('min-width: 0;')
  })

  it('leaves no separator between the source and the language', () => {
    // The dot only bridged two adjacent chips; with the language at the far edge it is a broken mark.
    // Two assertions, because one alone guards half: the stylesheet must not carry the class, and no
    // component may render the element again. The old rule merely hid it, which is how a comment ended
    // up describing a span that no longer existed.
    expect(css).not.toContain('mi-daily-briefing__rail-sep')
    expect(rowSources()).not.toContain('rail-sep')
  })

  it('keeps no rules for the withdrawn day summary', () => {
    // The folded day says only what belongs to the day; its one-line summary left the design, and its
    // rules and markup left with it rather than staying behind as a shape nothing renders.
    expect(css).not.toContain('mi-daily-briefing__rail-day-summary')
    expect(rowSources()).not.toContain('rail-day-summary')
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
    // No ink of its own: a selected row is the same row with a marker, not a brighter kind of row.
    expect(selected).not.toContain('color: var(--mi-dashboard-text)')
    expect(selected).not.toMatch(/#[0-9a-f]{3,8}/i)
  })

  it('has no hidden trailing-edge trigger left over', () => {
    // The row's menu is the context menu; a hover-revealed icon at the trailing edge was deleted with
    // it, and leaving its rules behind would tell the next reader the trigger is still there.
    expect(css).not.toContain('.mi-daily-briefing__rail-item-menu')
  })

})

/**
 * The destructive action is the fifth button in the toolbar: it keeps the group's skeleton and takes
 * only the danger ink. Coloured by the antd `danger` prop alone it drifts into antd's red, which is
 * not the dashboard's, and it is the one button a reader should be able to recognise at a glance.
 */
describe('one danger action in the toolbar', () => {
  it('takes the dashboard red, not a literal and not another palette', () => {
    const danger = rule('.mi-briefing-tool__btn.mi-briefing-tool__btn--danger {')
    expect(danger).toContain('var(--mi-dashboard-negative)')
    expect(danger).not.toMatch(/#[0-9a-f]{3,8}/i)
  })

  it('fades with the row instead of inventing a second disabled look', () => {
    const disabled = rule('.mi-briefing-tool__btn.mi-briefing-tool__btn--danger:disabled {')
    expect(disabled).toContain('opacity: .55;')
  })
})

/**
 * Two rows of actions answer two different questions: the page decides whether today happens, the
 * report decides what to do with the issue on screen. The report's row is part of the card and lives
 * outside the scroll area, so it cannot scroll away and a scrollbar cannot reach it.
 */
describe('the report actions do not scroll', () => {
  it('lays the card out as a fixed row above a scrolling sheet area', () => {
    const card = rule('.mi-daily-briefing-page__report-card {')
    expect(card).toContain('display: flex;')
    expect(card).toContain('flex-direction: column;')
    expect(card).toContain('min-height: 0;')
    // The sheet's corners are clipped by the card, not by its own overflow.
    expect(card).toContain('overflow: hidden;')

    const scroll = rule('.mi-daily-briefing-page__report-scroll {')
    expect(scroll).toContain('overflow-y: auto;')
    // `min-height: 0` is the condition that makes it scroll at all: a flex child defaults to
    // `min-height: auto`, grows with its content, and never overflows — "cannot scroll".
    expect(scroll).toContain('min-height: 0;')
    expect(scroll).toContain('flex: 1 1 auto;')
    // Equal insets: the overlay scrollbar floats in the right-hand dark band, not on the cream sheet.
    expect(scroll).toContain('padding: 12px;')
  })

  it('gives the grid row a bounded height, or the card grows and nothing scrolls', () => {
    // An auto grid row grows with its content, so the card inside it grows as well and the scroll area
    // never becomes shorter than the sheet. The symptom is "the report cannot scroll".
    expect(rule('.mi-daily-briefing-page__body {')).toContain('grid-template-rows: minmax(0, 1fr);')
    expect(rule('.mi-daily-briefing-page__content {')).toContain('overflow: hidden;')
  })

  it('keeps the row out of every scroll container and stops being sticky', () => {
    const bar = rule('.mi-daily-briefing-page__report-bar {')
    // A row that never moves needs no sticky offset — and `position: sticky` is exactly the shape this
    // rule must not come back to.
    expect(bar).not.toContain('position: sticky')
    expect(bar).toContain('flex: none;')
    // Painted in both states, because there is only one state now.
    expect(bar).toContain('background: var(--mi-dashboard-surface);')
    expect(bar).toContain('border-bottom: 1px solid color-mix(in srgb, var(--mi-dashboard-line) 55%, transparent);')
  })

  it('keeps no leftovers of the pinned state', () => {
    // `data-stuck`, the zero-height sentinel and the observer were the previous design. Leaving their
    // rules behind would be a second, contradictory answer to the same question.
    expect(css).not.toContain('data-stuck')
    expect(css).not.toContain('.mi-daily-briefing-page__report-sentinel')
  })
})

/**
 * The four plain buttons used to render as empty boxes: their colour came from a single-class rule that
 * ties with antd's injected `.ant-btn`, and the injected sheet wins on order — only the destructive
 * button kept its word, because its colour came from a compound selector. Text at the wrong colour is
 * not a styling preference; it is missing text.
 */
describe('the toolbar buttons keep their word visible', () => {
  it('scopes the ink so the token wins over antd', () => {
    const scoped = rule('.mi-daily-briefing-page__bar .mi-briefing-tool__btn,')
    expect(scoped).toContain('.mi-daily-briefing-page__report-bar .mi-briefing-tool__btn')
    expect(scoped).toContain('color: var(--mi-dashboard-muted);')
  })

  it('keeps a disabled button readable instead of letting antd grey it out of sight', () => {
    const disabled = rule('.mi-daily-briefing-page__bar .mi-briefing-tool__btn:disabled,')
    expect(disabled).toContain('.mi-daily-briefing-page__report-bar .mi-briefing-tool__btn:disabled')
    expect(disabled).toContain('color: var(--mi-dashboard-muted);')
  })
})

/**
 * Three boxes, three jobs: the content column scrolls, the card holds the actions and the sheet, the
 * sheet is the document. Buttons inside the sheet would be exported onto the report; the sheet inside
 * the action row's shape would move the export boundary. The card is what makes the difference
 * visible, so its geometry is checked rather than left to whoever edits the sheet next.
 */
describe('card, actions and sheet stay three boxes', () => {
  it('gives the card its own rounded border around the actions and the sheet', () => {
    const card = rule('.mi-daily-briefing-page__report-card {')
    expect(card).toContain('border: 1px solid var(--mi-dashboard-line);')
    expect(card).toContain('border-radius: 14px;')
    // The padding belongs to the two inner boxes, not to the card: the row and the sheet each carry
    // their own 12px inset, and the scrollbar's band comes from the sheet's box.
    expect(card).not.toContain('padding:')
  })

  it('lets the sheet take the card inner width and keep its own radius', () => {
    const paper = rule('.mi-daily-briefing-page__paper {')
    // fit-content would shrink the sheet to the buttons and move the export boundary with it.
    expect(paper).toContain('width: 100%;')
    expect(paper).toContain('border-radius: 10px;')
    // No second edge on the sheet: the cream already separates from the card.
    expect(paper).toContain('border: 0;')
  })
})

/**
 * The refusal line in the manual-run dialog: one class, two tiers. Shape is checked because the dialog
 * already has a general 12px note — a refusal that renders at 12px is read before the field it is about,
 * and the reader gets the explanation before the thing it explains.
 */
describe('one refusal line, two tones', () => {
  it('matches the field label size instead of outranking it', () => {
    const line = rule('.mi-briefing-period-dialog__conflict {')
    expect(line).toContain('font-size: 10.5px;')
    expect(line).toContain('color: var(--mi-dashboard-muted);')
  })

  it('marks itself with a 5px dot that cannot shrink', () => {
    const dot = rule('.mi-briefing-period-dialog__conflict::before {')
    expect(dot).toContain('width: 5px;')
    expect(dot).toContain('flex: none;')
    expect(dot).toContain('background: var(--mi-dashboard-caution);')
  })

  it('turns red only for a value that is actually invalid', () => {
    const invalid = rule('.mi-briefing-period-dialog__conflict[data-tone="invalid"] {')
    expect(invalid).toContain('var(--mi-dashboard-negative)')
    // One class only: a second class for the red tier is how the two tiers drift apart.
    expect(css).not.toContain('.mi-briefing-period-dialog__conflict--')
  })
})

/**
 * Explanatory paragraphs are gone from the manual-run dialog: each one became a question beside the
 * label it explains. The question comes first, 6px from the title, vertically centred — the settings
 * form already does this, and two arrangements for the same idea is how a reader learns neither.
 */
describe('a dialog label and its question are one row', () => {
  it('puts the question first, 6px from the title, on the same line', () => {
    // The dialog reuses the settings form's label class, whose rule is scoped to that form — so the row
    // has to be declared for this dialog too, or the question sits flush against the title.
    const label = rule('.mi-briefing-period-dialog .mi-daily-briefing__field-label {')
    expect(label).toContain('display: inline-flex;')
    expect(label).toContain('align-items: center;')
    expect(label).toContain('gap: 6px;')
  })

  it('paints the question in muted ink, not the faint tone', () => {
    // Faint measured 2.6:1 on this dialog: an unreadable trigger is not a trigger.
    const trigger = rule('.mi-briefing-period-dialog .mi-daily-briefing__field-label .icon-button {')
    expect(trigger).toContain('color: var(--mi-dashboard-muted);')
  })

  it('keeps the hit area the platform button\'s size', () => {
    // The trigger is one hover/click target of 22px. Anything that grows it turns a field's label into
    // part of the control, and the reader opens an explanation while reaching for the select.
    const label = rule('.mi-briefing-period-dialog .mi-daily-briefing__field-label {')
    expect(label).not.toContain('padding')
    const trigger = rule('.mi-briefing-period-dialog .mi-daily-briefing__field-label .icon-button {')
    expect(trigger).not.toContain('padding')
    // No `width` of its own on either: the 22px box is the platform button's, and `min-width: 0` is the
    // only width-ish declaration this row is allowed.
    expect(trigger).not.toContain(' width:')
  })
})

/** Every rail component's source, so a class can be checked against markup and sheet alike. */
function rowSources(): string {
  const dir = 'products/market-intelligence/desktop/pages/intelligence'
  return readdirSync(dir)
    .filter((name) => name.endsWith('.tsx') && name.startsWith('DailyBriefing'))
    .map((name) => readFileSync(`${dir}/${name}`, 'utf8'))
    .join('\n')
}

/**
 * The row a day shows when it has no edition yet. It is the one row in the rail that is not an edition,
 * so it must not copy an edition's rhythm — and it must not borrow a warning's vocabulary either: "not
 * yet" is a state of the day, not a failure of the run.
 */
describe('the fallback row for a day with no edition', () => {
  it('is one line with a trailing caret, not an edition with its insides missing', () => {
    const row = rule('.mi-daily-briefing__rail-fallback {')
    expect(row).toContain('display: flex;')
    // The caret is pushed to the end of the line, so the row reads as one clickable sentence.
    expect(row).toContain('justify-content: space-between;')
    expect(row).toContain('font-size: 11px;')
    expect(rule('.mi-daily-briefing__rail-fallback-text {')).toContain('text-overflow: ellipsis;')
    expect(rule('.mi-daily-briefing__rail-fallback-caret {')).toContain('flex: none;')
  })

  it('stays quiet: no warning ink, no edition pitch', () => {
    const row = rule('.mi-daily-briefing__rail-fallback {')
    expect(row).not.toContain('--mi-dashboard-negative')
    expect(row).not.toContain('--mi-dashboard-caution')
    // An edition row is `padding: 4px 6px` with a 27px pitch; this one must not inherit that shape.
    expect(row).not.toContain('padding: 4px 6px;')
    expect(rule('.mi-daily-briefing__rail-fallback:hover {')).toContain('rgba(255, 255, 255, .04)')
  })
})

/**
 * The failure badge opens the row. It is a status word, so it renders the platform's one pill at its one
 * size; its place in the row is a layout question, and the row is baseline-aligned for text, not for a
 * bordered box.
 */
describe('the failure badge in the row', () => {
  it('is centred on the line and never shrinks', () => {
    const pill = rule('.mi-daily-briefing__rail-line .status-pill {')
    expect(pill).toContain('align-self: center;')
    // A row gives up its own words before it gives up a state.
    expect(pill).toContain('flex: none;')
  })

  it('does not invent a second size for it', () => {
    // One status size is what lets a reader recognise a state word anywhere; a size here would be a
    // second answer to that question.
    const pill = rule('.mi-daily-briefing__rail-line .status-pill {')
    expect(pill).not.toContain('font-size')
  })
})

/**
 * Which of the six things a row shows may give way is a rendering decision (locale and row state), not a
 * measurement. CSS's part is the invariant underneath it: the four that must never disappear cannot be
 * squeezed, and no width-based rule may hide any of them behind the renderer's back.
 */
describe('the row never squeezes what a reader must see', () => {
  it('lets the facts give way and keeps everything outside them whole', () => {
    // The moment may be the thing that gets cut when an enumerated case is wrong — it is inside the
    // facts group. What must not be cut are the three outside it.
    expect(rule('.mi-daily-briefing__rail-fact:first-child {')).toContain('flex: 0 1 auto;')
    // The source's flex lives in the rule it shares with the window chip, not in its colour rule.
    const chipRule = css.slice(css.indexOf('.mi-daily-briefing__rail-fact[data-window-hours],'))
    expect(chipRule.slice(0, chipRule.indexOf('}'))).toContain('flex: none;')
    expect(rule('.mi-daily-briefing__rail-line .status-pill {')).toContain('flex: none;')
    expect(rule('.mi-daily-briefing__rail-lang {')).toContain('flex: 0 0 auto;')
  })

  it('hides none of them by width — the renderer decides, not a query', () => {
    // A width query would make the same locale show different things at different widths, and the
    // renderer's enumeration is what the acceptance criteria describe.
    for (const selector of [
      '.mi-daily-briefing__rail-line',
      '.mi-daily-briefing__rail-source',
      '.mi-daily-briefing__rail-lang',
      '.mi-daily-briefing__rail-fact'
    ]) {
      const queryRule = new RegExp(`@(?:media|container)[^{]*\\{[^}]*${selector.replace(/\./g, '\\.')}`)
      expect(queryRule.test(css)).toBe(false)
    }
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
