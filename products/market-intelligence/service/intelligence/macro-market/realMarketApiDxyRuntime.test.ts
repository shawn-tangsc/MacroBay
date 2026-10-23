import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createInMemoryProfileStorage, createSourceProfileStore } from '../application/sourceProfileStore'
import { createInMemoryIntelligenceCredentialStorage, createIntelligenceCredentialStore } from '../store/intelligenceCredentialStore'
import { createMacroMarketRuntime, type MacroMarketRuntime } from './macroMarketRuntime'
import { createMacroMarketSnapshotQuery } from './macroMarketSnapshotQuery'
import { REAL_MARKET_API_DXY_COLLECT_JOB_ID } from './realMarketApiDxyJob'
import { realMarketApiPolicy } from './realMarketApiPolicy'
import { realMarketApiCandleResponse, realMarketApiPriceResponse } from './realMarketApiResponseFixtures'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

/** The shape the provider issues (48 alphanumerics) and never the reader's key. */
const KEY = 'kRHg'.repeat(12)
const CREDENTIAL_REF = `${realMarketApiPolicy.sourceId}-credentials`
const series = realMarketApiPolicy.series.dollarIndex
const goldSeries = realMarketApiPolicy.series.gold
const notes = realMarketApiPolicy.notes
const at = (minute: number) => Date.UTC(2026, 9, 14, 11, minute)
const newestCandleAtMs = Date.UTC(2026, 9, 14, 11, 30)

type Routes = Readonly<{ price?: Readonly<{ status?: number; body?: unknown }>; candle?: Readonly<{ status?: number; body?: unknown }> }>

/** The provider's own answer for spot gold, the second instrument this source now carries. */
const goldPriceResponse = Object.freeze({ ...realMarketApiPriceResponse, symbolCode: 'XAUUSD', closePrice: 4180.5 })
const goldCandleResponse = Object.freeze({
  data: Object.freeze(realMarketApiCandleResponse.data.map(row => Object.freeze({ ...row, symbolCode: 'XAUUSD', closePrice: 4180.5 })))
})
/** Answer the instrument the request asked for, so neither series can be filled with the other's bars. */
const instrumentBody = (url: string): unknown => {
  const gold = new URL(url).searchParams.get('symbolCode') === 'XAUUSD'
  return url.includes('/api/v1/candle') ? (gold ? goldCandleResponse : realMarketApiCandleResponse) : (gold ? goldPriceResponse : realMarketApiPriceResponse)
}

/**
 * The composition `intelligenceModule` builds, in miniature: the *real* profile store and the *real*
 * credential store, wired to the runtime exactly as the app wires them, with only the transport faked.
 * A test that stubbed the credential away would not have caught what actually went wrong in the app.
 */
async function compose(routes: Routes = {}, options: Readonly<{ saveCredential?: boolean; enabled?: boolean; onError?: (error: unknown, sourceId: string) => void }> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'real-dxy-runtime-')); directories.push(directory)
  const handlers = new Map<string, (payload: unknown, context: never) => Promise<void>>()
  const urls: string[] = []
  const fetchImpl = (async (url: string) => {
    urls.push(String(url))
    const route = String(url).includes('/api/v1/candle') ? routes.candle : routes.price
    return {
      status: route?.status ?? 200,
      text: async () => JSON.stringify(route?.body ?? instrumentBody(String(url)))
    }
  }) as unknown as typeof fetch
  const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
  const credentialStore = createIntelligenceCredentialStore(createInMemoryIntelligenceCredentialStorage())
  const macro: MacroMarketRuntime = createMacroMarketRuntime({
    jobRuntime: {
      registerHandler: (id: string, handler: (payload: unknown, context: never) => Promise<void>) => { handlers.set(id, handler) },
      setSchedule: () => undefined,
      enqueueDefinition: async () => ({ id: 'run-1' })
    } as never,
    resolveProfile: sourceId => profileStore.resolveProfile(sourceId),
    getCredential: credentialRef => credentialStore.getByRef(credentialRef as never),
    dataDirectory: directory,
    fetchImpl,
    now: () => at(0),
    ...(options.onError ? { onError: options.onError } : {})
  })
  const saveCredential = options.saveCredential !== false
  if (saveCredential) await credentialStore.save({ credentialRef: CREDENTIAL_REF, sourceId: realMarketApiPolicy.sourceId, apiKey: KEY })
  /** Saving the profile is what attaches the vault ref to the source, exactly as the drawer does. */
  const saveProfile = (enabled: boolean, withCredentialRef: boolean = saveCredential) => profileStore.saveProfile({
    sourceId: realMarketApiPolicy.sourceId, enabled, ...(withCredentialRef ? { credentialRef: CREDENTIAL_REF } : {})
  })
  await saveProfile(options.enabled !== false)
  /** One tick, as the scheduler fires it: the startup definition carries the force flag. */
  const tick = async (payload: Readonly<{ startup?: boolean }> = { startup: true }) =>
    handlers.get(REAL_MARKET_API_DXY_COLLECT_JOB_ID)!({ ...payload }, {} as never)
  return { macro, urls, tick, saveProfile, credentialStore, handlers }
}

