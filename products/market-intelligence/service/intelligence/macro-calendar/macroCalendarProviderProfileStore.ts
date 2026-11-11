import { readJsonFileRecovering, writeJsonFileAtomically } from '@platform/storage/jsonFileStorage'

import type { MacroCalendarProviderId } from './macroCalendarContracts'
import { defaultMacroCalendarProviderProfile, macroCalendarProviderDefinitions, type MacroCalendarProviderProfile } from './macroCalendarProviderProfile'

export { macroCalendarProviderDefinitions }

export type MacroCalendarProviderProfileStorage = {
  readAll: () => Promise<MacroCalendarProviderProfile[]>
  writeAll: (profiles: MacroCalendarProviderProfile[]) => Promise<void>
}

export type MacroCalendarProviderProfileStore = {
  list: () => Promise<MacroCalendarProviderProfile[]>
  /** `decidedBy` **必填**：谁写这个开关，决定自动启用下次要不要碰它（不给默认值）。 */
  save: (input: Pick<MacroCalendarProviderProfile, 'providerId' | 'enabled'> & { decidedBy: 'auto' | 'reader' }) => Promise<MacroCalendarProviderProfile>
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
      const next = { ...current, enabled: input.enabled, decidedBy: input.decidedBy, updatedAt: new Date().toISOString() }
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
      const parsed = await readJsonFileRecovering(filePath)
      return parsed === undefined ? [] : normalize(parsed as MacroCalendarProviderProfile[])
    },
    async writeAll(profiles) { await writeJsonFileAtomically(filePath, normalize(profiles)) }
  }
}

function normalize(values: MacroCalendarProviderProfile[]): MacroCalendarProviderProfile[] {
  const stored = new Map(values.filter(isProfile).map((profile) => [profile.providerId, profile]))
  return macroCalendarProviderDefinitions.map(({ providerId }) => {
    const value = stored.get(providerId)
    // `decidedBy` 必须**透传**（读与写两条路径都走这里）：丢掉它，第二次启动就会把读者关掉的
    // provider 重新打开。没有这个字段的持久化行按事实推断：`enabled === false` 只可能是读者写的，
    // `true` 则无论是谁写的都不影响行为（自动启用不碰 true）。
    return value
      ? { providerId, enabled: Boolean(value.enabled), decidedBy: value.decidedBy ?? (value.enabled === false ? 'reader' : 'auto'), credentialRef: value.credentialRef?.trim() || undefined, updatedAt: String(value.updatedAt) }
      : defaultMacroCalendarProviderProfile(providerId)
  })
}

function isProfile(value: unknown): value is MacroCalendarProviderProfile {
  return Boolean(value && typeof value === 'object' && 'providerId' in value && macroCalendarProviderDefinitions.some((item) => item.providerId === (value as { providerId?: MacroCalendarProviderId }).providerId))
}
function isMissing(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') }
