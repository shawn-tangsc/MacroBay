import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { capitalConditionsDailyFlowPolicy } from '../../../contracts/intelligenceQueryContracts'

import type { StablecoinCapitalSnapshot } from './stablecoinCapitalParser'

export const stablecoinCapitalCurrentStatePolicy = Object.freeze({
  schemaVersion: 1,
  sourceId: 'defillama-stablecoins',
  maximumSnapshotBytes: 4 * 1024,
  maximumHealthBytes: 4 * 1024,
  maximumStateBytes: 256 * 1024,
  maximumAtomicDiskBytes: 512 * 1024,
  maximumCounter: Number.MAX_SAFE_INTEGER
})

export type CapitalConditionsSnapshotState = Readonly<StablecoinCapitalSnapshot & {
  observedAt: string
  verifiedAt: string
}>

export type CapitalConditionsCurrentHealth = Readonly<{
  status: 'healthy' | 'degraded'
  lastAttemptAt: string
  lastSuccessAt?: string
  consecutiveFailures: number
  snapshotReplaceCount: number
  snapshotNoWriteCount: number
  rejectionCount: number
  responseBodyTooLargeCount: number
}>

export type CapitalConditionsCurrentState = Readonly<{
  schemaVersion: typeof stablecoinCapitalCurrentStatePolicy.schemaVersion
  snapshot?: CapitalConditionsSnapshotState
  history?: readonly CapitalConditionsSnapshotState[]
  health: CapitalConditionsCurrentHealth
}>

export type CapitalConditionsStateStorage = {
  read: () => Promise<CapitalConditionsCurrentState | null>
  write: (state: CapitalConditionsCurrentState) => Promise<void>
}

export type CapitalConditionsCurrentStateStore = ReturnType<typeof createCapitalConditionsCurrentStateStore>

export function createCapitalConditionsCurrentStateStore(deps: { storage: CapitalConditionsStateStorage }) {
  let cached: CapitalConditionsCurrentState | undefined
  let readFailed = false

  async function current(): Promise<CapitalConditionsCurrentState> {
    if (cached) return cached
    try {
      cached = (await deps.storage.read()) ?? emptyState()
    } catch {
      readFailed = true
      cached = emptyState()
    }
    return cached
  }

  async function replace(next: CapitalConditionsCurrentState): Promise<boolean> {
    if (readFailed || !isSafeState(next)) return false
    try {
      await deps.storage.write(next)
      cached = next
      return true
    } catch {
      return false
    }
  }

  return {
    async read() {
      const state = await current()
      if (readFailed) throw new Error('capital conditions current state is unreadable')
      return state.snapshot ? state : null
    },
    async readHistory() {
      const state = await current()
      if (readFailed) throw new Error('capital conditions current state is unreadable')
      return state.history ?? []
    },
    async readHealth() {
      const state = await current()
      if (readFailed) throw new Error('capital conditions current state is unreadable')
      return state.health
    },
    async recordSuccess(input: { snapshot: StablecoinCapitalSnapshot; verifiedAt: string }): Promise<{ state: 'updated' | 'unchanged' | 'unavailable' }> {
      if (!isCanonicalUtcMillis(input.verifiedAt) || !isSnapshot(input.snapshot)) return { state: 'unavailable' }
      const previous = await current()
      const changed = !previous.snapshot || !sameCanonicalSnapshot(previous.snapshot, input.snapshot)
      const snapshot = Object.freeze({
        ...input.snapshot,
        observedAt: changed ? input.verifiedAt : previous.snapshot!.observedAt,
        verifiedAt: input.verifiedAt
      })
      const next = Object.freeze({
        schemaVersion: stablecoinCapitalCurrentStatePolicy.schemaVersion,
        snapshot,
        history: Object.freeze([...(previous.history ?? []), snapshot].slice(-24)),
        health: Object.freeze({
          status: 'healthy' as const,
          lastAttemptAt: input.verifiedAt,
          lastSuccessAt: input.verifiedAt,
          consecutiveFailures: 0,
          snapshotReplaceCount: increment(previous.health.snapshotReplaceCount, changed),
          snapshotNoWriteCount: increment(previous.health.snapshotNoWriteCount, !changed),
          rejectionCount: previous.health.rejectionCount,
          responseBodyTooLargeCount: previous.health.responseBodyTooLargeCount
        })
      })
      return await replace(next) ? { state: changed ? 'updated' : 'unchanged' } : { state: 'unavailable' }
    },
    async recordFailure(input: { attemptedAt: string; bodyTooLarge?: boolean }): Promise<{ state: 'updated' | 'unavailable' }> {
      if (!isCanonicalUtcMillis(input.attemptedAt)) return { state: 'unavailable' }
      const previous = await current()
      const next = Object.freeze({
        schemaVersion: stablecoinCapitalCurrentStatePolicy.schemaVersion,
        ...(previous.snapshot ? { snapshot: previous.snapshot } : {}),
        ...(previous.history ? { history: previous.history } : {}),
        health: Object.freeze({
          status: 'degraded' as const,
          lastAttemptAt: input.attemptedAt,
          ...(previous.health.lastSuccessAt ? { lastSuccessAt: previous.health.lastSuccessAt } : {}),
          consecutiveFailures: increment(previous.health.consecutiveFailures, true),
          snapshotReplaceCount: previous.health.snapshotReplaceCount,
          snapshotNoWriteCount: previous.health.snapshotNoWriteCount,
          rejectionCount: increment(previous.health.rejectionCount, true),
          responseBodyTooLargeCount: increment(previous.health.responseBodyTooLargeCount, input.bodyTooLarge === true)
        })
      })
      return await replace(next) ? { state: 'updated' } : { state: 'unavailable' }
    }
  }
}

