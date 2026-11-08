import type { JobRunRecord } from '../../jobs/contracts/jobTypes'

/**
 * 「同一个任务」在**通知**眼里的稳定身份。
 *
 * 为什么不能一律用 `definitionId`：一次性作业（`enqueueDefinition`，例如产品流水线里逐批
 * 触发的那些 handler）**每次注册的 id 都带时间戳与随机后缀**，一个 handler 一天就是几百个
 * definitionId。拿它当身份，读者会被刷屏（一次失败一条），而
 * 「连续 3 次才升级」永远到不了阈值——每次都是新任务。
 *
 * 两条规则：
 * - **周期定义**（`trigger.kind !== 'manual'`）→ `definition:<definitionId>`。周期定义的 id 由
 *   规矩要求稳定，按定义区分正好是「同一个任务」；
 * - **一次性作业**（`trigger.kind === 'manual'`）→ `handler:<handlerId>[:<sourceId>]`。同一次
 *   流水线用同一个 handler 按来源分批跑，`sourceId` 就是它自带的分批维度：同一来源连续失败
 *   该累积到阈值，不同来源各自计数、不互相顶掉。
 *
 * 身份只用于**去重与计数**，不用于展示：标题仍取可读任务名，点开仍落到具体那一条运行。
 */
export function jobFailureIdentityOf(run: JobRunRecord): string {
  if (run.trigger.kind !== 'manual') return `definition:${run.definitionId}`
  const sourceId = sourceIdOf(run)
  return sourceId === undefined ? `handler:${run.handlerId}` : `handler:${run.handlerId}:${sourceId}`
}

/** 一次性作业的分批维度；没有就不带（不要用 `'global'` 这种字面量冒充一个来源）。 */
function sourceIdOf(run: JobRunRecord): string | undefined {
  const payload = run.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const value = (payload as Record<string, unknown>).sourceId
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}
