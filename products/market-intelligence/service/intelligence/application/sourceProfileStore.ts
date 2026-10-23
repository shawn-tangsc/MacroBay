import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import { blocksProductionCollection, createDefaultSourceProfile, hasProductOwnedCollection } from './sourceRuntimeConfig'

export type IntelligenceProfileStorage = {
  readAll: () => Promise<IntelligenceSourceProfile[]>
  writeAll: (profiles: IntelligenceSourceProfile[]) => Promise<void>
}

export type SaveProfileInput = Partial<
  Omit<IntelligenceSourceProfile, 'profileId' | 'sourceId' | 'updatedAt'>
> & {
  sourceId: string
}

export type SourceProfileStore = {
  listProfiles: () => Promise<IntelligenceSourceProfile[]>
  getProfile: (sourceId: string) => Promise<IntelligenceSourceProfile | undefined>
  resolveProfile: (sourceId: string) => Promise<IntelligenceSourceProfile>
  saveProfile: (input: SaveProfileInput) => Promise<IntelligenceSourceProfile>
}

const COLLECTION_PRESETS = new Set(['manual', 'balanced', 'frequent'])
const SCOPE_POLICIES = new Set(['all', 'watchlist-priority', 'active-position-priority'])
const RETENTION_MODES = new Set(['compact', 'balanced', 'extended'])

export function createSourceProfileStore(storage: IntelligenceProfileStorage): SourceProfileStore {
  let cache: IntelligenceSourceProfile[] | null = null

  async function loadProfiles(): Promise<IntelligenceSourceProfile[]> {
    if (cache) return cache
    cache = await storage.readAll()
    return cache
  }

  return {
    async listProfiles() {
      return [...(await loadProfiles())]
    },
    async getProfile(sourceId) {
      return (await loadProfiles()).find((profile) => profile.sourceId === sourceId)
    },
    async resolveProfile(sourceId) {
      const existing = await this.getProfile(sourceId)
      if (existing) return existing
      const definition = getIntelligenceSourceDefinition(sourceId)
      if (!definition) {
        throw new Error(`Unknown intelligence source "${sourceId}".`)
      }
      return createDefaultSourceProfile(definition)
    },
    async saveProfile(input) {
      const definition = getIntelligenceSourceDefinition(input.sourceId)
      // Calendar feeds are registry-only sources: they have no collector definition,
      // but they still need a profile row for the provider switch.
      const calendarFeed = input.sourceId.startsWith('macro-calendar-')
      if (!definition && !calendarFeed) {
        throw new Error(`Unknown intelligence source "${input.sourceId}".`)
      }

      const current = (await this.getProfile(input.sourceId))
        ?? (definition ? createDefaultSourceProfile(definition) : createCalendarSourceProfile(input.sourceId))
      if (definition && blocksProductionCollection(definition) && !hasProductOwnedCollection(definition) && input.enabled === true) {
        throw new Error(`Source "${input.sourceId}" is not ready for production collection.`)
      }

      const next: IntelligenceSourceProfile = normalizeProfile({
        ...current,
        ...input,
        profileId: current.profileId,
        sourceId: input.sourceId,
        enabled: definition && blocksProductionCollection(definition) && !hasProductOwnedCollection(definition) ? false : (input.enabled ?? current.enabled),
        includeInSentiment: definition?.supportsSentiment
          ? (input.includeInSentiment ?? current.includeInSentiment)
          : false,
        monitoredSymbols: input.monitoredSymbols ?? current.monitoredSymbols,
        updatedAt: new Date().toISOString()
      })

      const profiles = await loadProfiles()
      const index = profiles.findIndex((profile) => profile.sourceId === input.sourceId)
      if (index >= 0) profiles[index] = next
      else profiles.push(next)

      cache = profiles
      await storage.writeAll(profiles)
      return next
    }
  }
}

export function createInMemoryProfileStorage(initial: IntelligenceSourceProfile[] = []): IntelligenceProfileStorage {
  let profiles = [...initial]
  return {
    async readAll() {
      return [...profiles]
    },
    async writeAll(next) {
      profiles = [...next]
    }
  }
}

export function createProfileJsonStorage(filePath: string): IntelligenceProfileStorage {
  return {
    async readAll() {
      try {
        const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
        return Array.isArray(parsed) ? parsed.map(normalizeStoredProfile).filter(Boolean) as IntelligenceSourceProfile[] : []
      } catch (error) {
        if (isMissingFileError(error)) return []
        throw error
      }
    },
    async writeAll(profiles) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8')
    }
  }
}

function normalizeStoredProfile(value: unknown): IntelligenceSourceProfile | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<IntelligenceSourceProfile>
  if (!candidate.sourceId || !candidate.profileId) return null
  return normalizeProfile({
    profileId: String(candidate.profileId),
    sourceId: String(candidate.sourceId),
    enabled: Boolean(candidate.enabled),
    credentialRef: candidate.credentialRef ? String(candidate.credentialRef) : undefined,
    collectionPreset: candidate.collectionPreset ?? 'balanced',
    includeInSentiment: Boolean(candidate.includeInSentiment),
    scopePolicy: candidate.scopePolicy ?? 'watchlist-priority',
    rawArchiveEnabled: Boolean(candidate.rawArchiveEnabled),
    retentionMode: candidate.retentionMode ?? 'balanced',
    autoReplayAfterParserUpgrade: Boolean(candidate.autoReplayAfterParserUpgrade),
    monitoredSymbols: normalizeMonitoredSymbols(
      Array.isArray(candidate.monitoredSymbols)
        ? candidate.monitoredSymbols.map((symbol) => String(symbol))
        : undefined
    ),
    sourceSpecificConfigJson: candidate.sourceSpecificConfigJson,
    updatedAt: String(candidate.updatedAt ?? new Date().toISOString())
  })
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function createCalendarSourceProfile(sourceId: string): IntelligenceSourceProfile {
  return {
    profileId: `${sourceId}-profile`,
    sourceId,
    enabled: false,
    collectionPreset: 'manual',
    includeInSentiment: false,
    scopePolicy: 'all',
    rawArchiveEnabled: false,
    retentionMode: 'balanced',
    autoReplayAfterParserUpgrade: false,
    updatedAt: new Date().toISOString()
  }
}

function normalizeProfile(profile: IntelligenceSourceProfile): IntelligenceSourceProfile {
  return {
    ...profile,
    enabled: Boolean(profile.enabled),
    collectionPreset: COLLECTION_PRESETS.has(profile.collectionPreset)
      ? profile.collectionPreset
      : 'balanced',
    scopePolicy: SCOPE_POLICIES.has(profile.scopePolicy) ? profile.scopePolicy : 'watchlist-priority',
    retentionMode: RETENTION_MODES.has(profile.retentionMode) ? profile.retentionMode : 'balanced',
    rawArchiveEnabled: Boolean(profile.rawArchiveEnabled),
    autoReplayAfterParserUpgrade: Boolean(profile.autoReplayAfterParserUpgrade),
    monitoredSymbols: normalizeMonitoredSymbols(profile.monitoredSymbols),
    credentialRef: profile.credentialRef?.trim() || undefined
  }
}

function normalizeMonitoredSymbols(symbols?: string[]): string[] | undefined {
  if (!symbols?.length) return undefined
  const normalized = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, 20)
  return normalized.length > 0 ? normalized : undefined
}