export function createInMemoryCapitalConditionsStateStorage(initial?: CapitalConditionsCurrentState): CapitalConditionsStateStorage {
  let state = initial ? structuredClone(initial) : null
  return {
    async read() { return state ? structuredClone(state) : null },
    async write(next) { state = structuredClone(next) }
  }
}

export function createCapitalConditionsStateJsonStorage(filePath: string): CapitalConditionsStateStorage {
  const temporaryPath = `${filePath}.next`
  return {
    async read() {
      try {
        return JSON.parse(await readFile(filePath, 'utf8')) as CapitalConditionsCurrentState
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        return null
      }
    },
    async write(state) {
      const body = `${JSON.stringify(state)}\n`
      if (Buffer.byteLength(body, 'utf8') > stablecoinCapitalCurrentStatePolicy.maximumStateBytes) {
        throw new Error('capital conditions state exceeds budget')
      }
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(temporaryPath, body, 'utf8')
      await rename(temporaryPath, filePath)
    }
  }
}

function emptyState(): CapitalConditionsCurrentState {
  return Object.freeze({
    schemaVersion: stablecoinCapitalCurrentStatePolicy.schemaVersion,
    health: Object.freeze({
      status: 'healthy' as const,
      lastAttemptAt: '1970-01-01T00:00:00.000Z',
      consecutiveFailures: 0,
      snapshotReplaceCount: 0,
      snapshotNoWriteCount: 0,
      rejectionCount: 0,
      responseBodyTooLargeCount: 0
    })
  })
}

function sameCanonicalSnapshot(previous: CapitalConditionsSnapshotState, next: StablecoinCapitalSnapshot): boolean {
  return previous.coreCurrentUsd === next.coreCurrentUsd &&
    previous.change1dUsd === next.change1dUsd &&
    previous.change1dPercent === next.change1dPercent &&
    JSON.stringify(previous.dailyFlows ?? []) === JSON.stringify(next.dailyFlows ?? []) &&
    previous.change7dUsd === next.change7dUsd &&
    previous.change7dPercent === next.change7dPercent &&
    previous.change30dUsd === next.change30dUsd &&
    previous.change30dPercent === next.change30dPercent &&
    previous.usdStablecoinSupplyUsd === next.usdStablecoinSupplyUsd
}

function increment(value: number, shouldIncrement: boolean): number {
  return shouldIncrement ? Math.min(value + 1, stablecoinCapitalCurrentStatePolicy.maximumCounter) : value
}

function isSnapshot(value: StablecoinCapitalSnapshot): boolean {
  return [
    value.coreCurrentUsd,
    value.change1dUsd,
    value.change1dPercent,
    value.change7dUsd,
    value.change7dPercent,
    value.change30dUsd,
    value.change30dPercent,
    value.usdStablecoinSupplyUsd
  ].every((value) => value === undefined || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER)) &&
    (value.dailyFlows === undefined || isDailyFlows(value.dailyFlows))
}

function isDailyFlows(value: readonly { tradingDate: string; netFlowUsd: number }[]): boolean {
  if (!Array.isArray(value) || value.length < capitalConditionsDailyFlowPolicy.minimumRows || value.length > capitalConditionsDailyFlowPolicy.maximumRows) return false
  let previous: string | undefined
  for (const row of value) {
    const instant = typeof row?.tradingDate === 'string' ? Date.parse(`${row.tradingDate}T00:00:00.000Z`) : NaN
    if (!row || typeof row !== 'object' || Object.getOwnPropertyNames(row).length !== 2 || typeof row.tradingDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.tradingDate) || !Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== row.tradingDate || typeof row.netFlowUsd !== 'number' || !Number.isFinite(row.netFlowUsd) || Object.is(row.netFlowUsd, -0)) return false
    if (previous && instant - Date.parse(`${previous}T00:00:00.000Z`) !== capitalConditionsDailyFlowPolicy.dayMilliseconds) return false
    previous = row.tradingDate
  }
  return true
}

function isSafeState(state: CapitalConditionsCurrentState): boolean {
  const snapshotBytes = state.snapshot ? Buffer.byteLength(JSON.stringify(state.snapshot), 'utf8') : 0
  const healthBytes = Buffer.byteLength(JSON.stringify(state.health), 'utf8')
  const stateBytes = Buffer.byteLength(JSON.stringify(state), 'utf8')
  return snapshotBytes <= stablecoinCapitalCurrentStatePolicy.maximumSnapshotBytes &&
    healthBytes <= stablecoinCapitalCurrentStatePolicy.maximumHealthBytes &&
    stateBytes <= stablecoinCapitalCurrentStatePolicy.maximumStateBytes &&
    stateBytes * 2 <= stablecoinCapitalCurrentStatePolicy.maximumAtomicDiskBytes
}

function isCanonicalUtcMillis(value: string): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
