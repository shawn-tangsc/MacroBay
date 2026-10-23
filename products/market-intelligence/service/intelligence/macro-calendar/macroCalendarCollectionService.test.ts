import { describe, expect, it, vi } from 'vitest'

import { createMacroCalendarCollectionService } from './macroCalendarCollectionService'
import { getMacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'

const detectedAt = '2026-08-04T00:00:00.000Z'
const fedSchedule = getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-schedule')!
const blsValues = getMacroCalendarOfficialSourceDescriptor('macro-calendar-bls-values')!

describe('macroCalendarCollectionService', () => {
  it('denies evidence-producing collection before HTTP when archive admission is unavailable', async () => {
    const collection = createService({ evidenceReserve: () => undefined })

    await expect(collection.service.collectDescriptor({ descriptorId: fedSchedule.descriptorId, runId: 'run-1', detectedAt })).resolves.toMatchObject({
      state: 'failed', failureCode: 'evidence-persist-failed'
    })
    expect(collection.evidenceReserve).toHaveBeenCalledOnce()
    expect(collection.httpRequest).not.toHaveBeenCalled()
    expect(collection.evidenceAppend).not.toHaveBeenCalled()
  })

  it('makes no HTTP or evidence calls for unknown and disabled selections', async () => {
    const unknown = createService()
    await expect(unknown.service.collectDescriptor({ descriptorId: 'unknown-descriptor', runId: 'run-1', detectedAt })).resolves.toMatchObject({
      state: 'skipped', failureCode: 'descriptor-not-found'
    })
    expect(unknown.httpRequest).not.toHaveBeenCalled()
    expect(unknown.evidenceAppend).not.toHaveBeenCalled()

    const disabled = createService({ enabledProviderIds: [] })
    await expect(disabled.service.collectDescriptor({ descriptorId: fedSchedule.descriptorId, runId: 'run-1', detectedAt })).resolves.toMatchObject({
      providerId: fedSchedule.providerId, descriptorId: fedSchedule.descriptorId, state: 'skipped', failureCode: 'provider-disabled'
    })
    expect(disabled.httpRequest).not.toHaveBeenCalled()
    expect(disabled.evidenceAppend).not.toHaveBeenCalled()
  })

  it.each([
    { runId: '   ', detectedAt },
    { runId: 'run-1', detectedAt: '2026-08-04T00:00:00Z' },
    { runId: 'run-1', detectedAt: '2026-02-29T00:00:00.000Z' }
  ])('rejects invalid input before profiles, HTTP, or evidence', async (input) => {
    const collection = createService()

    const result = await collection.service.collectDescriptor({ descriptorId: fedSchedule.descriptorId, ...input })

    expect(result).toMatchObject({ descriptorId: fedSchedule.descriptorId, state: 'failed', failureCode: 'collection-input-invalid' })
    expect(collection.profileList).not.toHaveBeenCalled()
    expect(collection.httpRequest).not.toHaveBeenCalled()
    expect(collection.evidenceAppend).not.toHaveBeenCalled()
  })

  it('contains profile and HTTP exceptions without downstream calls or exception details', async () => {
    const profileFailure = createService({ profileError: new Error('https://example.test/?secret=profile-secret') })
    const profileResult = await profileFailure.service.collectDescriptor({ descriptorId: fedSchedule.descriptorId, runId: 'run-1', detectedAt })
    expect(profileResult).toMatchObject({ state: 'failed', failureCode: 'profile-read-failed' })
    expect(JSON.stringify(profileResult)).not.toContain('profile-secret')
    expect(profileFailure.httpRequest).not.toHaveBeenCalled()
    expect(profileFailure.evidenceAppend).not.toHaveBeenCalled()

    const httpFailure = createService({ httpError: new Error('https://example.test/?secret=http-secret') })
    const httpResult = await httpFailure.service.collectDescriptor({ descriptorId: fedSchedule.descriptorId, runId: 'run-1', detectedAt })
    expect(httpResult).toMatchObject({ state: 'failed', failureCode: 'http-request-failed' })
    expect(JSON.stringify(httpResult)).not.toContain('http-secret')
    expect(httpFailure.evidenceAppend).not.toHaveBeenCalled()
  })

  it('requests exactly the selected fixed descriptor and preserves the parent signal', async () => {
    const selection = createService({ httpResult: { ok: false, descriptorId: fedSchedule.descriptorId, failureCode: 'http-response-not-success', status: 404 } })
    const controller = new AbortController()

    await expect(selection.service.collectDescriptor({ descriptorId: fedSchedule.descriptorId, runId: 'run-1', detectedAt, signal: controller.signal })).resolves.toMatchObject({
      providerId: fedSchedule.providerId, descriptorId: fedSchedule.descriptorId, state: 'failed', failureCode: 'http-response-not-success', status: 404
    })
    expect(selection.httpRequest).toHaveBeenCalledTimes(1)
    expect(selection.httpRequest).toHaveBeenCalledWith(fedSchedule, detectedAt, controller.signal)
    expect(selection.evidenceAppend).not.toHaveBeenCalled()
  })

  it('persists an enabled response before returning a redacted success result', async () => {
    let persisted = false
    const collection = createService({
      body: 'BLS caf\u00e9 body',
      descriptorId: blsValues.descriptorId,
      evidenceAppend: async (input) => {
        persisted = true
        expect(input).toMatchObject({
          descriptor: blsValues, sourceUrl: blsValues.sourceUrl, payloadFormat: 'json',
          body: 'BLS caf\u00e9 body', runId: 'bls-run', detectedAt, parserVersion: blsValues.parserId,
          response: { status: 200, contentType: 'application/json' }
        })
        return reference({ inserted: true, deduped: false })
      }
    })

    const result = await collection.service.collectDescriptor({ descriptorId: blsValues.descriptorId, runId: 'bls-run', detectedAt })

    expect(persisted).toBe(true)
    expect(collection.httpRequest).toHaveBeenCalledWith(blsValues, detectedAt, undefined)
    expect(result).toEqual({
      providerId: blsValues.providerId, descriptorId: blsValues.descriptorId, state: 'persisted',
      status: 200, acceptedBytes: Buffer.byteLength('BLS caf\u00e9 body', 'utf8'),
      evidence: { rawRecordId: 'raw-1', evidenceHash: 'evidence-hash', inserted: true, deduped: false }
    })
    expect(JSON.stringify(result)).not.toContain('BLS caf')
    expect(JSON.stringify(result)).not.toContain(blsValues.sourceUrl)
    expect(JSON.stringify(result)).not.toContain('application/json')
  })

  it('does not append evidence after a safe HTTP failure', async () => {
    const collection = createService({
      descriptorId: fedSchedule.descriptorId,
      httpResult: { ok: false, descriptorId: fedSchedule.descriptorId, failureCode: 'http-response-not-success' }
    })

    await expect(collection.service.collectDescriptor({ descriptorId: fedSchedule.descriptorId, runId: 'fed-run', detectedAt })).resolves.toMatchObject({
      providerId: fedSchedule.providerId, descriptorId: fedSchedule.descriptorId, state: 'failed', failureCode: 'http-response-not-success'
    })
    expect(collection.evidenceAppend).not.toHaveBeenCalled()
  })

  it('rejects a successful HTTP response for a different descriptor before persistence', async () => {
    const collection = createService({
      httpResult: {
        ok: true, descriptorId: blsValues.descriptorId, status: 200,
        acceptedBytes: 1, body: 'x', contentType: 'application/json'
      }
    })

    await expect(collection.service.collectDescriptor({ descriptorId: fedSchedule.descriptorId, runId: 'run-1', detectedAt })).resolves.toMatchObject({
      providerId: fedSchedule.providerId, descriptorId: fedSchedule.descriptorId,
      state: 'failed', failureCode: 'response-descriptor-mismatch'
    })
    expect(collection.evidenceAppend).not.toHaveBeenCalled()
  })

  it('returns evidence persistence failure instead of collection success', async () => {
    const collection = createService({ evidenceAppend: () => undefined })

    await expect(collection.service.collectDescriptor({ descriptorId: fedSchedule.descriptorId, runId: 'run-1', detectedAt })).resolves.toMatchObject({
      providerId: fedSchedule.providerId, descriptorId: fedSchedule.descriptorId, state: 'failed', failureCode: 'evidence-persist-failed'
    })
  })

  it('returns deduped evidence as a persisted result', async () => {
    const collection = createService({ evidenceAppend: () => reference({ inserted: false, deduped: true }) })

    await expect(collection.service.collectDescriptor({ descriptorId: fedSchedule.descriptorId, runId: 'run-1', detectedAt })).resolves.toMatchObject({
      state: 'persisted', evidence: { rawRecordId: 'raw-1', evidenceHash: 'evidence-hash', inserted: false, deduped: true }
    })
  })
})

function createService(options: {
  enabledProviderIds?: string[]
  descriptorId?: string
  body?: string
  httpResult?: unknown
  profileError?: Error
  httpError?: Error
  evidenceAppend?: (input: Record<string, unknown>) => unknown
  evidenceReserve?: (maximumBytes: number) => unknown
} = {}) {
  const enabledProviderIds = options.enabledProviderIds ?? ['macro-calendar-fed', 'macro-calendar-bls', 'macro-calendar-bea']
  const descriptor = getMacroCalendarOfficialSourceDescriptor(options.descriptorId ?? fedSchedule.descriptorId)!
  const body = options.body ?? 'official response body'
  const profileList = vi.fn(async () => {
    if (options.profileError) throw options.profileError
    return enabledProviderIds.map((providerId) => ({ providerId, enabled: true, updatedAt: detectedAt }))
  })
  const httpRequest = vi.fn(async () => {
    if (options.httpError) throw options.httpError
    return options.httpResult ?? {
    ok: true, descriptorId: descriptor.descriptorId, status: 200,
    acceptedBytes: Buffer.byteLength(body, 'utf8'), body, contentType: 'application/json'
    }
  })
  const evidenceAppend = vi.fn(options.evidenceAppend ?? (() => reference({ inserted: true, deduped: false })))
  const evidenceReserve = vi.fn(options.evidenceReserve ?? (() => Object.freeze({})))
  const evidenceRelease = vi.fn(() => true)
  return {
    service: createMacroCalendarCollectionService({
      profiles: { list: profileList },
      http: { request: httpRequest },
      evidence: { reserve: evidenceReserve, release: evidenceRelease, append: evidenceAppend } as never
    }),
    profileList,
    httpRequest,
    evidenceAppend,
    evidenceReserve,
    evidenceRelease
  }
}

function reference(overrides: { inserted: boolean; deduped: boolean }) {
  return {
    rawRecordId: 'raw-1', providerId: 'macro-calendar-fed' as const, descriptorId: fedSchedule.descriptorId,
    sourceUrl: fedSchedule.sourceUrl, evidenceHash: 'evidence-hash', detectedAt,
    parserVersion: fedSchedule.parserId, ...overrides
  }
}
