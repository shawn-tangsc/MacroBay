import { describe, expect, it } from 'vitest'

import { REDACTED_CURSOR_PREVIEW } from '../contracts/runtimeStateTypes'
import { createRuntimeStateStore } from './runtimeStateStore'

describe('runtimeStateStore', () => {
  it('upserts checkpoint by owner and resource id', () => {
    const store = createRuntimeStateStore()

    store.upsert({
      owner: 'product',
      productId: 'demo-product',
      resourceId: 'source-a',
      checkpoint: { page: 1 }
    })

    const updated = store.upsert({
      owner: 'product',
      productId: 'demo-product',
      resourceId: 'source-a',
      checkpoint: { page: 2 }
    })

    expect(updated.checkpoint).toEqual({ page: 2 })
    expect(store.list()).toHaveLength(1)
  })

  it('redacts cursor preview values', () => {
    const store = createRuntimeStateStore({
      cursorRedactPatterns: [/token=[^&]+/gi]
    })

    const record = store.upsert({
      owner: 'product',
      productId: 'demo-product',
      resourceId: 'source-b',
      cursorPreview: 'https://example.test?token=secret-value&page=2'
    })

    expect(record.cursorPreview).toContain(REDACTED_CURSOR_PREVIEW)
    expect(record.cursorPreview).not.toContain('secret-value')
  })

  it('records last success and failure timestamps', () => {
    const store = createRuntimeStateStore()

    const failed = store.recordFailure('product', 'demo-product', 'source-c', 'cursor-1')
    expect(failed.lastFailureAt).toBeTruthy()
    expect(failed.consecutiveFailures).toBe(1)

    const succeeded = store.recordSuccess('product', 'demo-product', 'source-c', { page: 3 }, 'cursor-2')
    expect(succeeded.lastSuccessAt).toBeTruthy()
    expect(succeeded.lastFailureAt).toBeTruthy()
  })

  it('resets consecutive failure count after success', () => {
    const store = createRuntimeStateStore()

    store.recordFailure('product', 'demo-product', 'source-d')
    store.recordFailure('product', 'demo-product', 'source-d')

    const success = store.recordSuccess('product', 'demo-product', 'source-d')
    expect(success.consecutiveFailures).toBe(0)
  })
})
