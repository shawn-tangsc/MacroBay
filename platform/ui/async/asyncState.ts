import type { ErrorReasonCode } from '@platform/contracts/queryOutcome'

/**
 * 一次读取的生命周期（契约：`docs/development/ui-state-components.md` 的 `AsyncState<T>` 一节）。
 *
 * 这个类型存在的理由只有一个：**「首帧画错误、再翻成数据」在类型上写不出来**。
 * `data` 只挂在 `ready` 上，`loading` 与 `error` 都是 `data?: never`，所以任何要用数据的边
 * 都必须先证明 `ready`。十四个模块各写一个三态联合，就是同一个 bug 回来十四次。
 *
 * 与 `QueryOutcome` 的关系：`AsyncState` 是**读取的生命周期**，`QueryOutcome` 是**数据层的终态结果**。
 * 一个包着另一个，不是同一件事的两套词。
 */
export type AsyncState<T> =
  | { status: 'loading'; data?: never }
  | { status: 'ready'; data: T; refreshing?: true; stale?: true }
  | { status: 'error'; reasonCode: ErrorReasonCode; data?: never }

/**
 * 唯一合法的初值：`loading`。
 *
 * 不写 `{ status: 'loading' }` 字面量而用工厂，是为了让守卫有东西可查——`useState` 的初值
 * 一旦是终态，页面就会先闪一下「读取失败」再翻成数据，而那句话在类型上完全合法。
 */
export function initialAsyncState<T>(): AsyncState<T> {
  return { status: 'loading' }
}

/**
 * 开始一次刷新：**保留旧数据**，只加 `refreshing`。
 *
 * 没有数据可保留时（还在首次加载或上次已失败）原样返回——刷新态不制造数据。
 */
export function beginRefresh<T>(prev: AsyncState<T>): AsyncState<T> {
  if (prev.status !== 'ready') return prev
  return { status: 'ready', data: prev.data, refreshing: true, ...(prev.stale === true ? { stale: true } : {}) }
}

/**
 * 刷新失败：**有旧数据就保留并标 `stale`**，没有才落到 `error`。
 *
 * 这是「刷新失败不许把已经看到的东西删掉」的唯一实现。调用点自己写
 * `setState({ status: 'error' })` 就是这条规矩落空的方式：读者手里的表突然变成一张错误页。
 */
export function failRefresh<T>(prev: AsyncState<T>, reasonCode: ErrorReasonCode): AsyncState<T> {
  if (prev.status === 'ready') {
    return { status: 'ready', data: prev.data, stale: true }
  }
  return { status: 'error', reasonCode }
}

/** 一次读取成功：数据落地，`refreshing` / `stale` 两个标记一起清掉。 */
export function settle<T>(_prev: AsyncState<T>, data: T): AsyncState<T> {
  return { status: 'ready', data }
}
