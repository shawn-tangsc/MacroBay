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
  constructor(
    readonly code:
      | 'counts-do-not-add-up'
      | 'count-not-an-integer'
      | 'reason-code-not-an-enum'
      | 'reasons-do-not-add-up'
      | 'reason-key-not-an-enum'
      | 'reasons-without-failures'
      | 'reason-code-not-in-reasons'
  ) {
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

  assertReasons(outcome)
}

/**
 * 失败**按原因**的分布。
 *
 * 与 `counts.failed` 是两层：那个是总数，这个是分布。校验四条：
 * 1. `failed === 0` 时**整个字段不许出现**——一张全零表会读成「测过、确实没有失败原因」，
 *    而事实是「没有失败」；两者混淆正是这个项目反复要挡的「拿不到写成没有」；
 * 2. 每个键必须过点分小写正则，和 `reasonCode` 同一条规则（`'超时'` 这种句子拒写）；
 * 3. 每个数必须是 ≥0 的整数；
 * 4. 加起来必须等于 `counts.failed`，否则 `reasonCode` 与分布会各说各话。
 *
 * 有 `reasonCode` 时它必须是这里的一个键：主因码不在分布里，等于给同一件事存了两个结论。
 */
function assertReasons(outcome: JobRunOutcome): void {
  const { reasons } = outcome
  if (reasons === undefined) return
  if (outcome.counts.failed === 0) throw new JobRunOutcomeRejected('reasons-without-failures')

  let sum = 0
  for (const [key, value] of Object.entries(reasons)) {
    if (!REASON_CODE.test(key)) throw new JobRunOutcomeRejected('reason-key-not-an-enum')
    assertCount(key, value)
    sum += value
  }
  if (sum !== outcome.counts.failed) throw new JobRunOutcomeRejected('reasons-do-not-add-up')
  if (outcome.reasonCode !== undefined && reasons[outcome.reasonCode] === undefined) {
    throw new JobRunOutcomeRejected('reason-code-not-in-reasons')
  }
}
