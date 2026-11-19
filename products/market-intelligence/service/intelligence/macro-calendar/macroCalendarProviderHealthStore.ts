import { readJsonFileRecoveringSync, writeJsonFileAtomicallySync } from '@platform/storage/jsonFileStorage'

import type { MacroCalendarProviderHealthRevision, MacroCalendarProviderId,
  MacroCalendarWriteFailureCode } from './macroCalendarContracts'
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

/**
 * **把一次批写入失败落到健康记录上**（用户 2026-11-19）：两个写入点（官方行同步、历史回填）
 * 都调它——不许各写一份「怎么落 `lastWriteFailure`」，否则迟早一处漏码、一处漏 `streakBatches`。
 *
 * 规矩：
 * - **不改 `status`**（写库失败不是来源失败）；
 * - **没有既有健康记录就不编一条**（`status` 从哪来？）：返回 `false`，由采集侧该建的时候建；
 * - `streakBatches` 的合并、历史去重都在 `appendMaterialChange` 里，一处负责。
 */
export function recordCalendarWriteFailure(
  health: Pick<MacroCalendarProviderHealthStore, 'getCurrent' | 'appendMaterialChange'>,
  providerId: MacroCalendarProviderId,
  input: Readonly<{ at: string; failedRows: number; firstErrorCode: MacroCalendarWriteFailureCode }>
): boolean {
  const current = health.getCurrent(providerId)
  if (current === undefined) return false
  health.appendMaterialChange({ ...current, updatedAt: input.at,
    lastWriteFailure: { at: input.at, failedRows: input.failedRows, firstErrorCode: input.firstErrorCode } })
  return true
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
      /**
       * **同码连续失败只记首次 + 次数**（Chief 2026-11-19）：`at` 保持这一串失败的第一批时刻，
       * `streakBatches` 累加；签名只看「码 + 首次时刻」，所以一轮一轮重写不会把历史刷满。
       * 换码才是一次新的失败事件。
       */
      const prior = current.get(next.providerId)
      const incoming = next.lastWriteFailure
      const merged = prior?.lastWriteFailure !== undefined && incoming !== undefined
        && prior.lastWriteFailure.firstErrorCode === incoming.firstErrorCode
        ? { ...next, lastWriteFailure: { ...incoming, at: prior.lastWriteFailure.at,
            streakBatches: (prior.lastWriteFailure.streakBatches ?? 1) + 1 } }
        : next
      const normalized = normalize(merged)
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
      const parsed = readJsonFileRecoveringSync(filePath)
      return parsed === undefined ? emptySnapshot() : normalizeSnapshot(parsed as MacroCalendarProviderHealthSnapshot)
    },
    write(snapshot) { writeJsonFileAtomicallySync(filePath, snapshot) }
  }
}

function normalize(value: MacroCalendarProviderHealthRevision): MacroCalendarProviderHealthRevision {
  const keys = [...new Set(value.checkpoint.successfulEventKeys ?? [])].sort().slice(0, macroCalendarHealthHistoryPolicy.providerHealthCheckpointEventKeyLimit)
  return { ...value, checkpoint: { ...value.checkpoint, successfulEventKeys: keys }, safeSummary: value.safeSummary?.slice(0, macroCalendarHealthHistoryPolicy.providerHealthSafeSummaryMaxChars) }
}
function materialSignature(value: MacroCalendarProviderHealthRevision): string {
  return JSON.stringify({ status: value.status, consecutiveFailures: value.consecutiveFailures, parserVersion: value.checkpoint.parserVersion, scheduleHorizonEnd: value.checkpoint.scheduleHorizonEnd, successfulEventKeys: value.checkpoint.successfulEventKeys, lastWriteFailure: value.lastWriteFailure === undefined ? null : { at: value.lastWriteFailure.at, firstErrorCode: value.lastWriteFailure.firstErrorCode } })
}
function emptySnapshot(): MacroCalendarProviderHealthSnapshot { return { currentByProviderId: {}, historyByProviderId: {}, earliestRetainedAtByProviderId: {} } }
function normalizeSnapshot(value: MacroCalendarProviderHealthSnapshot): MacroCalendarProviderHealthSnapshot { return value && typeof value === 'object' ? { currentByProviderId: value.currentByProviderId ?? {}, historyByProviderId: value.historyByProviderId ?? {}, earliestRetainedAtByProviderId: value.earliestRetainedAtByProviderId ?? {} } : emptySnapshot() }
function isMissing(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') }
