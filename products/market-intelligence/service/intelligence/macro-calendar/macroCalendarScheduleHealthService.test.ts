import { describe, expect, it, vi } from 'vitest'

import { getMacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'
import { createMacroCalendarScheduleHealthService } from './macroCalendarScheduleHealthService'

const detectedAt = '2026-08-04T00:00:00.000Z'
const fed = getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-schedule')!
const bea = getMacroCalendarOfficialSourceDescriptor('macro-calendar-bea-schedule')!

describe('macroCalendarScheduleHealthService', () => {
  it.each([fed, bea])('writes one healthy revision for a persisted schedule workflow result and preserves the signal', async (descriptor) => {
    const service = createService({ descriptor })
    const controller = new AbortController()

    await expect(service.service.collectAndUpdateHealth({ descriptorId: descriptor.descriptorId, runId: 'schedule-run', detectedAt, signal: controller.signal })).resolves.toEqual({
      providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, state: 'updated', healthStatus: 'healthy', consecutiveFailures: 0
    })
    expect(service.workflow).toHaveBeenCalledOnce()
    expect(service.workflow).toHaveBeenCalledWith({ descriptorId: descriptor.descriptorId, runId: 'schedule-run', detectedAt, signal: controller.signal })
    expect(service.append).toHaveBeenCalledWith({
      providerId: descriptor.providerId, status: 'healthy', updatedAt: detectedAt, lastSuccessAt: detectedAt,
      consecutiveFailures: 0, checkpoint: { parserVersion: descriptor.parserId }
    })
  })

  it('maps only provider-disabled to paused, increments a valid prior failure count, and resets it after success', async () => {
    const paused = createService({ workflowResult: { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'skipped', failureCode: 'provider-disabled' }, previousFailures: 2 })
    const failed = createService({ workflowResult: { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'network-request-failed' }, previousFailures: 2 })
    const recovered = createService({ previousFailures: 3 })

    await expect(paused.service.collectAndUpdateHealth(input(fed))).resolves.toEqual({ providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'updated', healthStatus: 'paused', consecutiveFailures: 2 })
    await expect(failed.service.collectAndUpdateHealth(input(fed))).resolves.toEqual({ providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'updated', healthStatus: 'failed', consecutiveFailures: 3 })
    await expect(recovered.service.collectAndUpdateHealth(input(fed))).resolves.toEqual({ providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'updated', healthStatus: 'healthy', consecutiveFailures: 0 })
    expect(paused.append).toHaveBeenCalledWith({ providerId: fed.providerId, status: 'paused', updatedAt: detectedAt, consecutiveFailures: 2, checkpoint: { parserVersion: fed.parserId } })
    expect(failed.append).toHaveBeenCalledWith({ providerId: fed.providerId, status: 'failed', updatedAt: detectedAt, lastFailureAt: detectedAt, consecutiveFailures: 3, checkpoint: { parserVersion: fed.parserId } })
  })

  it('starts failed health at one from an unsafe prior count and accepts a P3G collection-result-invalid failure', async () => {
    const service = createService({
      workflowResult: { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'collection-result-invalid' },
      previousFailures: Number.MAX_SAFE_INTEGER
    })

    await expect(service.service.collectAndUpdateHealth(input(fed))).resolves.toEqual({
      providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'updated', healthStatus: 'failed', consecutiveFailures: 1
    })
    expect(service.append).toHaveBeenCalledWith({
      providerId: fed.providerId, status: 'failed', updatedAt: detectedAt, lastFailureAt: detectedAt,
      consecutiveFailures: 1, checkpoint: { parserVersion: fed.parserId }
    })
  })

  it('records a safe final persistence failure as failed health', async () => {
    const service = createService({
      workflowResult: { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'repository-write-failed', insertedCount: 1 },
      previousFailures: 2
    })

    await expect(service.service.collectAndUpdateHealth(input(fed))).resolves.toEqual({
      providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'updated', healthStatus: 'failed', consecutiveFailures: 3
    })
    expect(service.append).toHaveBeenCalledWith({
      providerId: fed.providerId, status: 'failed', updatedAt: detectedAt, lastFailureAt: detectedAt,
      consecutiveFailures: 3, checkpoint: { parserVersion: fed.parserId }
    })
  })

  it.each([
    { descriptorId: 'unknown' },
    { descriptorId: 'macro-calendar-bls-values' },
    { descriptorId: fed.descriptorId, runId: '  ' },
    { descriptorId: fed.descriptorId, detectedAt: '2026-08-04T00:00:00Z' },
    { descriptorId: fed.descriptorId, workflowResult: null },
    { descriptorId: fed.descriptorId, workflowResult: { providerId: bea.providerId, descriptorId: fed.descriptorId, state: 'persisted', status: 200, acceptedBytes: 0, insertedCount: 1, dedupedCount: 0 } },
    { descriptorId: fed.descriptorId, workflowResult: { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'skipped', failureCode: 'descriptor-not-found' } }
  ])('does not write health for invalid input, unavailable descriptors, or untrusted workflow output', async ({ descriptorId, runId = 'schedule-run', detectedAt: runDetectedAt = detectedAt, workflowResult }) => {
    const service = createService({ workflowResult })

    const result = await service.service.collectAndUpdateHealth({ descriptorId, runId, detectedAt: runDetectedAt })

    expect(result.state).not.toBe('updated')
    expect(service.append).not.toHaveBeenCalled()
    if (runId === '  ' || runDetectedAt !== detectedAt || descriptorId === 'unknown' || descriptorId === 'macro-calendar-bls-values') expect(service.workflow).not.toHaveBeenCalled()
  })

  it('redacts a throwing health append without retrying', async () => {
    const service = createService({ appendError: new Error('https://secret.example.test/?credential=raw body') })

    const result = await service.service.collectAndUpdateHealth(input(fed))

    expect(result).toEqual({ providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'health-persist-failed' })
    expect(JSON.stringify(result)).not.toMatch(/https?:|credential|body/i)
    expect(service.append).toHaveBeenCalledOnce()
  })

  it('redacts a throwing prior-health read without attempting an append', async () => {
    const service = createService({
      workflowResult: { providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'network-request-failed' },
      getCurrentError: new Error('https://secret.example.test/?credential=raw body')
    })

    const result = await service.service.collectAndUpdateHealth({
      descriptorId: fed.descriptorId,
      runId: 'schedule-run',
      detectedAt
    })

    expect(result).toEqual({ providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'health-persist-failed' })
    expect(JSON.stringify(result)).not.toMatch(/https?:|credential|body/i)
    expect(service.append).not.toHaveBeenCalled()
  })

  it('redacts a throwing workflow without health append', async () => {
    const service = createService({ workflowError: new Error('https://secret.example.test/?credential=raw body') })

    const result = await service.service.collectAndUpdateHealth(input(fed))

    expect(result).toEqual({ providerId: fed.providerId, descriptorId: fed.descriptorId, state: 'failed', failureCode: 'workflow-execution-failed' })
    expect(JSON.stringify(result)).not.toMatch(/https?:|credential|body/i)
    expect(service.append).not.toHaveBeenCalled()
  })
})

function input(descriptor: typeof fed) {
  return { descriptorId: descriptor.descriptorId, runId: 'schedule-run', detectedAt }
}

function persisted(descriptor: typeof fed | typeof bea) {
  return { providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, state: 'persisted' as const, status: 200, acceptedBytes: 0, insertedCount: 1, dedupedCount: 0 }
}

function createService(options: { descriptor?: typeof fed | typeof bea; workflowResult?: unknown; previousFailures?: number; appendError?: Error; getCurrentError?: Error; workflowError?: Error } = {}) {
  const descriptor = options.descriptor ?? fed
  const workflow = vi.fn(async () => { if (options.workflowError) throw options.workflowError; return Object.hasOwn(options, 'workflowResult') ? options.workflowResult : persisted(descriptor) })
  const append = vi.fn(() => { if (options.appendError) throw options.appendError })
  const getCurrent = vi.fn(() => {
    if (options.getCurrentError) throw options.getCurrentError
    return options.previousFailures === undefined ? undefined : {
    providerId: descriptor.providerId, status: 'failed' as const, updatedAt: '2026-08-03T00:00:00.000Z', consecutiveFailures: options.previousFailures, checkpoint: {}
    }
  })
  return {
    service: createMacroCalendarScheduleHealthService({ workflow: { collectAndPersistSchedule: workflow }, health: { getCurrent, appendMaterialChange: append } }),
    workflow,
    append,
    getCurrent
  }
}
