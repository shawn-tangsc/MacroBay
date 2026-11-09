import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERIOD_ID } from '../../../contracts/dailyBriefing'
import { createDailyBriefSessionLinkStore } from './dailyBriefSessionLinks'
import { claimExistingBriefingSessions, createDailyBriefEditorSessionPort } from './dailyBriefEditorSessionPort'

type FakeSession = { id: string; agentId: string; name: string; createdAt?: string; origin?: string; originGroup?: string; originRef?: string; messages?: unknown[] }

const deps = () => {
  const sessions = new Map<string, FakeSession>()
  const createSession = vi.fn(async (input: { agentId: string; name: string; origin?: string; originGroup?: string; originRef?: string }) => {
    const session: FakeSession = { id: `s-${sessions.size + 1}-${input.name}`, agentId: input.agentId, name: input.name }
    if (input.origin !== undefined) session.origin = input.origin
    if (input.originGroup !== undefined) session.originGroup = input.originGroup
    if (input.originRef !== undefined) session.originRef = input.originRef
    sessions.set(session.id, session)
    return session
  })
  const findAgentSessionByAutomationRef = vi.fn(async (agentId: string, originRef: string) => {
    for (const session of sessions.values()) {
      if (session.agentId === agentId && session.originRef === originRef) return session
    }
    return null
  })
  const updateAgentSession = vi.fn(async (id: string, patch: { origin?: string; originGroup?: string; originRef?: string }) => {
    const session = sessions.get(id)
    if (!session) throw new Error(`session not found: ${id}`)
    Object.assign(session, patch)
    return session
  })
  const update = vi.fn(async (id: string, patch: { name?: string }) => ({ id, name: patch.name ?? id }))
  const append = vi.fn(async () => [])
  return {
    links: createDailyBriefSessionLinkStore(':memory:'),
    createSession,
    findAgentSessionByAutomationRef,
    updateAgentSession,
    update,
    append,
    sessions,
    send: vi.fn(async () => ({ ok: true })),
    delete: vi.fn(async () => undefined),
    now: () => '2026-10-30T00:00:00.000Z'
  }
}

const edition = (locale: 'zh-CN' | 'en-US' = 'zh-CN', periodId = DEFAULT_PERIOD_ID) => ({ editionDate: '2026-10-30', periodId, locale, title: 'edition', agentId: 'daily-brief-editor' })

describe('daily brief editor session port', () => {
  it('forwards cancel to the platform runtime session', async () => {
    const d = deps()
    const cancelAgentSession = vi.fn(async () => undefined)
    const port = createDailyBriefEditorSessionPort({ ...d, cancelAgentSession } as never)
    await port.cancel('s-1')
    expect(cancelAgentSession).toHaveBeenCalledWith('s-1')
  })

  it('treats cancel as a no-op when no cancel entry is wired', async () => {
    const port = createDailyBriefEditorSessionPort(deps() as never)
    await expect(port.cancel('s-1')).resolves.toBeUndefined()
  })

  it('keeps the first terminal state and ignores every later outcome', async () => {
    const d = deps()
    const port = createDailyBriefEditorSessionPort(d as never)

    const first = await port.ensure(edition())
    await port.state(first.sessionId, 'abandoned')
    await port.state(first.sessionId, 'accepted')
    await port.state(first.sessionId, 'failed')
    expect((await d.links.findBySession(first.sessionId))?.state).toBe('abandoned')

    const second = await port.ensure(edition('en-US'))
    await port.state(second.sessionId, 'accepted')
    await port.state(second.sessionId, 'abandoned')
    expect((await d.links.findBySession(second.sessionId))?.state).toBe('accepted')
  })

  it('creates one session per edition, marks it as automation, and reuses it on the next generation', async () => {
    // 缺陷原样：以前每次生成都新建一条，侧栏「对话」里一天几条、累积 28 条。一期只承认一条。
    const d = deps()
    const port = createDailyBriefEditorSessionPort(d as never)
    const first = await port.ensure({ ...edition(), title: '10-30 每日简报 · AI 编辑 · 中文', allowedTools: ['WebSearch', 'WebFetch'] })
    const second = await port.ensure({ ...edition(), title: '10-30 每日简报 · AI 编辑 · 中文' })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.sessionId).toBe(first.sessionId)
    expect(d.createSession).toHaveBeenCalledTimes(1)
    // 身份三件套与市场分析同一口径：分块、归组、幂等键都在创建时写进去，读者列表里不再出现。
    expect(d.createSession).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'automation',
      originGroup: 'daily-briefing',
      originRef: `daily-brief:2026-10-30:${DEFAULT_PERIOD_ID}:zh-CN`,
      allowedTools: ['WebSearch', 'WebFetch']
    }))
    // 另一期照常新建；同一期另一语言也是一条独立会话。
    const otherEdition = await port.ensure({ ...edition('zh-CN'), editionDate: '2026-10-31', title: '10-31' })
    const otherLocale = await port.ensure({ ...edition('en-US'), title: '10-30 EN' })
    expect(otherEdition.created).toBe(true)
    expect(otherLocale.created).toBe(true)
    expect(d.createSession).toHaveBeenCalledTimes(3)
  })

  it('takes the attempt ordinal from the store that owns it, and invents none without one', async () => {
    const allocateAttempt = vi.fn(async () => 2)
    const d = { ...deps(), allocateAttempt }
    const port = createDailyBriefEditorSessionPort(d as never)
    const created = await port.ensure({ ...edition(), title: 'edition' })
    expect(allocateAttempt).toHaveBeenCalledWith({ editionDate: '2026-10-30', periodId: DEFAULT_PERIOD_ID, locale: 'zh-CN' })
    expect((await d.links.findBySession(created.sessionId))?.attemptNo).toBe(2)
    expect(d.createSession).toHaveBeenCalledWith(expect.objectContaining({ name: 'edition · 2' }))

    const bare = deps()
    const unwired = await createDailyBriefEditorSessionPort(bare as never).ensure({ ...edition(), title: 'edition' })
    expect((await bare.links.findBySession(unwired.sessionId))?.attemptNo).toBeUndefined()
    expect(bare.createSession).toHaveBeenCalledWith(expect.objectContaining({ name: 'edition' }))
  })
})

