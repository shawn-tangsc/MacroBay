import { readFile } from 'node:fs/promises'

import { writeJsonFileAtomically } from '@platform/storage/jsonFileStorage'

import {
  isCanonicalDailyBriefBackfillTime,
  isDailyBriefBackfillMetric,
  type DailyBriefBackfillGapCode,
  type DailyBriefBackfillMetric,
  type DailyBriefBackfillUnit
} from '../public-query/dailyBriefBackfill'

/**
 * The persistent record of one core-fact backfill attempt.
 *
 * It is both the idempotency cache and the status surface: a successful entry answers the same
 * `editionDate|metric|asOf` without another read, and a failed one says which named gap the last
 * attempt left. Keys never leave this module or reach a log line; callers log metric and gap code.
 */
export type DailyBriefFactEnsureEntry = Readonly<{
  editionDate: string
  metric: DailyBriefBackfillMetric
  asOf: string
  state: 'available' | 'unavailable'
  source: string
  lastAttemptAt: string
  lastSuccessAt?: string
  attempts: number
  gapCode?: DailyBriefBackfillGapCode | 'source-disabled'
  detail?: string
  value?: number
  unit?: DailyBriefBackfillUnit
  observedAt?: string
  sourceUrl?: string
  method?: string
}>

export type DailyBriefFactEnsureCache = Readonly<{
  get: (key: string) => Promise<DailyBriefFactEnsureEntry | undefined>
  put: (entry: DailyBriefFactEnsureEntry) => Promise<void>
  prune: (beforeDate: string) => Promise<void>
  entries: () => Promise<readonly DailyBriefFactEnsureEntry[]>
}>

export type DailyBriefFactEnsureCacheSnapshot = Readonly<{
  version: 1
  entries: Readonly<Record<string, DailyBriefFactEnsureEntry>>
}>

export const dailyBriefFactEnsureCachePolicy = Object.freeze({
  version: 1 as const,
  editionDatePattern: /^\d{4}-\d{2}-\d{2}$/,
  maximumEntries: 500
})

/** The one key shape. It is never logged and never returned to the renderer. */
export function dailyBriefFactEnsureKey(
  input: Readonly<{ editionDate: string; metric: string; asOf: string }>
): string {
  return `${input.editionDate}|${input.metric}|${input.asOf}`
}

/**
 * The file is a cache, not a source of truth: a missing, corrupt or older file is an empty cache.
 * A write failure is reported to the caller, which logs it and keeps the already-read fact.
 */
export function createDailyBriefFactEnsureJsonCache(filePath: string): DailyBriefFactEnsureCache {
  let loaded: Promise<Map<string, DailyBriefFactEnsureEntry>> | undefined
  let writing: Promise<void> = Promise.resolve()

  async function load(): Promise<Map<string, DailyBriefFactEnsureEntry>> {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
      return parseSnapshot(parsed)
    } catch {
      return new Map()
    }
  }

  function map(): Promise<Map<string, DailyBriefFactEnsureEntry>> {
    if (!loaded) loaded = load()
    return loaded
  }

  async function persist(entries: Map<string, DailyBriefFactEnsureEntry>): Promise<void> {
    const snapshot: DailyBriefFactEnsureCacheSnapshot = {
      version: dailyBriefFactEnsureCachePolicy.version,
      entries: Object.fromEntries(entries)
    }
    await writeJsonFileAtomically(filePath, snapshot)
  }

  async function enqueueWrite(entries: Map<string, DailyBriefFactEnsureEntry>): Promise<void> {
    // A single process owns the file; serialising writes keeps the last update from an earlier
    // metric from overwriting a later one. The chain itself must survive a failed write: `put`
    // reports the failure to its caller, and the next write still runs.
    const next = writing.then(() => persist(entries))
    writing = next.catch(() => undefined)
    await next
  }

  return {
    async get(key) {
      return (await map()).get(key)
    },
    async put(entry) {
      const entries = await map()
      entries.set(dailyBriefFactEnsureKey(entry), entry)
      await enqueueWrite(entries)
    },
    async prune(beforeDate) {
      const entries = await map()
      let changed = false
      for (const [key, entry] of entries) {
        if (entry.editionDate < beforeDate) {
          entries.delete(key)
          changed = true
        }
      }
      if (!changed) return
      await enqueueWrite(entries)
    },
    async entries() {
      return Object.freeze([...(await map()).values()])
    }
  }
}