describe('the real dollar index end to end', () => {
  it('stores the provider level on a real tick, through the profile and credential path the app uses', async () => {
    const { macro, urls, tick, handlers } = await compose()

    expect(handlers.has(REAL_MARKET_API_DXY_COLLECT_JOB_ID)).toBe(true)
    await tick()

    // The point is really in the store, at the provider's own instant and value.
    expect(macro.store.count(series)).toBe(3)
    expect(macro.store.count(goldSeries)).toBe(3)
    expect(macro.store.latest(series)).toEqual({ atMs: newestCandleAtMs, value: 102.236 })
    expect(macro.store.latest(goldSeries)).toEqual({ atMs: newestCandleAtMs, value: 4180.5 })
    expect(urls[0]).toContain('symbolCode=DXY')
    // And the tick says what it did, so a scheduler that reports `completed` for everything is not the
    // only evidence of what happened.
    expect(macro.store.readNote(notes.lastOutcome)).toBe('stored')
    expect(macro.store.readNote(notes.lastFailureCode)).toBeUndefined()
    expect(macro.store.readNote(notes.lastPlan)).toBe('backfill')

    // The snapshot the dashboard reads: the licensed series, no computed label, and the windows the
    // stored points can honestly answer.
    const snapshot = createMacroMarketSnapshotQuery({ store: macro.store, now: () => at(30) }).snapshot()
    const dollar = snapshot.readings[0]
    expect(dollar).toMatchObject({ seriesId: series, level: 102.236 })
    expect(dollar.synthetic).toBeUndefined()
    expect(dollar.returns['15m']).toBeCloseTo((102.236 / 102.24 - 1) * 100, 6)
    expect(dollar.returns['24h']).toBeUndefined()
    expect(snapshot.caveats).not.toContain('synthetic-dollar-index')
    macro.store.close()
  })

  it('records why it stored nothing when no key can be resolved, instead of reporting a silent success', async () => {
    const { macro, urls, tick } = await compose({}, { saveCredential: false })

    await tick()

    expect(macro.store.count(series)).toBe(0)
    expect(urls).toHaveLength(0)
    expect(macro.store.readNote(notes.lastFailureCode)).toBe('credential-missing')
    expect(macro.store.readNote(notes.lastOutcome)).toBe('unavailable:credential-missing')
    macro.store.close()
  })

  // The incident, as a regression test: four ticks "completed" before the reader saved a key, and
  // nothing in the store said why. The keyless tick must leave a trace, and the next tick must store.
  it('traces the keyless tick and stores on the first tick after the key arrives', async () => {
    const { macro, tick, saveProfile, credentialStore, urls } = await compose({}, { saveCredential: false })

    await tick()
    expect(macro.store.readNote(notes.lastOutcome)).toBe('unavailable:credential-missing')
    expect(macro.store.count(series)).toBe(0)

    // The reader pastes the key and enables the source, exactly as the settings drawer does.
    await credentialStore.save({ credentialRef: CREDENTIAL_REF, sourceId: realMarketApiPolicy.sourceId, apiKey: KEY })
    await saveProfile(true, true)
    await tick()

    expect(macro.store.count(series)).toBe(3)
    expect(macro.store.count(goldSeries)).toBe(3)
    expect(macro.store.readNote(notes.lastOutcome)).toBe('stored')
    // Two price legs plus the four-rung deep ladder on each of them: the first tick after the key
    // arrives is also the only tick that ever repairs the history.
    expect(urls).toHaveLength(10)
    macro.store.close()
  })

  it('records a switched-off source as switched off rather than as a silent success', async () => {
    const { macro, urls, tick } = await compose({}, { enabled: false })

    await tick()

    expect(urls).toHaveLength(0)
    expect(macro.store.count(series)).toBe(0)
    expect(macro.store.readNote(notes.lastOutcome)).toBe('disabled')
    // Switched off is not a failure code: the outcome note is where it belongs.
    expect(macro.store.readNote(notes.lastFailureCode)).toBeUndefined()
    macro.store.close()
  })

  it('records a rejected key as a code and stores no level', async () => {
    const errors: Readonly<{ message: string; sourceId: string }>[] = []
    const { macro, tick } = await compose(
      { price: { status: 401, body: { message: 'invalid api key' } } },
      { onError: (error, sourceId) => { errors.push({ message: String(error), sourceId }) } }
    )

    await tick()

    expect(macro.store.count(series)).toBe(0)
    expect(macro.store.readNote(notes.lastFailureCode)).toBe('credential-rejected')
    expect(macro.store.readNote(notes.lastOutcome)).toBe('unavailable:credential-rejected')
    // The failure is filed under this source and carries a code, never the URL the key travelled in.
    expect(errors).toEqual([{ message: 'Error: realmarketapi-market credential-rejected', sourceId: realMarketApiPolicy.sourceId }])
    expect(JSON.stringify(errors)).not.toContain(KEY.slice(0, 8))
    macro.store.close()
  })
})
