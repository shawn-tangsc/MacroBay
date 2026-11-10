import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import type { BriefingPeriodStorage } from './dailyBriefingPeriodStore'

/**
 * The one-time move of the old generation settings' periods into the period store.
 *
 * Since the runtime reads the period store, an installation that never wrote that file reads as one
 * default period — so a reader who had moved their briefing to 08:00 would silently get 07:00 back.
 * This module carries the saved rows across. It moves data and nothing else: the settings surface
 * keeps reading the old file until the switch lands in its own change.
 */

/**
 * The singleton marker, stored **inside the period document** rather than in a file of its own.
 *
 * Two files cannot be written in one step, and the half-written pair is the state §11.5 forbids: a
 * marker without periods makes the migration "done" with nothing migrated, periods without a marker
 * re-run the migration on the next start. Keeping the marker in the same document makes periods and
 * marker one atomic write, and it is what tells "never migrated" apart from "migrated, then the
 * reader deleted every period" — the latter must not grow its old periods back.
 */
export const LEGACY_PERIOD_MIGRATION_MARKER = 'migrated.legacyGlobalSettings.v1'

/** A period as the old generation settings stored it: when it runs and how far back it looks. */
export type LegacySavedPeriod = Readonly<{
  id: string
  generationTime: string
  windowHours: number
}>

const SUPPORTED_LANGUAGES: readonly DailyBriefingLocale[] = Object.freeze(['zh-CN', 'en-US'])

/** The id of a period this migration adds for a second language; stable, so a re-plan never drifts. */
function replicaId(baseId: string, language: DailyBriefingLocale): string {
  return `period_legacy_${baseId}_${language}`
}

/**
 * The rows to write, from the old file plus the old global language preference.
 *
 * The old model kept one primary language for every edition, plus an optional English edition of
 * each. Its periods therefore came in pairs: the primary row keeps the id it has always had (the
 * first one is `default`, which every edition before periods hangs under), and the English twin
 * gets a stable derived id. Order follows the old file — the reader's list must not be re-sorted by
 * a migration.
 *
 * The English rows are **not a new behaviour added by this migration**: "also generate an English
 * edition" was ticked in the old settings, so the reader had already asked for those editions.
 * Collapsing them into the primary row would silently switch that choice off during the upgrade.
 *
 * A (hour, window, language) triple that already exists is dropped: the store cannot hold two rows
 * that mean the same edition, and the old file could carry them from earlier repairs.
 */
export function planLegacyPeriodMigration(input: Readonly<{
  periods: readonly LegacySavedPeriod[]
  language: DailyBriefingLocale
  additionalLanguages: readonly DailyBriefingLocale[]
}>): readonly BriefingPeriod[] {
  const languages: DailyBriefingLocale[] = [input.language]
  for (const language of input.additionalLanguages) {
    if (SUPPORTED_LANGUAGES.includes(language) && !languages.includes(language)) languages.push(language)
  }
  const seenIds = new Set<string>()
  const seenTriples = new Set<string>()
  const planned: BriefingPeriod[] = []
  for (const saved of input.periods) {
    if (seenIds.has(saved.id)) continue
    seenIds.add(saved.id)
    for (const language of languages) {
      const triple = `${saved.generationTime}|${saved.windowHours}|${language}`
      if (seenTriples.has(triple)) continue
      seenTriples.add(triple)
      planned.push(Object.freeze({
        id: language === input.language ? saved.id : replicaId(saved.id, language),
        generationTime: saved.generationTime,
        windowHours: saved.windowHours as BriefingPeriod['windowHours'],
        language,
        origin: 'legacy-settings'
      }))
    }
  }
  return Object.freeze(planned)
}

export type BriefingPeriodDataMigrationResult =
  | Readonly<{ state: 'skipped'; reason: 'store-not-empty' | 'already-migrated' | 'no-legacy-periods' }>
  | Readonly<{ state: 'migrated'; periods: readonly BriefingPeriod[] }>
  | Readonly<{ state: 'failed'; reason: string }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Run the move once per process start.
 *
 * The conditions are read from the document, not from the parsed list: a file with rows this build
 * cannot read still holds the reader's data, and rewriting it would delete exactly the rows the
 * current build cannot show. No backup is taken because none is needed — the old settings file is
 * only ever read here, never written, never renamed, so a failed move leaves it as the recovery
 * source and the next start retries.
 */
export async function runBriefingPeriodDataMigration(deps: Readonly<{
  storage: BriefingPeriodStorage
  /** The old generation settings' saved periods. Read only when the move can actually run. */
  readLegacyPeriods: () => Promise<readonly LegacySavedPeriod[]>
  /** The reader's interface language: the language the old primary edition was written in. */
  language: () => Promise<DailyBriefingLocale>
  /** The old "also generate an English edition" preference. */
  additionalLanguages: () => Promise<readonly DailyBriefingLocale[]>
  now: () => string
}>): Promise<BriefingPeriodDataMigrationResult> {
  let raw: unknown
  try {
    raw = await deps.storage.read()
    if (isRecord(raw) && Array.isArray(raw.periods) && raw.periods.length > 0) {
      return Object.freeze({ state: 'skipped', reason: 'store-not-empty' })
    }
    if (isRecord(raw) && isRecord(raw.markers) && typeof raw.markers[LEGACY_PERIOD_MIGRATION_MARKER] === 'string') {
      return Object.freeze({ state: 'skipped', reason: 'already-migrated' })
    }
    const periods = await deps.readLegacyPeriods()
    if (periods.length === 0) return Object.freeze({ state: 'skipped', reason: 'no-legacy-periods' })
    const planned = planLegacyPeriodMigration({
      periods,
      language: await deps.language(),
      additionalLanguages: await deps.additionalLanguages()
    })
    if (planned.length === 0) return Object.freeze({ state: 'skipped', reason: 'no-legacy-periods' })
    const markers = isRecord(raw) && isRecord(raw.markers) ? raw.markers : {}
    // One atomic write: the rows and the marker land together or not at all.
    await deps.storage.write({
      ...(isRecord(raw) ? raw : { version: 1 }),
      periods: planned,
      markers: { ...markers, [LEGACY_PERIOD_MIGRATION_MARKER]: deps.now() }
    })
    return Object.freeze({ state: 'migrated', periods: planned })
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : 'unknown'
    return Object.freeze({ state: 'failed', reason })
  }
}
