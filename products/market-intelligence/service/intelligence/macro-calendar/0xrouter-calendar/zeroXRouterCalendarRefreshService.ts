import { zeroXRouterCalendarTransportPolicy as transportPolicy } from '../../application/zeroXRouterSourcePolicy'
import { marketCalendarPublicPolicy } from '../../../../contracts/macro/marketCalendarQueryContracts'
import type { createZeroXRouterCalendarCollectionService } from './zeroXRouterCalendarCollectionService'
import { zeroXRouterCalendarParserPolicy } from './zeroXRouterCalendarContracts'

// Product-owned refresh admission only: no scheduling, result cache or runtime registration.
export const zeroXRouterCalendarRefreshPolicy = Object.freeze({
  monthOffsets: [-1, 0, 1], maximumInFlightManualBatches: 6, manualKeys: ['month', 'locale']
})
type Collection = ReturnType<typeof createZeroXRouterCalendarCollectionService>
type Request = Parameters<Collection['requestManual']>[0]
type Scope = Pick<Request, 'descriptorId' | 'locale'>
type Status = 'success' | 'success-empty' | 'all-skipped' | 'partial'
/** What one source attempt can report back; the public boundary owns this vocabulary. */
type AttemptFailure = typeof marketCalendarPublicPolicy.attemptFailures[number]
type Item = Scope & ({ state: 'unavailable'; failureCode?: AttemptFailure } | {
  state: 'succeeded'; status: Status; inputRows: number; skippedRows: number; storedRows: number
})
type Failure = 'input-invalid' | 'disabled' | 'credential-not-configured' | 'readiness-unavailable' | 'busy' | 'storage-unavailable' | 'storage-pressure'
type RefreshResult = Readonly<{ state: 'completed' | 'partial' | 'unavailable'; items: readonly Item[]; failureCode?: Failure }>
const descriptors = Object.keys(transportPolicy.descriptorPaths) as Request['descriptorId'][]

export function createZeroXRouterCalendarRefreshService(deps: Readonly<{
  collection: Pick<Collection, 'requestManual' | 'requestAutomatic'>
  now: () => Date
  readReadiness: () => { enabled: boolean; hasCredential: boolean } | Promise<{ enabled: boolean; hasCredential: boolean }>
  /** Source ids the reader has enabled; undefined rows default to enabled. */
  readEnabledFeeds?: () => readonly string[] | Promise<readonly string[]>
}>) {
  const inFlight = new Map<string, Promise<RefreshResult>>()
  const unavailable = (failureCode: Failure): RefreshResult => ({ state: 'unavailable', failureCode, items: [] })
  async function readiness(): Promise<Failure | undefined> {
    try {
      const ready = await deps.readReadiness()
      if (ready.enabled !== true) return 'disabled'
      if (ready.hasCredential !== true) return 'credential-not-configured'
    } catch { return 'readiness-unavailable' }
  }

  return Object.freeze({
    refreshManual(input: Pick<Request, 'month' | 'locale'>): Promise<RefreshResult> {
      let month: string, locale: Request['locale']
      try {
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Reflect.ownKeys(input).length !== zeroXRouterCalendarRefreshPolicy.manualKeys.length ||
          Reflect.ownKeys(input).some(key => typeof key !== 'string' || !zeroXRouterCalendarRefreshPolicy.manualKeys.includes(key)) ||
          typeof input.month !== 'string' || !transportPolicy.monthPattern.test(input.month) ||
          !transportPolicy.locales.includes(input.locale)) return Promise.resolve(unavailable('input-invalid'))
        month = input.month
        locale = input.locale
        const now = deps.now()
        const current = now.getUTCFullYear() * 12 + now.getUTCMonth()
        const [year, oneBasedMonth] = month.split('-').map(Number)
        if (!zeroXRouterCalendarRefreshPolicy.monthOffsets.includes(year! * 12 + oneBasedMonth! - 1 - current)) {
          return Promise.resolve(unavailable('input-invalid'))
        }
      } catch { return Promise.resolve(unavailable('input-invalid')) }
      const key = `${month}/${locale}`
      const existing = inFlight.get(key)
      if (existing) return existing
      if (inFlight.size >= zeroXRouterCalendarRefreshPolicy.maximumInFlightManualBatches) return Promise.resolve(unavailable('busy'))
      const scopes = descriptors.map(descriptorId => ({ descriptorId, locale }))
      const promise = (async () => {
        const failure = await readiness()
        if (failure) return unavailable(failure)
        const results = await Promise.all(scopes.map(async scope => {
          try { return await deps.collection.requestManual({ ...scope, month }) } catch { return undefined }
        }))
        return aggregate(scopes, results, month)
      })().finally(() => { inFlight.delete(key) })
      inFlight.set(key, promise)
      return promise
    },
    async refreshAutomatic(enabledFeeds?: readonly string[]): Promise<RefreshResult> {
      const failure = await readiness()
      if (failure) return unavailable(failure)
      const enabled = enabledFeeds ? new Set(enabledFeeds) : deps.readEnabledFeeds ? new Set(await deps.readEnabledFeeds()) : undefined
      const active = enabled ? descriptors.filter(descriptorId => enabled.has(descriptorId)) : descriptors
      if (active.length === 0) return unavailable('disabled')
      const scopes = active.flatMap(descriptorId => transportPolicy.locales.map(locale => ({ descriptorId, locale })))
      try { return aggregate(scopes, await deps.collection.requestAutomatic(active)) }
      catch { return aggregate(scopes, []) }
    }
  })
}

