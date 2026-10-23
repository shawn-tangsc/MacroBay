import { describe, expect, it, vi } from 'vitest'

import { getMacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'
import { createMacroCalendarScheduleCollectionWorkflow } from './macroCalendarScheduleCollectionWorkflow'

const detectedAt = '2026-08-04T00:00:00.000Z'
const fed = getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-schedule')!
const bea = getMacroCalendarOfficialSourceDescriptor('macro-calendar-bea-schedule')!
const bls = getMacroCalendarOfficialSourceDescriptor('macro-calendar-bls-values')!
const fedStatementHistory = getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-statement-history')!

describe('macroCalendarScheduleCollectionWorkflow', () => {
  it.each([fed, bea])('collects and persists the eligible fixed %s descriptor once with the original signal', async (descriptor) => {
    const workflow = createWorkflow({ descriptor })
    const controller = new AbortController()

    await expect(workflow.service.collectAndPersistSchedule({ descriptorId: descriptor.descriptorId, runId: 'schedule-run', detectedAt, signal: controller.signal })).resolves.toEqual({
      providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, state: 'persisted', status: 200, acceptedBytes: 123, insertedCount: 4, dedupedCount: 0
    })
    expect(workflow.collectDescriptor).toHaveBeenCalledTimes(1)
    expect(workflow.collectDescriptor).toHaveBeenCalledWith({ descriptorId: descriptor.descriptorId, runId: 'schedule-run', detectedAt, signal: controller.signal })
    expect(workflow.persistScheduleEvidence).toHaveBeenCalledOnce()
    expect(workflow.persistScheduleEvidence).toHaveBeenCalledWith('raw-1')
  })

  it.each([
    { descriptorId: 'unknown', expected: { descriptorId: 'unknown', state: 'skipped', failureCode: 'descriptor-not-found' } },
    { descriptorId: bls.descriptorId, expected: { providerId: bls.providerId, descriptorId: bls.descriptorId, state: 'skipped', failureCode: 'schedule-descriptor-unavailable' } },
    { descriptorId: fedStatementHistory.descriptorId, expected: { providerId: fedStatementHistory.providerId, descriptorId: fedStatementHistory.descriptorId, state: 'skipped', failureCode: 'schedule-descriptor-unavailable' } },
    { descriptorId: fed.descriptorId, runId: '  ', expected: { descriptorId: fed.descriptorId, state: 'failed', failureCode: 'collection-input-invalid' } },
    { descriptorId: fed.descriptorId, detectedAt: '2026-08-04T00:00:00Z', expected: { descriptorId: fed.descriptorId, state: 'failed', failureCode: 'collection-input-invalid' } }
  ])('makes zero dependency calls for unavailable or invalid input', async ({ descriptorId, runId = 'schedule-run', detectedAt: inputDetectedAt = detectedAt, expected }) => {
    const workflow = createWorkflow()

    await expect(workflow.service.collectAndPersistSchedule({ descriptorId, runId, detectedAt: inputDetectedAt })).resolves.toMatchObject(expected)
    expect(workflow.collectDescriptor).not.toHaveBeenCalled()
    expect(workflow.persistScheduleEvidence).not.toHaveBeenCalled()
  })

  it('fails closed when collection returns a malformed runtime result', async () => {
    const workflow = createWorkflow({ collectionResult: null })

    await expect(workflow.service.collectAndPersistSchedule(input(fed))).resolves.toEqual({
      providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'collection-result-invalid'
    })
    expect(workflow.persistScheduleEvidence).not.toHaveBeenCalled()
  })

  it('stops after a collection skipped or failed result without persistence', async () => {
    const skipped = createWorkflow({ collectionResult: { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'skipped', failureCode: 'provider-disabled' } })
    const failed = createWorkflow({ collectionResult: { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'http-response-not-success', status: 404 } })

    await expect(skipped.service.collectAndPersistSchedule(input(fed))).resolves.toEqual({ providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'skipped', failureCode: 'provider-disabled' })
    await expect(failed.service.collectAndPersistSchedule(input(fed))).resolves.toEqual({ providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'http-response-not-success', status: 404 })
    expect(skipped.persistScheduleEvidence).not.toHaveBeenCalled()
    expect(failed.persistScheduleEvidence).not.toHaveBeenCalled()
  })

  it('redacts extra fields from an otherwise valid skipped collection result', async () => {
    const workflow = createWorkflow({ collectionResult: {
      providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'skipped', failureCode: 'provider-disabled',
      sourceUrl: 'https://official.example.test/schedule', body: 'raw body', credential: 'secret'
    } })

    await expect(workflow.service.collectAndPersistSchedule(input(fed))).resolves.toEqual({
      providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'skipped', failureCode: 'provider-disabled'
    })
    expect(workflow.persistScheduleEvidence).not.toHaveBeenCalled()
  })

  it.each([
    { failureCode: 'profile-read-failed', status: 200 },
    { failureCode: 'redirect-rejected', status: 200 },
    { failureCode: 'http-response-not-success', status: 200 }
  ])('rejects a failed collection result with an incoherent HTTP status', async ({ failureCode, status }) => {
    const workflow = createWorkflow({ collectionResult: {
      providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode, status
    } })

    await expect(workflow.service.collectAndPersistSchedule(input(fed))).resolves.toEqual({
      providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'collection-result-invalid'
    })
    expect(workflow.persistScheduleEvidence).not.toHaveBeenCalled()
  })

  it.each([
    { failureCode: 'redirect-rejected', status: 307 },
    { failureCode: 'http-response-not-success', status: 404 }
  ])('returns a valid HTTP failure in compact redacted form', async ({ failureCode, status }) => {
    const workflow = createWorkflow({ collectionResult: {
      providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode, status,
      sourceUrl: 'https://official.example.test/schedule', body: 'raw body', credential: 'secret'
    } })

    const result = await workflow.service.collectAndPersistSchedule(input(fed))

    expect(result).toEqual({ providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode, status })
    expect(JSON.stringify(result)).not.toMatch(/https?:|body|credential/i)
    expect(workflow.persistScheduleEvidence).not.toHaveBeenCalled()
  })

  it.each([
    { providerId: bea.providerId, descriptorId: fed.descriptorId, state: 'skipped', failureCode: 'provider-disabled' },
    { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'skipped', failureCode: 'unexpected-skip' },
    { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'skipped', failureCode: 'provider-disabled', status: 200 },
    { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'unexpected-failure' },
    { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'http-response-not-success', status: 404.5 },
    { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'unknown', failureCode: 'provider-disabled' }
  ])('fails closed for an incoherent non-persisted collection result', async (collectionResult) => {
    const workflow = createWorkflow({ collectionResult })

    await expect(workflow.service.collectAndPersistSchedule(input(fed))).resolves.toEqual({
      providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'collection-result-invalid'
    })
    expect(workflow.persistScheduleEvidence).not.toHaveBeenCalled()
  })

  it.each([
    { providerId: bea.providerId }, { descriptorId: bea.descriptorId }, { status: 299.5 }, { status: 404 }, { acceptedBytes: -1 }, { acceptedBytes: Number.POSITIVE_INFINITY },
    { evidence: undefined },
    { evidence: { rawRecordId: ' ', evidenceHash: 'evidence-hash', inserted: true, deduped: false } },
    { evidence: { rawRecordId: 'raw-1', evidenceHash: ' ', inserted: true, deduped: false } }
  ])('rejects an incoherent successful collection result before persistence', async (patch) => {
    const workflow = createWorkflow({ collectionResult: { ...successfulCollection(fed), ...patch } })

    await expect(workflow.service.collectAndPersistSchedule(input(fed))).resolves.toEqual({
      providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'collection-result-invalid'
    })
    expect(workflow.persistScheduleEvidence).not.toHaveBeenCalled()
  })

  it.each([0.5, Number.NaN, Number.POSITIVE_INFINITY, -1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an unsafe successful accepted byte count of %s before persistence',
    async (acceptedBytes) => {
      const workflow = createWorkflow({ collectionResult: { ...successfulCollection(fed), acceptedBytes } })

      await expect(workflow.service.collectAndPersistSchedule(input(fed))).resolves.toEqual({
        providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'collection-result-invalid'
      })
      expect(workflow.persistScheduleEvidence).not.toHaveBeenCalled()
    }
  )

  it('returns a redacted persistence failure with its partial inserted count', async () => {
    const workflow = createWorkflow({ persistenceResult: { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'repository-write-failed', insertedCount: 2 } })

    const result = await workflow.service.collectAndPersistSchedule(input(fed))

    expect(result).toEqual({ providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'repository-write-failed', insertedCount: 2 })
    expect(JSON.stringify(result)).not.toMatch(/raw-1|evidence-hash|https?:|body|credential/i)
  })
})

function input(descriptor: typeof fed) {
  return { descriptorId: descriptor.descriptorId, runId: 'schedule-run', detectedAt }
}

function successfulCollection(descriptor: typeof fed | typeof bea) {
  return {
    providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, state: 'persisted' as const,
    status: 200, acceptedBytes: 123, evidence: { rawRecordId: 'raw-1', evidenceHash: 'evidence-hash', inserted: true, deduped: false }
  }
}

function createWorkflow(options: { descriptor?: typeof fed | typeof bea; collectionResult?: unknown; persistenceResult?: unknown } = {}) {
  const descriptor = options.descriptor ?? fed
  const collectDescriptor = vi.fn(async () => Object.hasOwn(options, 'collectionResult') ? options.collectionResult : successfulCollection(descriptor))
  const persistScheduleEvidence = vi.fn(() => options.persistenceResult ?? {
    providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, state: 'persisted' as const, insertedCount: 4, dedupedCount: 0
  })
  return {
    service: createMacroCalendarScheduleCollectionWorkflow({ collection: { collectDescriptor }, persistence: { persistScheduleEvidence } }),
    collectDescriptor,
    persistScheduleEvidence
  }
}