/** Process-local cache for tests and for a build without a data directory. */
export function createInMemoryDailyBriefFactEnsureCache(): DailyBriefFactEnsureCache {
  const entries = new Map<string, DailyBriefFactEnsureEntry>()
  return {
    async get(key) { return entries.get(key) },
    async put(entry) { entries.set(dailyBriefFactEnsureKey(entry), entry) },
    async prune(beforeDate) {
      for (const [key, entry] of entries) if (entry.editionDate < beforeDate) entries.delete(key)
    },
    async entries() { return Object.freeze([...entries.values()]) }
  }
}

function parseSnapshot(value: unknown): Map<string, DailyBriefFactEnsureEntry> {
  const snapshot = plainRecord(value)
  if (!snapshot || snapshot.version !== dailyBriefFactEnsureCachePolicy.version) return new Map()
  const raw = plainRecord(snapshot.entries)
  if (!raw) return new Map()
  const entries = new Map<string, DailyBriefFactEnsureEntry>()
  for (const [key, entry] of Object.entries(raw)) {
    const parsed = parseEntry(entry)
    if (!parsed) continue
    if (key !== dailyBriefFactEnsureKey(parsed)) continue
    entries.set(key, parsed)
  }
  return entries
}

function parseEntry(value: unknown): DailyBriefFactEnsureEntry | undefined {
  const entry = plainRecord(value)
  if (!entry) return undefined
  if (typeof entry.editionDate !== 'string' || !dailyBriefFactEnsureCachePolicy.editionDatePattern.test(entry.editionDate)) return undefined
  if (!isDailyBriefBackfillMetric(entry.source, entry.metric)) return undefined
  if (typeof entry.asOf !== 'string' || !isCanonicalDailyBriefBackfillTime(entry.asOf)) return undefined
  if (entry.state !== 'available' && entry.state !== 'unavailable') return undefined
  if (typeof entry.source !== 'string' || entry.source.length === 0) return undefined
  if (typeof entry.lastAttemptAt !== 'string' || !isCanonicalDailyBriefBackfillTime(entry.lastAttemptAt)) return undefined
  if (entry.lastSuccessAt !== undefined && (typeof entry.lastSuccessAt !== 'string' || !isCanonicalDailyBriefBackfillTime(entry.lastSuccessAt))) return undefined
  if (!Number.isInteger(entry.attempts) || (entry.attempts as number) < 0) return undefined

  const base = {
    editionDate: entry.editionDate,
    metric: entry.metric as DailyBriefBackfillMetric,
    asOf: entry.asOf,
    source: entry.source,
    lastAttemptAt: entry.lastAttemptAt,
    attempts: entry.attempts as number,
    ...(entry.lastSuccessAt !== undefined ? { lastSuccessAt: entry.lastSuccessAt } : {})
  }
  if (entry.state === 'available') {
    const value = entry.value
    const unit = entry.unit
    const observedAt = entry.observedAt
    const sourceUrl = entry.sourceUrl
    const method = entry.method
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
    if (unit !== 'usd' && unit !== 'flow-usd' && unit !== 'percent' && unit !== 'level') return undefined
    if (typeof observedAt !== 'string' || !isCanonicalDailyBriefBackfillTime(observedAt)) return undefined
    if (observedAt > base.asOf) return undefined
    if (typeof sourceUrl !== 'string' || !sourceUrl.startsWith('https://')) return undefined
    if (typeof method !== 'string' || method.trim().length === 0) return undefined
    return Object.freeze({
      ...base,
      state: 'available' as const,
      value,
      unit: unit as DailyBriefBackfillUnit,
      observedAt,
      sourceUrl,
      method
    })
  }
  const gapCode = entry.gapCode
  if (typeof gapCode !== 'string' || gapCode.length === 0) return undefined
  return Object.freeze({
    ...base,
    state: 'unavailable' as const,
    gapCode: gapCode as DailyBriefFactEnsureEntry['gapCode'],
    ...(entry.detail !== undefined ? { detail: String(entry.detail) } : {})
  })
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined
    return value as Record<string, unknown>
  } catch {
    return undefined
  }
}
