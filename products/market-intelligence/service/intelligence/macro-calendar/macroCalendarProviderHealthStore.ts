import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { MacroCalendarProviderHealthRevision, MacroCalendarProviderId } from './macroCalendarContracts'
import { macroCalendarHealthHistoryPolicy } from './macroCalendarPolicy'
import { compareIsoTime, isValidIsoTime, isVisibleAsOf } from '../public-query/asOfVisibility'

export type MacroCalendarProviderHealthStore = {
  getCurrent: (providerId: MacroCalendarProviderId) => MacroCalendarProviderHealthRevision | undefined
  appendMaterialChange: (next: MacroCalendarProviderHealthRevision) => void
  getAsOf: (providerId: MacroCalendarProviderId, asOf: string) => { state: MacroCalendarProviderHealthRevision | undefined; caveat?: 'source-health-history-truncated' }
}

export type MacroCalendarProviderHealthSnapshot = {
  currentByProviderId: Partial<Record<MacroCalendarProviderId, MacroCalendarProviderHealthRevision>>
  historyByProviderId: Partial<Record<MacroCalendarProviderId, MacroCalendarProviderHealthRevision[]>>
  earliestRetainedAtByProviderId: Partial<Record<MacroCalendarProviderId, string>>
}

export type MacroCalendarProviderHealthStorage = {
  read: () => MacroCalendarProviderHealthSnapshot
  write: (snapshot: MacroCalendarProviderHealthSnapshot) => void
}

export function createMacroCalendarProviderHealthStore(storage: MacroCalendarProviderHealthStorage = createInMemoryMacroCalendarProviderHealthStorage()): MacroCalendarProviderHealthStore {
  const initial = storage.read()
  const current = new Map<MacroCalendarProviderId, MacroCalendarProviderHealthRevision>(Object.entries(initial.currentByProviderId) as Array<[MacroCalendarProviderId, MacroCalendarProviderHealthRevision]>)
  const history = new Map<MacroCalendarProviderId, MacroCalendarProviderHealthRevision[]>(Object.entries(initial.historyByProviderId) as Array<[MacroCalendarProviderId, MacroCalendarProviderHealthRevision[]]>)
  const earliestRetainedAt = new Map<MacroCalendarProviderId, string>(Object.entries(initial.earliestRetainedAtByProviderId) as Array<[MacroCalendarProviderId, string]>)
  function persist(): void {
    storage.write({ currentByProviderId: Object.fromEntries(current), historyByProviderId: Object.fromEntries(history), earliestRetainedAtByProviderId: Object.fromEntries(earliestRetainedAt) })
  }
  return {
    getCurrent(providerId) { return current.get(providerId) },
    appendMaterialChange(next) {
      const normalized = normalize(next)
      const previous = current.get(next.providerId)
      current.set(next.providerId, normalized)
      if (previous && materialSignature(previous) === materialSignature(normalized)) { persist(); return }
      const entries = [...(history.get(next.providerId) ?? []), normalized].sort((left, right) => compareIsoTime(left.updatedAt, right.updatedAt))
      const overflow = entries.length - macroCalendarHealthHistoryPolicy.providerHealthHistoryMaxEntriesPerProvider
      if (overflow > 0) {
        const retained = entries.slice(overflow)
        earliestRetainedAt.set(next.providerId, retained[0].updatedAt)
        history.set(next.providerId, retained)
        persist()
        return
      }
      history.set(next.providerId, entries)
      persist()
    },
    getAsOf(providerId, asOf) {
      if (!isValidIsoTime(asOf)) return { state: undefined, caveat: 'source-health-history-truncated' }
      const earliest = earliestRetainedAt.get(providerId)
      if (earliest && compareIsoTime(asOf, earliest) < 0) return { state: undefined, caveat: 'source-health-history-truncated' }
      const state = [...(history.get(providerId) ?? [])].filter((item) => isVisibleAsOf(item.updatedAt, asOf)).at(-1)
      return { state }
    }
  }
}

export function createInMemoryMacroCalendarProviderHealthStorage(initial: MacroCalendarProviderHealthSnapshot = emptySnapshot()): MacroCalendarProviderHealthStorage {
  let snapshot = structuredClone(initial)
  return { read: () => structuredClone(snapshot), write: (next) => { snapshot = structuredClone(next) } }
}

export function createMacroCalendarProviderHealthJsonStorage(filePath: string): MacroCalendarProviderHealthStorage {
  return {
    read() {
      try { return normalizeSnapshot(JSON.parse(readFileSync(filePath, 'utf8')) as MacroCalendarProviderHealthSnapshot) } catch (error) { if (isMissing(error)) return emptySnapshot(); throw error }
    },
    write(snapshot) { mkdirSync(dirname(filePath), { recursive: true }); writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8') }
  }
}

function normalize(value: MacroCalendarProviderHealthRevision): MacroCalendarProviderHealthRevision {
  const keys = [...new Set(value.checkpoint.successfulEventKeys ?? [])].sort().slice(0, macroCalendarHealthHistoryPolicy.providerHealthCheckpointEventKeyLimit)
  return { ...value, checkpoint: { ...value.checkpoint, successfulEventKeys: keys }, safeSummary: value.safeSummary?.slice(0, macroCalendarHealthHistoryPolicy.providerHealthSafeSummaryMaxChars) }
}
function materialSignature(value: MacroCalendarProviderHealthRevision): string {
  return JSON.stringify({ status: value.status, consecutiveFailures: value.consecutiveFailures, parserVersion: value.checkpoint.parserVersion, scheduleHorizonEnd: value.checkpoint.scheduleHorizonEnd, successfulEventKeys: value.checkpoint.successfulEventKeys })
}
function emptySnapshot(): MacroCalendarProviderHealthSnapshot { return { currentByProviderId: {}, historyByProviderId: {}, earliestRetainedAtByProviderId: {} } }
function normalizeSnapshot(value: MacroCalendarProviderHealthSnapshot): MacroCalendarProviderHealthSnapshot { return value && typeof value === 'object' ? { currentByProviderId: value.currentByProviderId ?? {}, historyByProviderId: value.historyByProviderId ?? {}, earliestRetainedAtByProviderId: value.earliestRetainedAtByProviderId ?? {} } : emptySnapshot() }
function isMissing(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') }
