import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * The reader's own release time for one scheduled event.
 *
 * Separate from `macroCalendarRevisions` on purpose. A revision there is a statement about what a
 * source published, and this product never rewrites those — a mistake in a provider's own bytes is
 * corrected by a new revision from that provider, not by us. An edit is a different kind of fact:
 * it is *the reader's* belief about when something lands, so it lives in its own store, keyed by
 * event, and it is always displayed as an edit.
 *
 * The instant is stored as a canonical UTC ISO string and never as local wall-clock text: the row
 * may be read from any display timezone, and only an instant survives that without drifting.
 */
export const macroCalendarReleaseTimeOverridePolicy = Object.freeze({
  eventKeyMaxLength: 160,
  maximumOverrides: 5000,
  canonicalUtcPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
})

export type MacroCalendarReleaseTimeOverride = Readonly<{
  eventKey: string
  /** The reader's instant, canonical UTC. */
  scheduledAt: string
  /** The **date** the reader chose, `YYYY-MM-DD`, kept beside the instant rather than derived from it. */
  scheduledDate: string
  updatedAt: string
}>

export type MacroCalendarReleaseTimeOverrideStorage = {
  readAll: () => Promise<MacroCalendarReleaseTimeOverride[]>
  writeAll: (overrides: MacroCalendarReleaseTimeOverride[]) => Promise<void>
}

export type MacroCalendarReleaseTimeOverrideStore = {
  /** Every override, newest write last. Loaded once and then cached. */
  list: () => Promise<readonly MacroCalendarReleaseTimeOverride[]>
  /** The reader's edit for one event, or `undefined` when the reader has not edited it. */
  get: (eventKey: string) => Promise<MacroCalendarReleaseTimeOverride | undefined>
  /** Records an edit. Rejects text that is not a canonical instant, so a bad edit cannot be stored. */
  set: (input: Readonly<{ eventKey: string; scheduledAt: string; scheduledDate: string; updatedAt: string }>) => Promise<MacroCalendarReleaseTimeOverride | undefined>
  /** Drops the edit, letting the official time (or the convention) show again. Idempotent. */
  clear: (eventKey: string) => Promise<boolean>
}

function isCanonicalUtcInstant(value: string): boolean {
  if (!macroCalendarReleaseTimeOverridePolicy.canonicalUtcPattern.test(value)) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isEventKey(value: string): boolean {
  return value.length > 0 && value.length <= macroCalendarReleaseTimeOverridePolicy.eventKeyMaxLength
}

/**
 * The date a reader picked and the instant they picked must describe the same moment; otherwise one
 * of the two was miscalculated and trusting either would show a time on the wrong day.
 */
function agreesWithInstant(scheduledDate: string, scheduledAt: string): boolean {
  return scheduledAt.startsWith(`${scheduledDate}T`)
}

function freeze(override: MacroCalendarReleaseTimeOverride): MacroCalendarReleaseTimeOverride {
  return Object.freeze({ ...override })
}

export function createMacroCalendarReleaseTimeOverrideStore(storage: MacroCalendarReleaseTimeOverrideStorage): MacroCalendarReleaseTimeOverrideStore {
  let cached: MacroCalendarReleaseTimeOverride[] | undefined
  async function all(): Promise<MacroCalendarReleaseTimeOverride[]> {
    if (cached === undefined) {
      const loaded = await storage.readAll()
      cached = loaded.filter((entry) => isEventKey(entry.eventKey) && isCanonicalUtcInstant(entry.scheduledAt) &&
        isCanonicalUtcInstant(entry.updatedAt) && agreesWithInstant(entry.scheduledDate, entry.scheduledAt) &&
        /^\d{4}-\d{2}-\d{2}$/.test(entry.scheduledDate)).slice(-macroCalendarReleaseTimeOverridePolicy.maximumOverrides)
    }
    return cached
  }
  return {
    async list() { return (await all()).map(freeze) },
    async get(eventKey) {
      const found = (await all()).find((entry) => entry.eventKey === eventKey)
      return found === undefined ? undefined : freeze(found)
    },
    async set(input) {
      if (!isEventKey(input.eventKey) || !isCanonicalUtcInstant(input.scheduledAt) || !isCanonicalUtcInstant(input.updatedAt) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate) || !agreesWithInstant(input.scheduledDate, input.scheduledAt)) return undefined
      const next = freeze({ eventKey: input.eventKey, scheduledAt: input.scheduledAt, scheduledDate: input.scheduledDate, updatedAt: input.updatedAt })
      const current = await all()
      const index = current.findIndex((entry) => entry.eventKey === input.eventKey)
      if (index >= 0) current[index] = next
      else current.push(next)
      await storage.writeAll([...current])
      return next
    },
    async clear(eventKey) {
      const current = await all()
      const remaining = current.filter((entry) => entry.eventKey !== eventKey)
      if (remaining.length === current.length) return false
      current.length = 0
      current.push(...remaining)
      await storage.writeAll([...current])
      return true
    }
  }
}

/** File-backed storage, in the same shape as the provider-profile store next to it. */
export function createMacroCalendarReleaseTimeOverrideJsonStorage(filePath: string): MacroCalendarReleaseTimeOverrideStorage {
  return {
    async readAll() {
      try {
        const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
        return Array.isArray(parsed) ? parsed as MacroCalendarReleaseTimeOverride[] : []
      } catch (error) {
        if (isMissing(error)) return []
        throw error
      }
    },
    async writeAll(overrides) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8')
    }
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

/**
 * The synchronous view of the edits that a calendar query reads.
 *
 * Queries are synchronous all the way to IPC, so they cannot await storage. Main keeps this in
 * memory instead: it is seeded from the store on first use and refreshed after every write. Only
 * the two fields a row needs are exposed, so a caller cannot accidentally persist from here.
 */
export type MacroCalendarReleaseTimeOverrideCache = {
  get: (eventKey: string) => Readonly<{ scheduledAt: string; scheduledDate: string }> | undefined
  /** Re-reads the store. Returns false when the read failed, leaving the previous view in place. */
  refresh: () => Promise<boolean>
  /** Applies a write that already succeeded, so the next query sees it without a disk round trip. */
  apply: (override: MacroCalendarReleaseTimeOverride) => void
  remove: (eventKey: string) => void
}

export function createMacroCalendarReleaseTimeOverrideCache(store: MacroCalendarReleaseTimeOverrideStore): MacroCalendarReleaseTimeOverrideCache {
  const view = new Map<string, Readonly<{ scheduledAt: string; scheduledDate: string }>>()
  let seeded = false
  const seed = (overrides: readonly MacroCalendarReleaseTimeOverride[]): void => {
    view.clear()
    for (const override of overrides) view.set(override.eventKey, Object.freeze({ scheduledAt: override.scheduledAt, scheduledDate: override.scheduledDate }))
  }
  return {
    get(eventKey) { return view.get(eventKey) },
    async refresh() {
      if (seeded) return true
      try {
        seed(await store.list())
        seeded = true
        return true
      } catch {
        return false
      }
    },
    apply(override) { seeded = true; view.set(override.eventKey, Object.freeze({ scheduledAt: override.scheduledAt, scheduledDate: override.scheduledDate })) },
    remove(eventKey) { view.delete(eventKey) }
  }
}
