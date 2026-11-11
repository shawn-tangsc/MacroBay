/**
 * 「这一行没存上」的记录：**模块级、只在渲染层内存、不落持久化**。
 *
 * 为什么要活到比一次挂载更久：抽屉离开这一屏就卸载，失败提示若只活在组件 state 里，
 * 读者关掉再回来就看不到「刚才没存上」了。保存栏又没有「取消」，读者反悔只能关抽屉——
 * 所以这条提示必须一直跟着那一行，直到写成功，或平台读回的值等于当时想写的值。
 *
 * 键是行/事件 id；一个 id 只记一个「当时想写的值」。
 */
const failedWrites = new Map<string, { readonly desired: boolean }>()

/** 记下这一次没存上（值 = 读者当时想写的那个）。 */
export function markWriteFailed(eventId: string, desired: boolean): void {
  failedWrites.set(eventId, { desired })
}

/** 清掉一行：只在写成功、或平台值已经等于想写的值时调用。 */
export function clearWriteFailure(eventId: string): void {
  failedWrites.delete(eventId)
}

/** 清空整张表：域被重置时用（正常 API，不是测试后门）。 */
export function clearAllWriteFailures(): void {
  failedWrites.clear()
}

/** 当前哪些行还挂着失败（顺序按写入先后，仅供渲染与判断）。 */
export function failedWriteIds(): readonly string[] {
  return [...failedWrites.keys()]
}

/** 这一行当时想写的值；没失败过就是 `undefined`。 */
export function failedWriteDesired(eventId: string): boolean | undefined {
  return failedWrites.get(eventId)?.desired
}
