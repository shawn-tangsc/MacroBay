import { describe, expect, it } from 'vitest'

import { beginRefresh, failRefresh, initialAsyncState, settle, type AsyncState } from './asyncState'

/**
 * 转移函数的判据只有一句话：**任何一次刷新都不许把已经看到的数据删掉**。
 * 下面每条用例都围着它——`error` 只在「从来没有数据」时出现。
 */
describe('AsyncState transitions', () => {
  it('starts in loading, the only legal initial value', () => {
    expect(initialAsyncState<number[]>()).toEqual({ status: 'loading' })
  })

  it('keeps data through a refresh and marks it as refreshing', () => {
    const ready: AsyncState<number[]> = { status: 'ready', data: [1, 2] }

    expect(beginRefresh(ready)).toEqual({ status: 'ready', data: [1, 2], refreshing: true })
  })

  it('keeps data when a refresh fails, and says it is stale instead of blanking the screen', () => {
    const refreshed = beginRefresh<number[]>({ status: 'ready', data: [1, 2], stale: true })

    expect(failRefresh(refreshed, 'unreadable')).toEqual({ status: 'ready', data: [1, 2], stale: true })
  })

  it('falls back to error only when there was never any data to keep', () => {
    expect(failRefresh(initialAsyncState<number[]>(), 'unreadable')).toEqual({
      status: 'error',
      reasonCode: 'unreadable'
    })
    expect(failRefresh<number[]>({ status: 'error', reasonCode: 'unavailable' }, 'unreadable')).toEqual({
      status: 'error',
      reasonCode: 'unreadable'
    })
  })

  it('clears both flags when a read settles', () => {
    const stale: AsyncState<number[]> = { status: 'ready', data: [1], refreshing: true, stale: true }

    expect(settle(stale, [3])).toEqual({ status: 'ready', data: [3] })
  })

  it('never lets a loading state carry data', () => {
    // @ts-expect-error `data` 只挂在 `ready` 上：能写出「加载中且带数据」，就有人会写。
    const impossible: AsyncState<number[]> = { status: 'loading', data: [1] }

    expect(impossible).toBeDefined()
  })
})
