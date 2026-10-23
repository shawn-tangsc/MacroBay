import { describe, expect, it } from 'vitest'

import { createDeliveryId, createEventId, resetEventBusIdCountersForTests } from './eventBusContracts'
import { EventBusValidationError, validatePublishEventInput } from './eventBusValidation'

describe('event bus contracts', () => {
  it('rejects oversized payloads and unsafe metadata', () => {
    expect(() =>
      validatePublishEventInput({
        topic: 'product.sample.created',
        producer: { owner: 'product', productId: 'sample-product' },
        schemaVersion: 1,
        payload: { blob: 'x'.repeat(300_000) }
      })
    ).toThrow(EventBusValidationError)

    const validated = validatePublishEventInput({
      topic: 'product.sample.created',
      producer: { owner: 'product', productId: 'sample-product' },
      schemaVersion: 1,
      payload: { value: 1 },
      safeMetadata: { apiKey: 'secret' }
    })
    expect(validated.safeMetadata).toEqual({ redacted: true })
  })

  it('requires productId for product producers', () => {
    expect(() =>
      validatePublishEventInput({
        topic: 'product.sample.created',
        producer: { owner: 'product' },
        schemaVersion: 1,
        payload: {}
      })
    ).toThrow('productId')
  })
})

describe('event bus id generation', () => {
  it('creates stable sequential ids in tests', () => {
    resetEventBusIdCountersForTests(0, 0)
    expect(createEventId()).toBe('evt-1')
    expect(createDeliveryId()).toBe('dlv-1')
  })
})