function aggregate(scopes: readonly Scope[], results: readonly unknown[], requestedMonth?: string): RefreshResult {
  let storageUnavailable = false
  let storagePressure = false
  const items = scopes.map((scope, index): Item => {
    const result = results[index] as Awaited<ReturnType<Collection['requestManual']>> | undefined
    // The batch names the source verdict, so a per-source reader does not have to guess it
    // from the batch code, and the batch prefers the ceiling verdict when one source hit it.
    const failureCode = result?.state === 'unavailable' && attemptFailure(result.failureCode)
      ? result.failureCode : undefined
    const failed: Item = { ...scope, state: 'unavailable', ...(failureCode ? { failureCode } : {}) }
    if (failureCode === 'storage-pressure') storagePressure = true
    if (failureCode === 'storage-unavailable' || failureCode === 'archive-unavailable') storageUnavailable = true
    if (result?.state !== 'succeeded' || result.descriptorId !== scope.descriptorId || result.locale !== scope.locale) return failed
    if (requestedMonth !== undefined && result.month !== requestedMonth) return failed
    const value = result.collection
    if (!value || value.state !== 'succeeded') return failed
    const { inputRows, skippedRows, storedRows } = value
    if (![inputRows, skippedRows, storedRows].every(count => Number.isSafeInteger(count) && count >= 0 && count <= zeroXRouterCalendarParserPolicy.maximumRows) ||
      inputRows !== skippedRows + storedRows) return failed
    const status = !inputRows ? 'success-empty' : inputRows === skippedRows ? 'all-skipped' : skippedRows ? 'partial' : 'success'
    if (value.status !== status) return failed
    return { ...scope, state: 'succeeded', status, inputRows, skippedRows, storedRows }
  })
  const successes = items.filter(item => item.state === 'succeeded').length
  const batchFailure: Failure | undefined = storagePressure ? 'storage-pressure' : storageUnavailable ? 'storage-unavailable' : undefined
  return { state: successes === items.length ? 'completed' : successes ? 'partial' : 'unavailable', items,
    ...(batchFailure ? { failureCode: batchFailure } : {}) }
}

function attemptFailure(value: string): value is AttemptFailure {
  return (marketCalendarPublicPolicy.attemptFailures as readonly string[]).includes(value)
}
