import { DEFAULT_PERIOD_ID, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'

/**
 * The old global settings folded into period configuration — a pure function, no IO.
 *
 * The first period keeps the id `default`, because every edition generated before periods existed
 * hangs under that id; issuing a fresh id here would make all history look like a deleted period.
 * Results are one or two concrete periods; the migration outcome names the edge case where the
 * interface is already English and the reader also asked for an English edition (one row, not two).
 */
export type BriefingSettingsMigrationOutcome = 'one' | 'two' | 'legacy-english-only'

export function migrateLegacyBriefingSettings(input: Readonly<{
  legacy: Readonly<{
    generationTime: string
    windowHours: number
    primaryLocale: string
    additionalLocales: readonly string[]
    uiLocale: string
  }>
}>): Readonly<{ periods: readonly BriefingPeriod[]; outcome: BriefingSettingsMigrationOutcome }> {
  const { legacy } = input
  const ui = asLocale(legacy.uiLocale) ?? 'zh-CN'
  const primary = asLocale(legacy.primaryLocale) ?? ui
  const wantsEnglish = legacy.additionalLocales.includes('en-US')
  const first: BriefingPeriod = Object.freeze({
    id: DEFAULT_PERIOD_ID,
    generationTime: legacy.generationTime,
    windowHours: legacy.windowHours as BriefingPeriod['windowHours'],
    language: primary,
    origin: 'legacy-settings'
  })
  // English interface + English edition is one row: a second English row would collide on the
  // (time, window, language) triple the period store enforces.
  if (!wantsEnglish || primary === 'en-US') {
    return Object.freeze({ periods: Object.freeze([first]), outcome: wantsEnglish ? 'legacy-english-only' : 'one' })
  }
  const second: BriefingPeriod = Object.freeze({
    id: `period_legacy_${'en-US'}`,
    generationTime: legacy.generationTime,
    windowHours: legacy.windowHours as BriefingPeriod['windowHours'],
    language: 'en-US' as const,
    origin: 'legacy-settings'
  })
  return Object.freeze({ periods: Object.freeze([first, second]), outcome: 'two' })
}

function asLocale(value: string): DailyBriefingLocale | undefined {
  return value === 'zh-CN' || value === 'en-US' ? value : undefined
}
