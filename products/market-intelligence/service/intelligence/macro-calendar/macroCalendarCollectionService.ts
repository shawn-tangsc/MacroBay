import type { MacroCalendarProviderId } from './macroCalendarContracts'
import type { MacroCalendarEvidenceAppendInput, MacroCalendarEvidenceReference } from './macroCalendarEvidenceStore'
import type { MacroCalendarHttpResult } from './macroCalendarHttpClient'
import { getMacroCalendarOfficialSourceDescriptor, type MacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'
import type { MacroCalendarProviderProfileStore } from './macroCalendarProviderProfileStore'
import type { MacroCalendarEvidenceReservation } from './macroCalendarEvidenceArchive'
import { macroCalendarTransportPolicy } from './macroCalendarPolicy'

export type MacroCalendarCollectionInput = {
  descriptorId: string
  runId: string
  detectedAt: string
  signal?: AbortSignal
}

export type MacroCalendarCollectionResult =
  | { descriptorId: string; state: 'skipped'; failureCode: 'descriptor-not-found' }
  | { providerId: MacroCalendarProviderId; descriptorId: string; state: 'skipped'; failureCode: 'provider-disabled' }
  | { descriptorId: string; state: 'failed'; failureCode: 'collection-input-invalid' }
  | { providerId: MacroCalendarProviderId; descriptorId: string; state: 'failed'; failureCode: Extract<MacroCalendarHttpResult, { ok: false }>['failureCode'] | 'profile-read-failed' | 'http-request-failed' | 'response-descriptor-mismatch' | 'evidence-persist-failed'; status?: number }
  | { providerId: MacroCalendarProviderId; descriptorId: string; state: 'persisted'; status: number; acceptedBytes: number; evidence: Pick<MacroCalendarEvidenceReference, 'rawRecordId' | 'evidenceHash' | 'inserted' | 'deduped'> }

export type MacroCalendarCollectionService = {
  collectDescriptor: (input: MacroCalendarCollectionInput) => Promise<MacroCalendarCollectionResult>
}

type MacroCalendarEvidenceWriter = {
  reserve: (maximumBytes: number) => MacroCalendarEvidenceReservation | undefined
  release: (reservation: MacroCalendarEvidenceReservation) => boolean
  append: (input: MacroCalendarEvidenceAppendInput, reservation: MacroCalendarEvidenceReservation) => MacroCalendarEvidenceReference | undefined | Promise<MacroCalendarEvidenceReference | undefined>
}

export function createMacroCalendarCollectionService(deps: {
  profiles: Pick<MacroCalendarProviderProfileStore, 'list'>
  http: { request: (descriptor: MacroCalendarOfficialSourceDescriptor, runAt: string, signal?: AbortSignal) => Promise<MacroCalendarHttpResult> }
  evidence: MacroCalendarEvidenceWriter
}): MacroCalendarCollectionService {
  return {
    async collectDescriptor(input) {
      if (!isValidInput(input)) return { descriptorId: safeDescriptorId(input), state: 'failed', failureCode: 'collection-input-invalid' }
      const descriptor = getMacroCalendarOfficialSourceDescriptor(input.descriptorId)
      if (!descriptor) return { descriptorId: input.descriptorId, state: 'skipped', failureCode: 'descriptor-not-found' }
      let enabled: boolean
      try {
        enabled = (await deps.profiles.list()).some((profile) => profile.providerId === descriptor.providerId && profile.enabled)
      } catch {
        return { providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, state: 'failed', failureCode: 'profile-read-failed' }
      }
      if (!enabled) return { providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, state: 'skipped', failureCode: 'provider-disabled' }

      const reservation = deps.evidence.reserve(macroCalendarTransportPolicy.responseAcceptedMaxBytes)
      if (!reservation) return evidenceFailure(descriptor)

      try {
        let response: MacroCalendarHttpResult
        try {
          response = await deps.http.request(descriptor, input.detectedAt, input.signal)
        } catch {
          return { providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, state: 'failed', failureCode: 'http-request-failed' }
        }
        if (!response.ok) return httpFailure(descriptor, response)
        if (response.descriptorId !== descriptor.descriptorId) return { providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, state: 'failed', failureCode: 'response-descriptor-mismatch' }

        const evidence = await deps.evidence.append({
          descriptor,
          sourceUrl: descriptor.sourceUrl,
          detectedAt: input.detectedAt,
          body: response.body,
          payloadFormat: descriptor.payloadFormat,
          runId: input.runId,
          parserVersion: descriptor.parserId,
          response: { status: response.status, contentType: response.contentType }
        }, reservation)
        if (!evidence) return evidenceFailure(descriptor)
        return {
          providerId: descriptor.providerId,
          descriptorId: descriptor.descriptorId,
          state: 'persisted',
          status: response.status,
          acceptedBytes: response.acceptedBytes,
          evidence: {
            rawRecordId: evidence.rawRecordId,
            evidenceHash: evidence.evidenceHash,
            inserted: evidence.inserted,
            deduped: evidence.deduped
          }
        }
      } catch {
        return evidenceFailure(descriptor)
      } finally {
        deps.evidence.release(reservation)
      }
    }
  }
}

function isValidInput(input: MacroCalendarCollectionInput): boolean {
  return Boolean(input && typeof input === 'object') && typeof input.descriptorId === 'string' &&
    typeof input.runId === 'string' && input.runId.trim().length > 0 && isCanonicalUtcMillis(input.detectedAt)
}

function isCanonicalUtcMillis(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function safeDescriptorId(input: MacroCalendarCollectionInput): string {
  return typeof input?.descriptorId === 'string' ? input.descriptorId : 'unknown-descriptor'
}

function httpFailure(
  descriptor: MacroCalendarOfficialSourceDescriptor,
  response: Extract<MacroCalendarHttpResult, { ok: false }>
): MacroCalendarCollectionResult {
  return {
    providerId: descriptor.providerId,
    descriptorId: descriptor.descriptorId,
    state: 'failed',
    failureCode: response.failureCode,
    ...(response.status === undefined ? {} : { status: response.status })
  }
}

function evidenceFailure(descriptor: MacroCalendarOfficialSourceDescriptor): MacroCalendarCollectionResult {
  return { providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, state: 'failed', failureCode: 'evidence-persist-failed' }
}
