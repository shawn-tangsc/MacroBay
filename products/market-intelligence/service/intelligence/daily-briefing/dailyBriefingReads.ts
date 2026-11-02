import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type {
  DailyBriefingAttemptsResult,
  DailyBriefingGetResult,
  DailyBriefingStorageState,
  DailyBriefingStore
} from './dailyBriefingService'

/**
 * The read-only half of the briefing service: one edition, its attempts, and where the store stands.
 *
 * Kept out of the service because none of it decides anything — it asks the store and turns the
 * answer into the shape the page reads, including the difference between "no attempts" (an empty
 * list) and "the attempts could not be read" (its own failure code, never an empty list).
 */
export function createDailyBriefingReads(deps: Readonly<{ store: DailyBriefingStore }>): Readonly<{
  get: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId?: string }>) => Promise<DailyBriefingGetResult>
  listAttempts: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId?: string }>) => Promise<DailyBriefingAttemptsResult>
  getStorageState: () => DailyBriefingStorageState
  retryUpgrade: () => Promise<DailyBriefingStorageState>
}> {
  return Object.freeze({
    async get(input) {
      const row = await deps.store.get(input.date, input.locale, input.periodId ?? 'default').catch(() => undefined)
      return row ? { state: 'available', document: row.document } : { state: 'missing' }
    },
    async listAttempts(input) {
      if (!deps.store.listAttempts) return { state: 'unavailable', failureCode: 'attempts-unreadable' }
      try {
        return { state: 'available', attempts: await deps.store.listAttempts(input.date, input.locale, input.periodId) }
      } catch {
        return { state: 'unavailable', failureCode: 'attempts-unreadable' }
      }
    },
    getStorageState() {
      return deps.store.upgradeState?.() ?? { state: 'ready' }
    },
    async retryUpgrade() {
      return (await deps.store.retryUpgrade?.()) ?? { state: 'ready' }
    }
  })
}
