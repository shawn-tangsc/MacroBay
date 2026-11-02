/**
 * Reader-facing words this product does not use, and where the rule does not apply.
 *
 * One list, read by the guard that scans the copy table. It lives here rather than inside a test so
 * the split of `productText` into per-domain files cannot produce a second copy of it — the rule
 * "do not say X" is only as good as the one place that knows what X is.
 *
 * The scan is **everything by default**: a reader can see any string in this table, and a list of
 * "allowed surfaces" is always one screen behind (it already was, twice). Exceptions are named
 * individually, each with the reason it is not reader-facing.
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

/** Paths the rule does not apply to, each with the reason it is not something a reader reads. */
export const INTERNAL_ONLY_SCOPES: readonly Readonly<{ path: readonly string[]; reason: string }>[] = [
  {
    // Run history prints the task's own identifier so an operator can match it against the log.
    path: ['settings', 'intelligenceSources', 'syncRun', 'tasks'],
    reason: 'Run records name the task by its technical identifier, which is what an operator greps for'
  }
]

/**
 * Sentences that still use one of those words. Each line names its owner and the words it uses;
 * the list **only shrinks** — a new finding outside it fails the scan, and a fixed entry left behind
 * fails it too, so nobody has to remember to delete a line after cleaning one up.
 */
export const KNOWN_OFFENDERS: Readonly<Record<string, string>> = {
  'zh-CN.pages.intelligence.overview.sourceFreshness': '配置 · 新鲜度',
  'zh-CN.pages.intelligence.console.layerDesk.collectionStates.degraded': '配置 · 降级',
  'zh-CN.pages.intelligence.operations.runtimeStatuses.degraded': '配置 · 降级'
}

export type BannedTermFinding = Readonly<{ key: string; term: string; sentence: string }>

function isInternalOnly(path: readonly string[]): boolean {
  return INTERNAL_ONLY_SCOPES.some((scope) => scope.path.every((part, index) => path[index] === part))
}

function walk(value: unknown, path: string[], into: (path: string[], sentence: string) => void): void {
  if (typeof value === 'string') {
    into(path, value)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) walk(child, [...path, key], into)
}

/** Every banned word in the copy handed in, with the key it sits under. */
export function findBannedReaderTerms(byLanguage: Readonly<Record<string, unknown>>): readonly BannedTermFinding[] {
  const findings: BannedTermFinding[] = []
  for (const [language, table] of Object.entries(byLanguage)) {
    walk(table, [language], (path, sentence) => {
      if (isInternalOnly(path.slice(1))) return
      for (const term of BANNED_READER_TERMS) {
        if (sentence.includes(term)) findings.push({ key: path.join('.'), term, sentence })
      }
    })
  }
  return findings
}