describe('claiming the briefing sessions that were created without an identity', () => {
  it('marks them as automation, keeps one canonical per edition, and changes no content', async () => {
    const d = deps()
    const readerSession = (id: string, name: string, createdAt = '2026-11-09T00:00:00.000Z') => ({
      id,
      agentId: 'daily-brief-editor',
      name,
      createdAt,
      // 正文/消息属于内容：迁移一个字节都不许动，这里拿它们当快照。
      messages: [{
        id: `m-${id}`,
        role: 'assistant' as const,
        data: { parts: [{ type: 'text' as const, text: `正文 ${name}` }] },
        searchableText: `正文 ${name}`,
        status: 'success' as const,
        modelId: null,
        modelSnapshot: null,
        stats: null,
        runtimeResumeToken: null,
        createdAt,
        updatedAt: createdAt
      }]
    })
    const older = readerSession('s-old-1', '11-09 每日简报 · AI 编辑 · 中文')
    const newer = readerSession('s-new-2', '11-09 每日简报 · AI 编辑 · 中文')
    const middle = readerSession('s-mid-3', '11-09 每日简报 · AI 编辑 · 中文')
    const otherEdition = readerSession('s-10th', '11-10 每日简报 · AI 编辑 · 中文')
    const englishEdition = readerSession('s-en', '11-09 Daily brief · AI editor · English')
    for (const session of [older, newer, middle, otherEdition, englishEdition]) {
      d.sessions.set(session.id, session as never)
    }

    const put = async (sessionId: string, at: string) => {
      await d.links.put({ editionDate: '2026-11-09', periodId: DEFAULT_PERIOD_ID, locale: 'zh-CN', sessionId, state: 'running', createdAt: at, updatedAt: at })
    }
    await put(older.id, '2026-11-08T23:00:00.000Z')
    await put(middle.id, '2026-11-09T08:44:00.000Z')
    await put(newer.id, '2026-11-09T17:02:00.000Z')
    await d.links.put({ editionDate: '2026-11-09', periodId: DEFAULT_PERIOD_ID, locale: 'en-US', sessionId: englishEdition.id, state: 'running', createdAt: '2026-11-09T09:00:00.000Z', updatedAt: '2026-11-09T09:00:00.000Z' })
    await d.links.put({ editionDate: '2026-11-10', periodId: DEFAULT_PERIOD_ID, locale: 'zh-CN', sessionId: otherEdition.id, state: 'running', createdAt: '2026-11-10T05:00:00.000Z', updatedAt: '2026-11-10T05:00:00.000Z' })

    // 迁移前快照：内容字段原样记下来，迁移后逐字比对。
    // 读者列表的判据就是面板用的那条：origin !== 'automation'。迁移前这一期有三条混在里面。
    const readerVisibleBefore = [...d.sessions.values()]
      .filter(session => (session.origin ?? 'reader') !== 'automation' && session.name.includes('11-09'))
    expect(readerVisibleBefore).toHaveLength(4) // 中文 3 条 + 英文 1 条，都混在读者列表里

    const before = new Map([...d.sessions.entries()].map(([id, session]) => [id, JSON.stringify(session)]))
    const countBefore = d.sessions.size

    const result = await claimExistingBriefingSessions({
      links: d.links,
      agentId: 'daily-brief-editor',
      findAgentSessionByAutomationRef: d.findAgentSessionByAutomationRef,
      updateAgentSession: d.updateAgentSession as never
    })

    expect(result.updated).toBe(5)
    // 1) 同一期只剩一条正式身份，取**最新**那次生成（读者现在打开的就是它的内容）。
    const edition23 = `daily-brief:2026-11-09:${DEFAULT_PERIOD_ID}:zh-CN`
    expect(d.sessions.get('s-new-2')?.originRef).toBe(edition23)
    expect(d.sessions.get('s-mid-3')?.originRef).toBe(`${edition23}#history:s-mid-3`)
    expect(d.sessions.get('s-old-1')?.originRef).toBe(`${edition23}#history:s-old-1`)
    expect(d.sessions.get('s-10th')?.originRef).toBe(`daily-brief:2026-11-10:${DEFAULT_PERIOD_ID}:zh-CN`)
    // 身份是「期 × 语言」：同一期中文、英文各一条，互不顶替。
    expect(d.sessions.get('s-en')?.originRef).toBe(`daily-brief:2026-11-09:${DEFAULT_PERIOD_ID}:en-US`)
    for (const id of ['s-old-1', 's-new-2', 's-mid-3', 's-10th', 's-en']) {
      expect(d.sessions.get(id)?.origin).toBe('automation')
      expect(d.sessions.get(id)?.originGroup).toBe('daily-briefing')
    }
    // 2) 内容逐字不变（名字、正文、消息、时间戳都在快照里）。
    for (const [id, snapshot] of before) {
      const current = JSON.parse(JSON.stringify(d.sessions.get(id)))
      const expected = JSON.parse(snapshot)
      // 只允许身份字段不同。
      for (const key of ['origin', 'originGroup', 'originRef']) delete current[key]
      expect(current).toEqual(expected)
    }
    // 3) 行数不变；消息表没动（fake 里的 messages 属于会话内容，上面已逐字比对）。
    expect(d.sessions.size).toBe(countBefore)

    // 4) 读者列表（面板的过滤条件：origin !== 'automation'）里，这一期**一条都不再出现**。
    expect([...d.sessions.values()]
      .filter(session => (session.origin ?? 'reader') !== 'automation' && session.name.includes('11-09'))).toHaveLength(0)

    // 断言 1：这一期在「身份」上只出现一次——按正式身份查恰好一条，且迁移前后行数不变。
    expect([...d.sessions.values()].filter(session => session.originRef === edition23)).toHaveLength(1)
    // 断言 3：消息表一行没动（行数与内容都逐字相等）。
    const messageTable = () => JSON.stringify([...d.sessions.values()].map(session => session.messages))
    expect(messageTable()).toBe(JSON.stringify([...before.values()].map(snapshot => JSON.parse(snapshot).messages)))

    // 断言 4：后缀幂等——第二次迁移不许把同一条再套一层 `#history:`。
        // 幂等：再跑一次不再改任何行，而且每一行的内容**逐字不变**（不是只看 updated 计数）。
    const afterFirstRun = new Map([...d.sessions.entries()].map(([id, session]) => [id, JSON.stringify(session)]))
    const again = await claimExistingBriefingSessions({
      links: d.links,
      agentId: 'daily-brief-editor',
      findAgentSessionByAutomationRef: d.findAgentSessionByAutomationRef,
      updateAgentSession: d.updateAgentSession as never
    })
    expect(again.updated).toBe(0)
    expect(d.updateAgentSession).toHaveBeenCalledTimes(5)
    const afterSecondRun = new Map([...d.sessions.entries()].map(([id, session]) => [id, JSON.stringify(session)]))
    expect(afterSecondRun).toEqual(afterFirstRun)
    for (const session of d.sessions.values()) {
      expect(session.originRef ?? '').not.toMatch(/#history:.*#history:/u)
    }

    // 断言 6（反向）：正式身份必须是**最近**一次生成。换成「最早」或「任意一次」都必须红。
    expect(d.sessions.get('s-new-2')?.originRef).toBe(edition23)
    expect(d.sessions.get('s-old-1')?.originRef).not.toBe(edition23)
    const canonicalId = [...d.sessions.entries()]
      .find(([, session]) => session.originRef === edition23)?.[0]
    expect(canonicalId).toBe('s-new-2')

    // 断言 5（可见性看字段不看字符串）：把历史身份的前缀换成任意别的值，读者列表结果不变——
    // 因为「不进读者列表」是由 `origin = 'automation'` 这个真实字段决定的。
    for (const session of d.sessions.values()) {
      if (session.originRef?.includes('#history:')) session.originRef = session.originRef.replace('#history:', 'legacy:')
    }
    expect([...d.sessions.values()]
      .filter(session => (session.origin ?? 'reader') !== 'automation' && session.name.includes('11-09'))).toHaveLength(0)
  })
})
