import type { SourceProfileStore } from '../application/sourceProfileStore'
import { defaultMacroCalendarProviderProfile, type MacroCalendarProviderProfile } from './macroCalendarProviderProfile'
import type { MacroCalendarProviderProfileStore } from './macroCalendarProviderProfileStore'

type SourceProfiles = Pick<SourceProfileStore, 'listProfiles' | 'saveProfile'>

/**
 * Reads and writes calendar provider switches through the unified source profile
 * store. The legacy calendar profile store stays as a read-only fallback so an
 * existing installation keeps its current switch state until the next save.
 */
export function createUnifiedMacroCalendarProfileStore(
  store: SourceProfiles,
  legacy?: Pick<MacroCalendarProviderProfileStore, 'list' | 'saveCredentialRef'>
): MacroCalendarProviderProfileStore {
  async function legacyProfiles(): Promise<MacroCalendarProviderProfile[]> {
    return legacy ? legacy.list().catch(() => []) : []
  }

  return {
    async list() {
      const [unified, previous] = await Promise.all([store.listProfiles(), legacyProfiles()])
      const unifiedById = new Map(unified.map((profile) => [profile.sourceId, profile]))
      const ids = new Set<string>([
        ...previous.map((profile) => profile.providerId),
        ...unified.map((profile) => profile.sourceId).filter((sourceId) => sourceId.startsWith('macro-calendar-'))
      ])
      return [...ids].map((providerId) => {
        const base = previous.find((profile) => profile.providerId === providerId)
          ?? defaultMacroCalendarProviderProfile(providerId as never)
        const current = unifiedById.get(providerId)
        return current ? { ...base, enabled: current.enabled } : base
      })
    },
    async save(input) {
      const saved = await store.saveProfile({ sourceId: input.providerId, enabled: input.enabled })
      return {
        ...defaultMacroCalendarProviderProfile(input.providerId as never),
        enabled: saved.enabled,
        updatedAt: saved.updatedAt ?? new Date().toISOString()
      }
    },
    async saveCredentialRef(input) {
      if (legacy) return legacy.saveCredentialRef(input)
      return {
        ...defaultMacroCalendarProviderProfile(input.providerId as never),
        credentialRef: input.credentialRef,
        updatedAt: new Date().toISOString()
      }
    }
  }
}
