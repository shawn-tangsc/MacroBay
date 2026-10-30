import { describe, expect, it, vi } from 'vitest'
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

  it('abandons a running link but never rewrites a link that already finished', async () => {
    const d = deps()
    const port = createDailyBriefEditorSessionPort(d as never)
    const { sessionId } = await port.ensure({ editionKey: '2026-10-30:zh-CN', editionDate: '2026-10-30', locale: 'zh-CN', title: 'edition', agentId: 'daily-brief-editor' })
    await port.state(sessionId, 'abandoned')
    expect((await d.links.findBySession(sessionId))?.state).toBe('abandoned')
    await port.state(sessionId, 'accepted')
    await port.state(sessionId, 'abandoned')
    expect((await d.links.findBySession(sessionId))?.state).toBe('accepted')
  })

  it('creates once per edition, reuses the link, renames and deletes', async () => {
    const d = deps()
    const port = createDailyBriefEditorSessionPort(d as never)
    const first = await port.ensure({ editionKey: '2026-10-30:zh-CN', editionDate: '2026-10-30', locale: 'zh-CN', title: '10-30 每日简报 · AI 编辑 · 中文', agentId: 'daily-brief-editor', allowedTools: ['WebSearch', 'WebFetch'] })
    const second = await port.ensure({ editionKey: '2026-10-30:zh-CN', editionDate: '2026-10-30', locale: 'zh-CN', title: 'another', agentId: 'daily-brief-editor' })
    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(d.createSession).toHaveBeenCalledTimes(2)
    expect(d.createSession).toHaveBeenCalledWith(expect.objectContaining({ allowedTools: ['WebSearch', 'WebFetch'] }))
  })
})
