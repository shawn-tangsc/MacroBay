import { createJsonFileStorage } from '@platform/storage/jsonFileStorage'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import { createBriefingPeriodStore } from './dailyBriefingPeriodStore'

/**
 * The runtime's period list: the reader's own configuration, not the old global settings.
 *
 * This is the switch §11.6b names. It reads and never writes, so it cannot put a period into the
 * file: a never-configured install reads as one default period in the reader's language, which is
 * the same schedule the old settings produced when the reader never changed them.
 *
 * The store is created here rather than shared with the IPC seam because both sides only read the
 * same file: one creates periods when the reader asks, this one answers "what is configured now".
 */
export function createBriefingPeriodsSource(input: Readonly<{
  filePath: string
  /** The reader's interface language, asked lazily: the answer can change between calls. */
  locale: () => Promise<DailyBriefingLocale>
}>): Readonly<{ getPeriods: () => Promise<readonly BriefingPeriod[]> }> {
  const store = createBriefingPeriodStore({
    storage: createJsonFileStorage<unknown>(input.filePath, undefined),
    // Only reached when the caller passes no language; every call below passes the reader's own.
    defaultLanguage: () => 'zh-CN'
  })
  return Object.freeze({
    getPeriods: async () => store.list(await input.locale())
  })
}
