/**
 * 期次编号的**唯一生成处**（用户 2026-11-14 报的「有标题、点进去却空」）。
 *
 * 手动生成那条路径自己造过一个裸 UUID（`crypto.randomUUID()`），定时与补录走的是
 * `period_${uuid}`。列表能显示那一行，详情按「那一期」查时对不上，于是落到空态，还写了
 * 「这一期没有生成」——把「查不到」说成了「没生成」。
 *
 * 格式只有一处定义，两边都用它：谁再造一个编号，就必须先改这里。
 */
export const briefingPeriodIdPrefix = 'period_'

export function createBriefingPeriodId(newUuid: () => string = () => globalThis.crypto.randomUUID()): string {
  return `${briefingPeriodIdPrefix}${newUuid()}`
}

/** 一个期次编号是不是这个格式（测试与诊断用；业务判据不该靠它认人）。 */
export function isBriefingPeriodId(value: string): boolean {
  return value.startsWith(briefingPeriodIdPrefix) && value.length > briefingPeriodIdPrefix.length
}
