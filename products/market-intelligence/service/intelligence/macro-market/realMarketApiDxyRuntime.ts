import type { JobRuntime } from '@platform/jobs'
import type { MacroMarketStore } from './macroMarketStore'
import { createRealMarketApiCollector, type RealMarketApiCollectionResult } from './realMarketApiCollector'
import { registerRealMarketApiDxyJob } from './realMarketApiDxyJob'
import { realMarketApiPolicy } from './realMarketApiPolicy'
import { createRealMarketApiTransport } from './realMarketApiTransport'

type Profile = Readonly<{ credentialRef?: string | null; enabled?: boolean }>
type Credential = Readonly<{ apiKey?: string }>

/** What a run reports. `disabled` is a state of its own: switched off is not "no credential". */
export type RealMarketApiDxyRunResult =
  | Readonly<{ state: 'disabled'; credits: 0 }>
  | RealMarketApiCollectionResult

export type RealMarketApiDxyRuntime = Readonly<{
  run: (atMs?: number, options?: Readonly<{ force?: boolean }>) => Promise<RealMarketApiDxyRunResult>
}>

/**
 * Composition for the real-dollar collector inside the product module.
 *
 * The store is handed in rather than created here: the real index and the synthesised basket are two
 * series of one history, and two connections to one SQLite file would be two writers of one table.
 * The credential is read the way every other credentialed source reads it — the profile's
 * `credentialRef` and then the encrypted store — so the key never reaches the renderer.
 *
 * The error callback carries the source id, so a failure is never filed under the fallback source.
 */
export function createRealMarketApiDxyRuntime(deps: Readonly<{
  store: MacroMarketStore
  jobRuntime: JobRuntime
  resolveProfile: (sourceId: string) => Promise<Profile>
  getCredential: (credentialRef: string) => Promise<Credential | null>
  fetchImpl?: typeof fetch
  now?: () => number
  onError?: (error: unknown, sourceId: string) => void
}>): RealMarketApiDxyRuntime {
  const collector = createRealMarketApiCollector({
    transport: createRealMarketApiTransport(deps.fetchImpl),
    store: deps.store,
    ...(deps.now ? { now: deps.now } : {}),
    credentials: async () => {
      const profile = await deps.resolveProfile(realMarketApiPolicy.sourceId)
      if (!profile.credentialRef) return undefined
      return (await deps.getCredential(profile.credentialRef))?.apiKey
    }
  })
  /**
   * Every tick leaves one line of evidence behind, including the ticks that do nothing at all.
   *
   * The scheduler reports `completed` for anything that returns rather than throws, so without this
   * note a source that never collected, never spent a request and never failed reads exactly like one
   * that is working. `disabled`, `idle`, `stored`, `unchanged` and `unavailable:<code>` are the only
   * values, and each of them is written by one line below.
   */
  function noteOutcome(outcome: string): void {
    deps.store.note(realMarketApiPolicy.notes.lastOutcome, outcome)
  }

  const run = async (atMs?: number, options: Readonly<{ force?: boolean }> = {}): Promise<RealMarketApiDxyRunResult> => {
    try {
      // The reader's switch is the first word, exactly as it is for the basket: a source they have not
      // enabled must not spend a request, and "switched off" is reported as such.
      const profile = await deps.resolveProfile(realMarketApiPolicy.sourceId)
      if (profile.enabled !== true) {
        noteOutcome('disabled')
        return { state: 'disabled', credits: 0 }
      }
      const result = await collector.run(atMs, options)
      if (result.state === 'unavailable') {
        noteOutcome(`unavailable:${result.failureCode}`)
        deps.onError?.(new Error(`${realMarketApiPolicy.sourceId} ${result.failureCode}`), realMarketApiPolicy.sourceId)
      } else {
        noteOutcome(result.state)
      }
      return result
    } catch (error) {
      // A collector failure must never take the scheduler down with it, and the message stays a code:
      // the message names the source and the outcome, never the URL the key travelled in.
      noteOutcome('unavailable:transport-unavailable')
      deps.onError?.(error, realMarketApiPolicy.sourceId)
      return { state: 'unavailable' as const, failureCode: 'transport-unavailable' as const, credits: 0 }
    }
  }
  registerRealMarketApiDxyJob(deps.jobRuntime, run)
  return { run }
}
