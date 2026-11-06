import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import type { BriefingPeriodStore } from './dailyBriefingPeriodStore'

/**
 * Reading the period configuration for the settings surface.
 *
 * It is deliberately a capability, not a switch: the settings service keeps reading the old global
 * settings until the migration lands. Via §11.6b, switching the runtime source before the migration
 * would make a never-configured store answer with a default 07:00 and overwrite a reader's saved 08:00.
 * The switch belongs to the migration commit, where a failed migration can fall back in the same write.
 */
export async function readConfiguredBriefingPeriods(
  store: Pick<BriefingPeriodStore, 'list'>,
  locale: DailyBriefingLocale
): Promise<readonly BriefingPeriod[]> {
  return store.list(locale)
}
