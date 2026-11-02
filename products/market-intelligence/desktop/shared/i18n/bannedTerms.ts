/**
 * Reader-facing words this product does not use.
 *
 * One list, read by the guard that scans the reader-facing copy. It lives here rather than inside a
 * test so the split of `productText` into per-domain files cannot produce a second copy of it — the
 * rule "do not say X" is only as good as the one place that knows what X is.
 *
 * Scope matters as much as the words: these are banned from what a reader reads — the daily brief
 * card, the exported image, empty and error sentences. Agent tool descriptions and the diagnostic
 * trail keep the internal vocabulary on purpose, because there the words are for us, not for a
 * reader.
 */
export const BANNED_READER_TERMS: readonly string[] = [
  '回退值',
  '快照',
  '新鲜度',
  '兜底',
  '判读',
  '口径待定',
  '降级',
  // English equivalents of the same coinages.
  'Fallback',
  'snapshot reading',
  'freshness floor',
  'degraded'
]

/**
 * The reader-facing surfaces the list applies to, written as paths inside `productText`.
 *
 * Deliberately not the whole `dailyBriefing` subtree: the gap list and the stage explanations carry
 * our own vocabulary on purpose (they are the diagnostic trail), and the rule is about what the
 * reader reads on the card, in the export, and in an empty or error sentence.
 */
export const BANNED_TERM_SCOPES: readonly (readonly string[])[] = [
  // The card and the exported image: the only place a reading's time basis is printed.
  ['pages', 'intelligence', 'portal', 'dashboard', 'dailyBriefing', 'staleBasis'],
  // Settled empty states.
  ['pages', 'intelligence', 'portal', 'dashboard', 'dailyBriefing', 'states'],
  // The sentence an empty or error state borrows from the product table.
  ['mi', 'dailyBriefing']
]
