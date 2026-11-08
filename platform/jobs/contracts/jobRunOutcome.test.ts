import { describe, expect, it } from 'vitest'

import { assertJobRunOutcome, JobRunOutcomeRejected } from './jobRunOutcome'

/**
 * 结论写入的两条反向用例是架构师点名要的：**合计不等拒写、自由文本 code 拒写**。
 * 正向那几条同样重要——它们说明「部分失败」是一个**算得出来的数**（`succeeded > 0 && failed > 0`），
 * 不是一句文案。
 */

const outcome = (counts: { total: number; succeeded: number; failed: number; skipped: number }, reasonCode?: string) => ({
  counts,
  ...(reasonCode === undefined ? {} : { reasonCode })
})

describe('运行结论校验', () => {
  it('全部成功、部分失败、整批跳过都是合法结论', () => {
    expect(() => assertJobRunOutcome(outcome({ total: 3, succeeded: 3, failed: 0, skipped: 0 }))).not.toThrow()
    expect(() => assertJobRunOutcome(outcome({ total: 3, succeeded: 2, failed: 1, skipped: 0 }))).not.toThrow()
    expect(() => assertJobRunOutcome(outcome({ total: 2, succeeded: 0, failed: 2, skipped: 0 }))).not.toThrow()
    // 自动翻译没开的那批：跳过 2 条，不是「成功 0 条」。
    expect(() => assertJobRunOutcome(outcome({ total: 2, succeeded: 0, failed: 0, skipped: 2 }))).not.toThrow()
  })

  it('反向：合计不等于总数必须拒写（不许猜哪一格错）', () => {
    expect(() => assertJobRunOutcome(outcome({ total: 3, succeeded: 1, failed: 1, skipped: 0 }))).toThrow(
      JobRunOutcomeRejected
    )
    expect(() => assertJobRunOutcome(outcome({ total: 3, succeeded: 1, failed: 1, skipped: 0 }))).toThrow(
      'counts-do-not-add-up'
    )
  })

  it('按原因拆开的分布：加起来等于 failed 才合法', () => {
    expect(() =>
      assertJobRunOutcome({
        counts: { total: 4, succeeded: 2, failed: 2, skipped: 0 },
        reasons: { 'model.timeout': 1, 'model.rate-limited': 1 }
      })
    ).not.toThrow()
    // 只写一类、但总数对不上：分布与总数各说各话，拒写。
    expect(() =>
      assertJobRunOutcome({
        counts: { total: 4, succeeded: 2, failed: 2, skipped: 0 },
        reasons: { 'model.timeout': 1 }
      })
    ).toThrow('reasons-do-not-add-up')
  })

  it('反向：把一句话当原因键必须拒写', () => {
    expect(() =>
      assertJobRunOutcome({
        counts: { total: 1, succeeded: 0, failed: 1, skipped: 0 },
        reasons: { 超时: 1 }
      })
    ).toThrow('reason-key-not-an-enum')
  })

  it('反向：一条没失败就不许出现分布，空表会被读成「测过、没有原因」', () => {
    const withoutReasons = { counts: { total: 3, succeeded: 3, failed: 0, skipped: 0 } }
    expect(() => assertJobRunOutcome(withoutReasons)).not.toThrow()
    expect('reasons' in withoutReasons).toBe(false)
    expect(() =>
      assertJobRunOutcome({
        counts: { total: 3, succeeded: 3, failed: 0, skipped: 0 },
        reasons: {}
      })
    ).toThrow('reasons-without-failures')
  })

  it('反向：主因码不在分布里必须拒写（同一件事不许两个结论）', () => {
    expect(() =>
      assertJobRunOutcome({
        counts: { total: 2, succeeded: 1, failed: 1, skipped: 0 },
        reasonCode: 'model.timeout',
        reasons: { 'model.rate-limited': 1 }
      })
    ).toThrow('reason-code-not-in-reasons')
  })

  it('反向：把一句话塞进 reasonCode 必须拒写', () => {
    expect(() => assertJobRunOutcome(outcome({ total: 1, succeeded: 0, failed: 1, skipped: 0 }, '模型没配'))).toThrow(
      'reason-code-not-an-enum'
    )
    expect(() =>
      assertJobRunOutcome(outcome({ total: 1, succeeded: 0, failed: 1, skipped: 0 }, 'timeout (30s)'))
    ).toThrow('reason-code-not-an-enum')
  })

  it('点分小写的枚举可以通过，平台不理解它的含义', () => {
    for (const code of ['model.timeout', 'model.not-configured', 'content.empty', 'language.unsupported']) {
      expect(() => assertJobRunOutcome(outcome({ total: 1, succeeded: 0, failed: 1, skipped: 0 }, code))).not.toThrow()
    }
  })

  it('负数与小数不是计数', () => {
    expect(() => assertJobRunOutcome(outcome({ total: -1, succeeded: -1, failed: 0, skipped: 0 }))).toThrow(
      'count-not-an-integer'
    )
    expect(() => assertJobRunOutcome(outcome({ total: 1.5, succeeded: 1.5, failed: 0, skipped: 0 }))).toThrow(
      'count-not-an-integer'
    )
  })
})

describe('结论写进存储', () => {
  it('内存 store 落得进去，读得出来；旧记录没有结论时是 undefined 而不是 0', async () => {
    const { createJobRunStore } = await import('../runtime/jobRunStore')
    const store = createJobRunStore()
    const run = store.createRun({
      definitionId: 'sample-product.syncItems.feed-a',
      handlerId: 'sample-product.syncItems',
      owner: 'product',
      productId: 'sample-product',
      title: '翻译任务',
      payload: {},
      trigger: { kind: 'manual' },
      maxAttempts: 1
    })

    // 没写过结论：保持缺省。把它当 0 会把「旧记录」算进成功率分母。
    expect(store.getRun(run.id)?.result).toBeUndefined()

    store.setResult(run.id, outcome({ total: 3, succeeded: 2, failed: 1, skipped: 0 }, 'model.timeout'))
    expect(store.getRun(run.id)?.result).toEqual({
      counts: { total: 3, succeeded: 2, failed: 1, skipped: 0 },
      reasonCode: 'model.timeout'
    })
  })

  it('反向：合计不等的结论连 store 都进不去', async () => {
    const { createJobRunStore } = await import('../runtime/jobRunStore')
    const store = createJobRunStore()
    const run = store.createRun({
      definitionId: 'd',
      handlerId: 'h',
      owner: 'platform',
      title: 't',
      payload: {},
      trigger: { kind: 'manual' },
      maxAttempts: 1
    })

    expect(() => store.setResult(run.id, outcome({ total: 3, succeeded: 1, failed: 1, skipped: 0 }))).toThrow(
      'counts-do-not-add-up'
    )
    expect(store.getRun(run.id)?.result).toBeUndefined()
  })
})
