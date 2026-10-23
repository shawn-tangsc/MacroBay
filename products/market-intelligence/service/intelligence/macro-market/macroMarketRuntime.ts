import { join } from 'node:path'
import { getPlatformFetch } from '@platform/network/platformFetch'
import type { JobRuntime } from '@platform/jobs'
import { createMacroMarketCollector, type MacroMarketCollectionResult, type MacroMarketTransport } from './macroMarketCollector'
import { registerMacroMarketJob } from './macroMarketJob'
import { macroMarketPolicy } from './macroMarketPolicy'
import { createMacroMarketStore, macroMarketStoragePolicy, type MacroMarketStore } from './macroMarketStore'
import { createRealMarketApiDxyRuntime, type RealMarketApiDxyRuntime } from './realMarketApiDxyRuntime'

type Profile = Readonly<{ credentialRef?: string | null; enabled?: boolean }>
type Credential = Readonly<{ apiKey?: string }>

/** The funded provider answers errors as JSON bodies; a transport failure is its own state. */
export function createMacroMarketTransport(fetchImpl: typeof fetch = getPlatformFetch()): MacroMarketTransport {
  return async url => {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(macroMarketPolicy.timeoutMs) })
      const text = await response.text()
      if (text.length > macroMarketPolicy.maxBodyBytes) return { state: 'unavailable', failureCode: 'response-invalid' }
      return { state: 'ok', status: response.status, body: JSON.parse(text) }
    } catch {
      return { state: 'unavailable', failureCode: 'transport-unavailable' }
    }
  }
}

export type MacroMarketRuntime = Readonly<{
  store: MacroMarketStore
  run: (atMs?: number, options?: Readonly<{ force?: boolean }>) => Promise<MacroMarketRunResult>
  /**
   * The real ICE dollar index, collected beside the synthesised basket from the same store. It is a
   * second source with its own switch, key and job; the store is shared because the two are two
   * series of one history.
   */
  runRealMarketApiDxy: RealMarketApiDxyRuntime['run']
}>

/** What a runtime run reports. `disabled` is a state of its own: switched off is not "no credential". */
export type MacroMarketRunResult =
  | Readonly<{ state: 'disabled'; credits: 0 }>
  | MacroMarketCollectionResult

/**
 * Composition for the macro-market collector inside the product module.
 *
 * The credential is read the same way every other credentialed source reads it: through the source
 * profile's `credentialRef` and the encrypted credential store, never from a file the renderer can
 * reach and never from an environment variable.
 */
export function createMacroMarketRuntime(deps: Readonly<{
  jobRuntime: JobRuntime
  resolveProfile: (sourceId: string) => Promise<Profile>
  getCredential: (credentialRef: string) => Promise<Credential | null>
  dataDirectory: string
  fetchImpl?: typeof fetch
  /** The clock the tick plan reads. Injected so a test can choose which tick it is exercising. */
  now?: () => number
  /** The failing source id travels with the error: a failure is never filed under the other source. */
  onError?: (error: unknown, sourceId: string) => void
}>): MacroMarketRuntime {
  const store = createMacroMarketStore(join(deps.dataDirectory, macroMarketStoragePolicy.fileName))
  const collector = createMacroMarketCollector({
    transport: createMacroMarketTransport(deps.fetchImpl),
    store,
    ...(deps.now ? { now: deps.now } : {}),
    credentials: async () => {
      const profile = await deps.resolveProfile(macroMarketPolicy.sourceId)
      if (!profile.credentialRef) return undefined
      return (await deps.getCredential(profile.credentialRef))?.apiKey
    }
  })
  const run = async (atMs?: number, options: Readonly<{ force?: boolean }> = {}): Promise<MacroMarketRunResult> => {
    try {
      // The reader's switch is the first word: a source they have not enabled must not spend a
      // credit or write a level, and "switched off" is reported as such rather than as a missing key.
      const profile = await deps.resolveProfile(macroMarketPolicy.sourceId)
      if (profile.enabled !== true) return { state: 'disabled', credits: 0 }
      const result = await collector.run(atMs, options)
      if (result.state === 'unavailable') deps.onError?.(new Error(`macro-market ${result.failureCode}`), macroMarketPolicy.sourceId)
      return result
    } catch (error) {
      // A collector failure must never take the scheduler down with it.
      deps.onError?.(error, macroMarketPolicy.sourceId)
      return { state: 'unavailable' as const, failureCode: 'transport-unavailable' as const, credits: 0 }
    }
  }
  // The real dollar index lives here rather than in its own runtime so that exactly one connection
  // owns `macro-market.sqlite`: the basket and the licensed index are two series of one history.
  const realMarketApiDxy = createRealMarketApiDxyRuntime({
    store, jobRuntime: deps.jobRuntime,
    resolveProfile: deps.resolveProfile, getCredential: deps.getCredential,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.onError ? { onError: deps.onError } : {})
  })
  registerMacroMarketJob(deps.jobRuntime, run)
  return { store, run, runRealMarketApiDxy: realMarketApiDxy.run }
}
