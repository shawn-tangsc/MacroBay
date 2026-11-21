import { createJsonFileStorage, type JsonFileStorage } from '@platform/storage/jsonFileStorage'

import {
  EMPTY_OPTION_SKEW_STORE,
  optionSkewPolicy,
  roundOneDecimal,
  type OptionSkewPoint,
  type OptionSkewStoreState
} from './optionSkewPolicy'

/** What the card's query reads. `lastFailureCause` separates "nothing yet" from "could not fetch". */
export type OptionSkewStoreRead = Readonly<{
  points: readonly OptionSkewPoint[]
  lastFailureCause?: 'connection-unavailable' | 'upstream-http-error'
}>

export type OptionSkewPointStore = Readonly<{
  /** Reads the file once at startup; a second call is a no-op. */
  load: () => Promise<void>
  /** Synchronous, from memory: the card query is synchronous and must not touch the disk. */
  readSnapshot: () => OptionSkewStoreRead
  recordPoint: (point: OptionSkewPoint) => Promise<void>
  recordFailure: (input: { at: string; failureCode: string }) => Promise<void>
  readState: () => OptionSkewStoreState
}>

/**
 * One stored day per UTC day; a later read on the same day replaces it (AC-18 asks for the day's
 * latest, not for a second hour-level series). Failures never touch `points` — a failed round must
 * not be able to look like yesterday's value is still current.
 */
export function createOptionSkewPointStore(deps: {
  filePath: string
  storage?: JsonFileStorage<OptionSkewStoreState>
}): OptionSkewPointStore {
  const storage = deps.storage ?? createJsonFileStorage<OptionSkewStoreState>(deps.filePath, EMPTY_OPTION_SKEW_STORE)
  let state: OptionSkewStoreState = EMPTY_OPTION_SKEW_STORE
  let loaded = false
  let unreadable = false

  async function load(): Promise<void> {
    if (loaded) return
    try {
      state = normalizeState(await storage.read())
      loaded = true
    } catch {
      // A file we cannot parse is "unreadable", never "no data yet": the card must not show 暂无
      // for a store it could not read.
      unreadable = true
      loaded = true
    }
  }

  async function persist(next: OptionSkewStoreState): Promise<void> {
    state = next
    await storage.write(next)
  }

  return Object.freeze({
    load,
    readSnapshot(): OptionSkewStoreRead {
      if (unreadable) throw new Error('option-skew store is unreadable')
      const lastFailureCause = state.lastFailureCode === 'connection-unavailable' || state.lastFailureCode === 'upstream-http-error'
        ? state.lastFailureCode
        : undefined
      return {
        points: state.points,
        ...(lastFailureCause === undefined ? {} : { lastFailureCause })
      }
    },
    async recordPoint(point: OptionSkewPoint): Promise<void> {
      const kept = state.points.filter((existing) => existing.day !== point.day)
      kept.push({ ...point, riskReversal: roundOneDecimal(point.riskReversal) })
      kept.sort((left, right) => (left.day > right.day ? 1 : left.day < right.day ? -1 : 0))
      const trimmed = trimPoints(kept, point.day)
      await persist({
        schemaVersion: 1,
        points: trimmed,
        lastAttemptAt: point.observedAt,
        lastSuccessAt: point.observedAt,
        consecutiveFailures: 0
      })
    },
    async recordFailure(input: { at: string; failureCode: string }): Promise<void> {
      // Points are deliberately untouched: a failed round keeps the history it already had, and the
      // card decides "stopped" from `daysAgo`, not from this failure.
      await persist({
        ...state,
        schemaVersion: 1,
        points: state.points,
        lastAttemptAt: input.at,
        lastFailureCode: input.failureCode,
        consecutiveFailures: state.consecutiveFailures + 1
      })
    },
    readState(): OptionSkewStoreState {
      return state
    }
  })
}

/** Keeps `retentionDays` of days and never more than `retentionDays` points. */
function trimPoints(points: readonly OptionSkewPoint[], newestDay: string): OptionSkewPoint[] {
  const newestMs = Date.parse(`${newestDay}T00:00:00.000Z`)
  const oldestKeptMs = newestMs - optionSkewPolicy.retentionDays * 86_400_000
  const kept = points.filter((point) => {
    const dayMs = Date.parse(`${point.day}T00:00:00.000Z`)
    return Number.isFinite(dayMs) && dayMs >= oldestKeptMs
  })
  return kept.slice(Math.max(0, kept.length - optionSkewPolicy.retentionDays))
}

function normalizeState(raw: OptionSkewStoreState | undefined): OptionSkewStoreState {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.points)) return EMPTY_OPTION_SKEW_STORE
  return {
    schemaVersion: 1,
    points: raw.points.filter(isReadablePoint),
    ...(typeof raw.lastAttemptAt === 'string' ? { lastAttemptAt: raw.lastAttemptAt } : {}),
    ...(typeof raw.lastSuccessAt === 'string' ? { lastSuccessAt: raw.lastSuccessAt } : {}),
    ...(typeof raw.lastFailureCode === 'string' ? { lastFailureCode: raw.lastFailureCode } : {}),
    consecutiveFailures: Number.isFinite(raw.consecutiveFailures) ? Math.max(0, raw.consecutiveFailures) : 0
  }
}

function isReadablePoint(point: unknown): point is OptionSkewPoint {
  if (!point || typeof point !== 'object') return false
  const record = point as Record<string, unknown>
  return typeof record.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.day) &&
    typeof record.observedAt === 'string' &&
    typeof record.riskReversal === 'number' && Number.isFinite(record.riskReversal) &&
    typeof record.putIv25 === 'number' && Number.isFinite(record.putIv25) &&
    typeof record.callIv25 === 'number' && Number.isFinite(record.callIv25) &&
    record.tenorDays === 30 &&
    Array.isArray(record.expiries) && record.expiries.length === 2 &&
    record.expiries.every((entry) => typeof entry === 'string')
}