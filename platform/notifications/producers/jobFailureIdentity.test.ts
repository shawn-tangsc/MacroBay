import { describe, expect, it } from 'vitest'

import type { JobRunRecord } from '../../jobs/contracts/jobTypes'
import { jobFailureIdentityOf } from './jobFailureIdentity'

function run(overrides: Partial<JobRunRecord> = {}): JobRunRecord {
  return {
    id: 'run-1',
    definitionId: 'sample-product.syncItems:batch:1794052912321:jg9wly',
    handlerId: 'sample-product.syncItems',
    owner: 'product',
    productId: 'sample-product',
    title: 'Sentiment scoring',
    status: 'failed',
    trigger: { kind: 'manual' },
    payload: { sourceId: 'feed-a' },
    attempt: 1,
    maxAttempts: 1,
    createdAt: '2026-11-06T12:00:00.000Z',
    logs: [],
    ...overrides
  }
}

describe('job failure identity', () => {
  it('a one-shot job is identified by handler + source, not by its per-run definition id', () => {
    // 一次性作业每次注册的 definitionId 都带时间戳与随机后缀：拿它当身份会让同一件事每次都是新任务。
    const first = run({ definitionId: 'score:global:1794052912321:jg9wly' })
    const second = run({ definitionId: 'score:global:1794052955999:abcd12' })

    expect(jobFailureIdentityOf(first)).toBe('handler:sample-product.syncItems:feed-a')
    expect(jobFailureIdentityOf(second)).toBe(jobFailureIdentityOf(first))
  })

  it('不同来源各自独立，不互相顶掉', () => {
    expect(jobFailureIdentityOf(run({ payload: { sourceId: 'feed-a' } })))
      .not.toBe(jobFailureIdentityOf(run({ payload: { sourceId: 'other-source' } })))
  })

  it('没有分批维度的一次性作业退到 handler，而不是一个每次不同的 id', () => {
    expect(jobFailureIdentityOf(run({ payload: {} })))
      .toBe('handler:sample-product.syncItems')
    // `'global'` 这种字面量不当来源：它不是 reader 能理解的分批维度。
    expect(jobFailureIdentityOf(run({ payload: { sourceId: '   ' } })))
      .toBe('handler:sample-product.syncItems')
  })

  it('a scheduled definition is identified by its definition id, which the rules require to be stable', () => {
    expect(jobFailureIdentityOf(run({ trigger: { kind: 'interval', intervalMs: 300000, anchor: 'lastComplete' } })))
      .toBe('definition:sample-product.syncItems:batch:1794052912321:jg9wly')
    expect(jobFailureIdentityOf(run({ trigger: { kind: 'cron', expression: '0 9 * * *' } })))
      .toBe('definition:sample-product.syncItems:batch:1794052912321:jg9wly')
  })
})
