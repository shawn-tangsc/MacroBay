import type { JobRunOutcome } from './jobTypes'

/**
 * 运行结论的写入校验：**不合格直接拒写，不做兜底**。
 *
 * 为什么是抛错而不是「修一修再存」：`total = succeeded + failed + skipped` 不成立时，我们
 * 并不知道哪一格是错的。猜一个数填上去，等于把一次算错变成一条看起来正常的记录——明天做
 * 「按来源看成功率」的人会把它当真的算进去，而且永远查不出来。拒写至少会当场炸出一个栈。
 *
 * `reasonCode` 只收点分小写的枚举：自由文本无法聚合，一旦允许，「这个来源最近失败原因分布
 * 是什么」就永远算不出来。六句人话由产品文案表映射，平台不理解它的含义。
 */

export class JobRunOutcomeRejected extends Error {
  constructor(readonly code: 'counts-do-not-add-up' | 'count-not-an-integer' | 'reason-code-not-an-enum') {
    super(`job-run-outcome-rejected:${code}`)
    this.name = 'JobRunOutcomeRejected'
  }
}

/** 点分小写：`model.timeout`、`content.empty`、`model.not-configured`。 */
const REASON_CODE = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new JobRunOutcomeRejected('count-not-an-integer')
  void name
}

export function assertJobRunOutcome(outcome: JobRunOutcome): void {
  const { total, succeeded, failed, skipped } = outcome.counts
  assertCount('total', total)
  assertCount('succeeded', succeeded)
  assertCount('failed', failed)
  assertCount('skipped', skipped)

  if (succeeded + failed + skipped !== total) throw new JobRunOutcomeRejected('counts-do-not-add-up')

  if (outcome.reasonCode !== undefined && !REASON_CODE.test(outcome.reasonCode)) {
    // 这一条专治「把一句话塞进 code」：`'模型没配'`、`'timeout (30s)'` 都会被拒。
    throw new JobRunOutcomeRejected('reason-code-not-an-enum')
  }
}
