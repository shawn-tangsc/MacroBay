import { describe, expect, it } from 'vitest'

import { BANNED_READER_TERMS, BANNED_TERM_SCOPES } from './bannedTerms'
import { productText } from './productText'

/**
 * The reader-facing copy must not use our internal vocabulary.
 *
 * `MI-2-R14` said "no basis, source or fallback wording on the card" and we still shipped a coined
 * word twice, because a rule in a document is not a rule anything can check. This is that check: it
 * names the offending key, so the next person sees where it grew back rather than only that it did.
 */

type Finding = { key: string; term: string; sentence: string }

function sentencesInScope(): Array<{ key: string; sentence: string }> {
  const found: Array<{ key: string; sentence: string }> = []
  for (const language of ['zh-CN', 'en-US'] as const) {
    for (const scope of BANNED_TERM_SCOPES) {
      let node: unknown = productText[language]
      for (const part of scope) {
        if (node === null || typeof node !== 'object') { node = undefined; break }
        node = (node as Record<string, unknown>)[part]
      }
      if (node === undefined) continue
      const walk = (value: unknown, path: string): void => {
        if (typeof value === 'string') { found.push({ key: `${language}.${path}`, sentence: value }); return }
        if (value === null || typeof value !== 'object') return
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`)
      }
      walk(node, scope.join('.'))
    }
  }
  return found
}

describe('banned reader-facing terms', () => {
  it('keeps every reader-facing sentence free of them, and says which key when it does not', () => {
    const findings: Finding[] = []
    for (const { key, sentence } of sentencesInScope()) {
      for (const term of BANNED_READER_TERMS) {
        if (sentence.includes(term)) findings.push({ key, term, sentence })
      }
    }
    // Report the key, not just a count: "one sentence is banned" sends someone reading the file.
    expect(findings).toEqual([])
  })

  it('covers a real subtree, so a passing run is not vacuous', () => {
    // If the scope path ever moves, this test would pass by finding nothing at all.
    expect(sentencesInScope().length).toBeGreaterThan(10)
  })
})
