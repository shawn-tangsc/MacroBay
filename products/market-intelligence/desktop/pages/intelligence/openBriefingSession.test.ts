import { describe, expect, it, vi } from 'vitest'

import { openBriefingSession } from './openBriefingSession'

/**
 * E9 的点击行为只有两条：
 * 1. 选中那条会话，切到智能体对话页；
 * 2. 选中被拒（会话已经不在了）→ 返回 false、**不跳转**——行上就地一句，读者不会落进一个空页面。
 */
describe('opening a briefing edition session', () => {
  it('selects the session, then moves to the agent page', async () => {
    const selectSession = vi.fn(async () => ({ activeSessionId: 'session-1' }))
    const navigate = vi.fn()

    await expect(openBriefingSession({ sessionId: 'session-1', selectSession, navigate })).resolves.toBe(true)
    expect(selectSession).toHaveBeenCalledWith('session-1')
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('treats "selected nothing" as gone, not as success — the store returns the old state instead of throwing', async () => {
    // 真路径：`selectSession` 对不存在的 id **返回原状态、不抛**（agentStore.ts:152-154）。
    // 只看有没有抛，就会把读者导航进一个没选中任何会话的页面。
    const selectSession = vi.fn(async () => ({ activeSessionId: 'some-other-session' }))
    const navigate = vi.fn()
    await expect(openBriefingSession({ sessionId: 'session-gone', selectSession, navigate })).resolves.toBe(false)
    expect(navigate).not.toHaveBeenCalled()

    // 状态都没有（空/null/读不出形状）：也算没打开，不许导航。
    for (const returned of [undefined, null, {}, { activeSessionId: null }]) {
      const again = vi.fn(async () => returned)
      const navigateAgain = vi.fn()
      await expect(openBriefingSession({ sessionId: 'session-gone', selectSession: again, navigate: navigateAgain })).resolves.toBe(false)
      expect(navigateAgain).not.toHaveBeenCalled()
    }
  })

  it('reports a session that is gone when the call itself fails', async () => {
    const selectSession = vi.fn(async () => { throw new Error('session-not-found') })
    const navigate = vi.fn()

    await expect(openBriefingSession({ sessionId: 'session-gone', selectSession, navigate })).resolves.toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })
})
