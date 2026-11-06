import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERIOD_ID } from '../../../contracts/dailyBriefing'
import { createDailyBriefSessionLinkStore } from './dailyBriefSessionLinks'
import { createDailyBriefEditorSessionPort } from './dailyBriefEditorSessionPort'

const deps = () => {
  const createSession = vi.fn(async (input: { agentId: string; name: string }) => ({ id: `s-${input.name}`, name: input.name, agentId: input.agentId }))
  const update = vi.fn(async (id: string, patch: { name?: string }) => ({ id, name: patch.name ?? id }))
  const append = vi.fn(async () => [])
  return {
    links: createDailyBriefSessionLinkStore(':memory:'),
    createSession,
    update,
    append,
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

  it('creates a session per attempt, links it to the edition tuple and passes the tools through', async () => {
    const d = deps()
    const port = createDailyBriefEditorSessionPort(d as never)
    const first = await port.ensure({ ...edition(), title: '10-30 每日简报 · AI 编辑 · 中文', allowedTools: ['WebSearch', 'WebFetch'] })
    const second = await port.ensure({ ...edition(), title: 'another' })
    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(d.createSession).toHaveBeenCalledTimes(2)
    expect(d.createSession).toHaveBeenCalledWith(expect.objectContaining({ allowedTools: ['WebSearch', 'WebFetch'] }))
    const stored = await d.links.listByEdition('2026-10-30', DEFAULT_PERIOD_ID, 'zh-CN')
    expect(stored).toHaveLength(2)
    expect(stored.every((row) => row.state === 'running')).toBe(true)
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
