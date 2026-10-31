import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefFactEnsure } from './dailyBriefFactEnsure'
import type { DailyBriefingStore } from './dailyBriefingService'

/**
 * The startup pass: the newest stored edition is the one the reader is looking at, so it is the one
 * whose core numeric rows may be completed after the fact. Anything older is history and is never
 * written. The pass is best-effort: a missing edition, a failed ensure, or a store write failure is
 * a logged event, never a thrown error at the main process.
 *
 * The write is guarded twice: only the latest date is considered, and the row is read again before
 * `put`. A generation that finished while the ensure was reading is newer than the patch, so the
 * patch is dropped instead of overwriting the editorial output.
 */
export type DailyBriefFactEnsureStartupDeps = Readonly<{
  store: Pick<DailyBriefingStore, 'list' | 'get' | 'put'>
  ensure: DailyBriefFactEnsure['ensure']
  locale: () => Promise<DailyBriefingLocale>
  now?: () => string
  retentionDays?: number
  onEvent?: (event: Readonly<Record<string, unknown>>) => void
}>

export async function ensureDailyBriefFactsAtStartup(deps: DailyBriefFactEnsureStartupDeps): Promise<void> {
  try {
    const now = deps.now?.() ?? new Date().toISOString()
    const today = now.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return
    const retentionDays = deps.retentionDays ?? 14
    const from = addDays(today, -retentionDays)
    const to = addDays(today, 1)
    const locale = await deps.locale()
    const rows = await deps.store.list(from, to, locale)
    if (rows.length === 0) {
      deps.onEvent?.({ event: 'startup-skipped', reason: 'no-edition' })
      return
    }
    const latestDate = rows
      .map((row) => row.date)
      .sort((left, right) => left.localeCompare(right))
      .at(-1)
    if (!latestDate) return
    const locales: readonly DailyBriefingLocale[] = locale === 'zh-CN' ? ['zh-CN', 'en-US'] : ['en-US', 'zh-CN']
    for (const candidate of locales) {
      const row = await deps.store.get(latestDate, candidate).catch(() => undefined)
      if (!row) continue
      try {
        const result = await deps.ensure({ document: row.document, cutoff: row.document.edition.windowEnd, trigger: 'startup' })
        if (!result.changed) continue
        // A generation that landed while the readers were working must win. `generatedAt` is the
        // edition cutoff, not the write time, so a same-day regeneration can keep it; compare the
        // document as well before writing.
        const fresh = await deps.store.get(latestDate, candidate).catch(() => undefined)
        if (!fresh || fresh.generatedAt !== row.generatedAt || !sameDocument(fresh.document, row.document)) {
          deps.onEvent?.({ event: 'startup-write-skipped', reason: 'regenerated', editionDate: latestDate })
          continue
        }
        await deps.store.put({ ...row, document: result.document })
        deps.onEvent?.({ event: 'startup-filled', editionDate: latestDate, filled: result.filled.length })
      } catch {
        deps.onEvent?.({ event: 'startup-edition-failed', editionDate: latestDate })
      }
    }
  } catch {
    deps.onEvent?.({ event: 'startup-failed' })
  }
}

function addDays(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`)
  return Number.isFinite(parsed)
    ? new Date(parsed + days * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
    : date
}

function sameDocument(left: DailyBriefingDocument, right: DailyBriefingDocument): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}
