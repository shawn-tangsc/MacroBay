import { describe, expect, it } from 'vitest'

import { sourcesPanelState } from './DashboardSourcesPanel'

/**
 * 抽屉「来源」那一屏的四态判据。扁平源行退役时，这是从它那里**挪过来**的两条老规矩：
 *
 * 1. **读不到 ≠ 没有**：没有视图又带着错误码是错误态（要能重试），不是空态；
 * 2. **还没读到 ≠ 没有**：视图还没到、也没报错时是加载态——画成空列表，读者会以为一个源都没配。
 */
const view = (providerCounts: readonly number[]): { groups: readonly { providers: readonly unknown[] }[] } => ({
  groups: providerCounts.map((count) => ({ providers: Array.from({ length: count }, () => ({})) }))
})

describe('the drawer sources panel state', () => {
  it('says "could not read" when the read failed, not "nothing there"', () => {
    expect(sourcesPanelState({ errorCode: 'unreadable', loading: false, view: undefined })).toBe('error')
  })

  it('says "loading" while the first read is in flight, not "nothing there"', () => {
    // 空数组的 `every` 恒真：这里若返回 empty，加载中的抽屉就会写「没有源」。
    expect(sourcesPanelState({ errorCode: null, loading: true, view: undefined })).toBe('loading')
    expect(sourcesPanelState({ errorCode: null, loading: false, view: undefined })).toBe('loading')
  })

  it('says "nothing there" only when the view arrived without a single provider', () => {
    expect(sourcesPanelState({ errorCode: null, loading: false, view: view([]) })).toBe('empty')
    expect(sourcesPanelState({ errorCode: null, loading: false, view: view([0, 0]) })).toBe('empty')
  })

  it('is ready when any provider is there, whatever the groups look like', () => {
    expect(sourcesPanelState({ errorCode: null, loading: false, view: view([0, 1]) })).toBe('ready')
    expect(sourcesPanelState({ errorCode: null, loading: false, view: view([3]) })).toBe('ready')
  })
})
