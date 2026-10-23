import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  createEmptyMarketEventState,
  normalizeMarketEvent,
  type MarketEventState,
  type NormalizedMarketEvent
} from '../schema/marketEvent'

export type MarketEventStorage = {
  read: () => Promise<MarketEventState | null>
  write: (state: MarketEventState) => Promise<void>
}

export function createMarketEventJsonStorage(filePath: string): MarketEventStorage {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(filePath, 'utf8')) as MarketEventState
      } catch (error) {
        if (isMissingFileError(error)) return null
        throw error
      }
    },
    async write(value) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    }
  }
}

export function createMarketEventStore(storage: MarketEventStorage) {
  let cachedState: MarketEventState | null = null

  async function loadState(): Promise<MarketEventState> {
    if (cachedState) return cachedState
    const persisted = await storage.read()
    cachedState = normalizeState(persisted)
    return cachedState
  }

  return {
    async listRecent(limit = 50): Promise<NormalizedMarketEvent[]> {
      const state = await loadState()
      return state.order
        .slice(-limit)
        .reverse()
        .map((id) => state.eventsById[id])
        .filter(Boolean)
    },

    async upsert(event: NormalizedMarketEvent): Promise<NormalizedMarketEvent> {
      const state = await loadState()
      const normalized = normalizeMarketEvent(event)
      const now = new Date().toISOString()
      const order = state.order.includes(normalized.id) ? state.order : [...state.order, normalized.id]
      cachedState = {
        eventsById: { ...state.eventsById, [normalized.id]: normalized },
        order,
        updatedAt: now
      }
      await storage.write(cachedState)
      return normalized
    }
  }
}

function normalizeState(raw: MarketEventState | null | undefined): MarketEventState {
  if (!raw?.eventsById) return createEmptyMarketEventState()
  const eventsById: MarketEventState['eventsById'] = {}
  for (const [id, event] of Object.entries(raw.eventsById)) {
    if (!event?.title) continue
    eventsById[id] = normalizeMarketEvent({ ...event, id })
  }
  const order = (raw.order ?? []).filter((id) => Boolean(eventsById[id]))
  for (const id of Object.keys(eventsById)) {
    if (!order.includes(id)) order.unshift(id)
  }
  return { eventsById, order, updatedAt: raw.updatedAt ?? new Date().toISOString() }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
