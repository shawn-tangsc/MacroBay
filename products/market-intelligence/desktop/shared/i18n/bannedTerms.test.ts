import { describe, expect, it } from 'vitest'

import { BANNED_READER_TERMS, KNOWN_OFFENDERS, findBannedReaderTerms } from './bannedTerms'
import { productText } from './productText'

/**
 * The reader-facing copy must not use our internal vocabulary.
 *
 * `MI-2-R14` said "no basis, source or fallback wording on the card" and the same coinage came back
 * twice, because a rule in a document is not a rule anything can check. A rule written as "scan
 * these four surfaces" is the same mistake one level down: the next new surface is not on the list.
 * So the scan covers every string and only named exceptions are skipped, each with its reason.
 */

describe('banned reader-facing terms', () => {
  it('reports every occurrence outside the shrinking baseline, by key', () => {
    const findings = findBannedReaderTerms(productText as unknown as Readonly<Record<string, unknown>>)
    const unexpected = findings.filter((finding) => KNOWN_OFFENDERS[finding.key] === undefined)
    // Keys, not a count: "one sentence is banned" sends someone reading a 3,700-line file.
    expect(unexpected.map((finding) => `${finding.key} :: ${finding.term}`)).toEqual([])
  })

  it('keeps the baseline honest: an entry that no longer offends must be deleted', () => {
    const found = new Set(findBannedReaderTerms(productText as unknown as Readonly<Record<string, unknown>>).map((finding) => finding.key))
    // Cleaning a sentence without deleting its line would make the list look like work still owed.
    expect(Object.keys(KNOWN_OFFENDERS).filter((key) => !found.has(key))).toEqual([])
  })

  it('catches a banned word in any visible sentence, so a new surface cannot slip past', () => {
    // The reverse check: inject one into copy that no scope list would have included.
    const injected = { 'zh-CN': { anywhere: { newlyAdded: '这里有一个快照。' } } }
    const findings = findBannedReaderTerms(injected)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ key: 'zh-CN.anywhere.newlyAdded', term: '快照' })
  })

  it('skips only the paths it names, and each one says why', () => {
    const injected = {
      'zh-CN': {
        settings: { intelligenceSources: { syncRun: { tasks: { t: '任务快照' } } } },
        elsewhere: { t: '任务快照' }
      }
    }
    const findings = findBannedReaderTerms(injected)
    // The run-record field is exempt; the same sentence outside it is still reported.
    expect(findings.map((finding) => finding.key)).toEqual(['zh-CN.elsewhere.t'])
  })

  it('has a word list with no duplicates and no empty entry', () => {
    expect(new Set(BANNED_READER_TERMS).size).toBe(BANNED_READER_TERMS.length)
    expect(BANNED_READER_TERMS.every((term) => term.trim() !== '')).toBe(true)
  })
})
