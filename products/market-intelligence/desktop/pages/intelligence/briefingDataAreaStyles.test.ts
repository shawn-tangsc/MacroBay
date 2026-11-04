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
