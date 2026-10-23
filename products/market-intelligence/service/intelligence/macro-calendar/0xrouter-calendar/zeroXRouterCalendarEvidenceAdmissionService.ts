import { requestZeroXRouterJsonBody, type ZeroXRouterBodyTransportResult } from '../../application/zeroXRouterHttpTransport'
import { isSafeZeroXRouterApiKey, zeroXRouterCalendarEvidenceAdmissionPolicy, zeroXRouterHttpTransportPolicy, zeroXRouterSourcePolicy } from '../../application/zeroXRouterSourcePolicy'
import type { createSourceRequestGovernanceQueue } from '../../application/sourceRequestGovernance'
import type { MacroCalendarEvidenceAppendInput, MacroCalendarEvidenceReference, MacroCalendarEvidenceStore } from '../macroCalendarEvidenceStore'
import { zeroXRouterCalendarEvidenceDescriptors, type MacroCalendarEvidenceOnlySourceDescriptor } from '../macroCalendarOfficialSourceRegistry'

type Locale = 'zh' | 'en'
type AdmissionInput = Readonly<{ descriptorId: string; locale: Locale }>
type AdmissionResult =
  | Readonly<{ state: 'persisted'; descriptorId: string; locale: Locale; acceptedBytes: number; evidenceHash: string }>
  | Readonly<{ state: 'unavailable'; failureCode: 'descriptor-not-found' | 'locale-not-supported' | 'window-not-accepted' | 'credential-not-configured' | 'response-envelope' | 'transport-unavailable' | 'archive-unavailable' }>

export function createZeroXRouterCalendarEvidenceAdmissionService(deps: Readonly<{
  requestGovernanceQueue: ReturnType<typeof createSourceRequestGovernanceQueue>
  getApiKey: () => Promise<string | undefined>
  evidence: Pick<MacroCalendarEvidenceStore, 'reserve' | 'release' | 'append'>
  now?: () => Date
  createRunId?: () => string
  requestJsonBody?: (input: Readonly<{ url: string; apiKey: string }>) => Promise<ZeroXRouterBodyTransportResult>
  onCall?: (name: 'queue' | 'request-body' | 'archive') => void
}>) {
  const requestBody = deps.requestJsonBody ?? requestZeroXRouterJsonBody
  return Object.freeze({
    listDescriptors: () => zeroXRouterCalendarEvidenceDescriptors,
    collect: async (input: AdmissionInput): Promise<AdmissionResult> => {
      const descriptor = resolveDescriptor(input?.descriptorId)
      if (!descriptor) return { state: 'unavailable', failureCode: 'descriptor-not-found' }
      if (input.locale !== 'zh' && input.locale !== 'en') return { state: 'unavailable', failureCode: 'locale-not-supported' }
      if (Object.prototype.hasOwnProperty.call(input, 'month')) return { state: 'unavailable', failureCode: 'window-not-accepted' }
      const apiKey = await deps.getApiKey()
      if (!isSafeZeroXRouterApiKey(apiKey)) return { state: 'unavailable', failureCode: 'credential-not-configured' }
      const observedAt = (deps.now ?? (() => new Date()))()
      const reservation = deps.evidence.reserve(zeroXRouterHttpTransportPolicy.responseAcceptedMaxBytes)
      if (!reservation) return { state: 'unavailable', failureCode: 'archive-unavailable' }
      try {
        let transport: ZeroXRouterBodyTransportResult
        try {
          deps.onCall?.('queue')
          transport = await deps.requestGovernanceQueue.enqueue({
            sourceId: zeroXRouterSourcePolicy.sourceId,
            policy: zeroXRouterSourcePolicy.requestGovernance,
            apiKey,
            intent: 'user',
            run: async () => {
              return requestBody({ url: requestUrl(descriptor, input.locale, observedAt), apiKey })
            }
          })
        } catch {
          return { state: 'unavailable', failureCode: 'transport-unavailable' }
        }
        if (transport.state === 'failed') return { state: 'unavailable', failureCode: transport.failureCode === 'transport-unavailable' ? 'transport-unavailable' : 'response-envelope' }
        if (!isAcceptedEnvelope(transport.body)) return { state: 'unavailable', failureCode: 'response-envelope' }
        const body = transport.body
        const evidence = await deps.evidence.append({
          descriptor,
          sourceUrl: descriptor.sourceUrl,
          detectedAt: observedAt.toISOString(),
          body,
          payloadFormat: 'json',
          runId: (deps.createRunId ?? (() => `0xrouter-calendar-evidence-${Date.now()}`))(),
          parserVersion: descriptor.parserId,
          response: { status: transport.status, contentType: transport.contentType, locale: input.locale }
        } satisfies MacroCalendarEvidenceAppendInput, reservation)
        if (!evidence) return { state: 'unavailable', failureCode: 'archive-unavailable' }
        deps.onCall?.('archive')
        return { state: 'persisted', descriptorId: descriptor.descriptorId, locale: input.locale, acceptedBytes: transport.acceptedBytes, evidenceHash: evidence.evidenceHash }
      } finally {
        deps.evidence.release(reservation)
      }
    }
  })
}

function resolveDescriptor(descriptorId: string): MacroCalendarEvidenceOnlySourceDescriptor | undefined {
  if (!(descriptorId in zeroXRouterCalendarEvidenceAdmissionPolicy.paths)) return undefined
  return zeroXRouterCalendarEvidenceDescriptors.find((descriptor) => descriptor.descriptorId === descriptorId)
}

function requestUrl(descriptor: MacroCalendarEvidenceOnlySourceDescriptor, locale: Locale, now: Date): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1)
  const parameters = zeroXRouterCalendarEvidenceAdmissionPolicy.currentUtcMonthParameterNames
  const url = new URL(descriptor.sourceUrl)
  url.searchParams.set(parameters.locale, locale)
  url.searchParams.set(parameters.start, String(start.getTime()))
  url.searchParams.set(parameters.end, String(end.getTime()))
  return url.toString()
}

function isAcceptedEnvelope(body: string): boolean {
  try {
    const value = JSON.parse(body) as unknown
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as { code?: unknown }).code === 200 && Array.isArray((value as { data?: unknown }).data))
  } catch {
    return false
  }
}
