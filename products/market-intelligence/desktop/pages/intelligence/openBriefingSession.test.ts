import { describe, expect, it, vi } from 'vitest'

import { openBriefingSession } from './openBriefingSession'

/**
 * E9 的点击行为只有两条：
 * 1. 选中那条会话，切到智能体对话页；
 * 2. 选中被拒（会话已经不在了）→ 返回 false、**不跳转**——行上就地一句，读者不会落进一个空页面。
 */
describe('opening a briefing edition session', () => {
  it('selects the session, then moves to the agent page', async () => {
    const selectSession = vi.fn(async () => ({}))
    const navigate = vi.fn()

    await expect(openBriefingSession({ sessionId: 'session-1', selectSession, navigate })).resolves.toBe(true)
    expect(selectSession).toHaveBeenCalledWith('session-1')
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('reports a session that is gone, and does not navigate', async () => {
    const selectSession = vi.fn(async () => { throw new Error('session-not-found') })
    const navigate = vi.fn()

    await expect(openBriefingSession({ sessionId: 'session-gone', selectSession, navigate })).resolves.toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })
})
