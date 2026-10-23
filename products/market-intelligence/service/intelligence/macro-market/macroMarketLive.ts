import { createPlatformWebSocketFactory } from '@platform/network/platformWebSocket'
import { goldLivePolicy } from './goldLivePolicy'
import { createGoldLiveStream } from './goldLiveStream'
import { createGoldLiveRuntime, type GoldLiveRuntime, type GoldLiveScheduler } from './goldLiveRuntime'

type ProfiledSource = Readonly<{
  resolveProfile: (sourceId: string) => Promise<Readonly<{ credentialRef?: string | null; enabled?: boolean }>>
  getCredential: (credentialRef: string) => Promise<Readonly<{ apiKey?: string }> | null>
}>

/**
 * Composition for the gold live stream inside the product module.
 *
 * The socket factory is injected rather than imported at the call site so the credential and the
 * proxy-aware transport stay in one place: the runtime reads the key from the credential store the
 * same way the collector does, and the transport is always the platform factory, never a raw
 * `WebSocket` a product file reached for directly.
 */
export function createMacroMarketLive(deps: Readonly<{
  source: ProfiledSource
  createWebSocket?: () => ReturnType<typeof createPlatformWebSocketFactory>
  now?: () => number
  scheduler?: GoldLiveScheduler
  random?: () => number
  onError?: (error: unknown) => void
}>): GoldLiveRuntime {
  const profile = async () => deps.source.resolveProfile(goldLivePolicy.sourceId)
  return createGoldLiveRuntime({
    // The switch comes from the profile store; the key from the encrypted credential store, read
    // through the profile's own `credentialRef`. One reader, exactly like the collector's.
    resolveProfile: async () => {
      const resolved = await profile()
      return { credentialRef: resolved.credentialRef, enabled: resolved.enabled }
    },
    getCredential: async () => {
      const credentialRef = (await profile()).credentialRef
      return credentialRef ? (await deps.source.getCredential(credentialRef))?.apiKey : undefined
    },
    createStream: input => {
      if (!deps.createWebSocket) throw new Error('dependency-unavailable')
      return createGoldLiveStream({
        platformWebSocket: deps.createWebSocket(),
        apiKey: input.apiKey,
        now: input.now,
        // The keepalive is armed on the same scheduler the runtime already retries on, so a test that
        // steps the clock steps the heartbeat too and the app uses the platform's own timers.
        scheduler: input.scheduler,
        onState: input.onState
      })
    },
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.scheduler ? { scheduler: deps.scheduler } : {}),
    ...(deps.random ? { random: deps.random } : {}),
    ...(deps.onError ? { onError: deps.onError } : {})
  })
}
