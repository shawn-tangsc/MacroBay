import type { MacroCalendarProviderId } from './macroCalendarContracts'
import type { MacroCalendarProviderProfileStore } from './macroCalendarProviderProfileStore'

export type MacroCalendarProviderRuntime = { reconcile: () => Promise<void>; runNow: (providerId: MacroCalendarProviderId) => Promise<void> }

export function createMacroCalendarProviderRuntime(deps: { profiles: MacroCalendarProviderProfileStore; upsertSchedule: () => void | Promise<void>; removeSchedule: () => void | Promise<void>; enqueueManual: (providerId: MacroCalendarProviderId) => void | Promise<void> }): MacroCalendarProviderRuntime {
  return {
    async reconcile() {
      const enabled = (await deps.profiles.list()).some((profile) => profile.enabled)
      if (enabled) await deps.upsertSchedule()
      else await deps.removeSchedule()
    },
    async runNow(providerId) { await deps.enqueueManual(providerId) }
  }
}
