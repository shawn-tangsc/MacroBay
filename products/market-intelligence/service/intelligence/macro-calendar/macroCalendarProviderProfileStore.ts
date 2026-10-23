import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { MacroCalendarProviderId } from './macroCalendarContracts'
import { defaultMacroCalendarProviderProfile, macroCalendarProviderDefinitions, type MacroCalendarProviderProfile } from './macroCalendarProviderProfile'

export { macroCalendarProviderDefinitions }

export type MacroCalendarProviderProfileStorage = {
  readAll: () => Promise<MacroCalendarProviderProfile[]>
  writeAll: (profiles: MacroCalendarProviderProfile[]) => Promise<void>
}

export type MacroCalendarProviderProfileStore = {
  list: () => Promise<MacroCalendarProviderProfile[]>
  save: (input: Pick<MacroCalendarProviderProfile, 'providerId' | 'enabled'>) => Promise<MacroCalendarProviderProfile>
  saveCredentialRef: (input: Pick<MacroCalendarProviderProfile, 'providerId' | 'credentialRef'>) => Promise<MacroCalendarProviderProfile>
}

export function createMacroCalendarProviderProfileStore(storage: MacroCalendarProviderProfileStorage): MacroCalendarProviderProfileStore {
  let cached: MacroCalendarProviderProfile[] | undefined
  async function profiles(): Promise<MacroCalendarProviderProfile[]> {
    if (!cached) cached = normalize(await storage.readAll())
    return cached
  }
  return {
    async list() { return [...await profiles()] },
    async save(input) {
      const all = await profiles()
      const index = all.findIndex((profile) => profile.providerId === input.providerId)
      const current = index >= 0 ? all[index] : defaultMacroCalendarProviderProfile(input.providerId)
      const next = { ...current, enabled: input.enabled, updatedAt: new Date().toISOString() }
      if (index >= 0) all[index] = next
      else all.push(next)
      await storage.writeAll(all)
      return next
    },
    async saveCredentialRef(input) {
      const all = await profiles()
      const index = all.findIndex((profile) => profile.providerId === input.providerId)
      const current = index >= 0 ? all[index] : defaultMacroCalendarProviderProfile(input.providerId)
      const next = {
        ...current,
        ...(input.credentialRef ? { credentialRef: input.credentialRef } : { credentialRef: undefined }),
        updatedAt: new Date().toISOString()
      }
      const persisted = index >= 0 ? all.map((profile, profileIndex) => profileIndex === index ? next : profile) : [...all, next]
      await storage.writeAll(persisted)
      if (index >= 0) all[index] = next
      else all.push(next)
      return next
    }
  }
}

export function createInMemoryMacroCalendarProviderProfileStorage(initial: MacroCalendarProviderProfile[] = []): MacroCalendarProviderProfileStorage {
  let profiles = [...initial]
  return { async readAll() { return [...profiles] }, async writeAll(next) { profiles = [...next] } }
}

export function createMacroCalendarProviderProfileJsonStorage(filePath: string): MacroCalendarProviderProfileStorage {
  return {
    async readAll() {
      try { return normalize(JSON.parse(await readFile(filePath, 'utf8')) as MacroCalendarProviderProfile[]) } catch (error) { if (isMissing(error)) return []; throw error }
    },
    async writeAll(profiles) { await mkdir(dirname(filePath), { recursive: true }); await writeFile(filePath, `${JSON.stringify(normalize(profiles), null, 2)}\n`, 'utf8') }
  }
}

function normalize(values: MacroCalendarProviderProfile[]): MacroCalendarProviderProfile[] {
  const stored = new Map(values.filter(isProfile).map((profile) => [profile.providerId, profile]))
  return macroCalendarProviderDefinitions.map(({ providerId }) => {
    const value = stored.get(providerId)
    return value ? { providerId, enabled: Boolean(value.enabled), credentialRef: value.credentialRef?.trim() || undefined, updatedAt: String(value.updatedAt) } : defaultMacroCalendarProviderProfile(providerId)
  })
}

function isProfile(value: unknown): value is MacroCalendarProviderProfile {
  return Boolean(value && typeof value === 'object' && 'providerId' in value && macroCalendarProviderDefinitions.some((item) => item.providerId === (value as { providerId?: MacroCalendarProviderId }).providerId))
}
function isMissing(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') }
