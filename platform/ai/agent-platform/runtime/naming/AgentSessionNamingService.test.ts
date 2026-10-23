import { describe, expect, it, vi } from 'vitest'

import { AgentSessionNamingService } from './AgentSessionNamingService'

describe('AgentSessionNamingService', () => {
  it('skips rename when naming preference is disabled', async () => {
    const generateTitle = vi.fn()
    const renameSession = vi.fn()
    const service = new AgentSessionNamingService({
      isEnabled: () => false,
      getLanguage: () => 'en-US',
      generateTitle,
      renameSession
    })

    const result = await service.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: 'New agent session',
      userText: 'Review this PR',
      assistantText: 'Looks good',
      modelId: 'openai:gpt-4o-mini'
    })

    expect(result).toEqual({ renamed: false, reason: 'disabled' })
    expect(generateTitle).not.toHaveBeenCalled()
    expect(renameSession).not.toHaveBeenCalled()
  })

  it('skips rename when the session name is no longer a default title', async () => {
    const generateTitle = vi.fn()
    const renameSession = vi.fn()
    const service = new AgentSessionNamingService({
      isEnabled: () => true,
      getLanguage: () => 'en-US',
      generateTitle,
      renameSession
    })

    const result = await service.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: 'Manually named session',
      userText: 'Review this PR',
      assistantText: 'Looks good',
      modelId: 'openai:gpt-4o-mini'
    })

    expect(result).toEqual({ renamed: false, reason: 'manual-name' })
    expect(generateTitle).not.toHaveBeenCalled()
  })

  it('skips rename when no model id is available', async () => {
    const generateTitle = vi.fn()
    const service = new AgentSessionNamingService({
      isEnabled: () => true,
      getLanguage: () => 'zh-CN',
      generateTitle,
      renameSession: vi.fn()
    })

    const result = await service.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: '新的智能体会话',
      userText: '帮我看一下这个 PR',
      assistantText: '可以',
      modelId: null
    })

    expect(result).toEqual({ renamed: false, reason: 'missing-model' })
    expect(generateTitle).not.toHaveBeenCalled()
  })

  it('renames with a cleaned model title on the first successful turn', async () => {
    const renameSession = vi.fn(async () => {})
    const generateTitle = vi.fn(async () => '"PR Risk Review"\n')
    const service = new AgentSessionNamingService({
      isEnabled: () => true,
      getLanguage: () => 'en-US',
      generateTitle,
      renameSession
    })

    const result = await service.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: 'New agent session',
      userText: 'Please review this pull request',
      assistantText: 'I found two risks.',
      modelId: 'openai:gpt-4o-mini'
    })

    expect(result).toEqual({ renamed: true, title: 'PR Risk Review' })
    expect(generateTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'openai:gpt-4o-mini',
        conversation: expect.stringContaining('Please review this pull request')
      })
    )
    expect(renameSession).toHaveBeenCalledWith('session-1', 'PR Risk Review')
  })

  it('returns empty-title when the model yields no usable title', async () => {
    const renameSession = vi.fn()
    const service = new AgentSessionNamingService({
      isEnabled: () => true,
      getLanguage: () => 'en-US',
      generateTitle: async () => '   ',
      renameSession
    })

    const result = await service.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: 'Session',
      userText: 'Hello',
      assistantText: 'Hi',
      modelId: 'openai:gpt-4o-mini'
    })

    expect(result).toEqual({ renamed: false, reason: 'empty-title' })
    expect(renameSession).not.toHaveBeenCalled()
  })

  it('locks concurrent renames for the same session', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const renameSession = vi.fn(async () => {})
    const service = new AgentSessionNamingService({
      isEnabled: () => true,
      getLanguage: () => 'en-US',
      generateTitle: async () => {
        await gate
        return 'Locked Title'
      },
      renameSession
    })

    const first = service.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: 'New agent session',
      userText: 'One',
      assistantText: 'A',
      modelId: 'openai:gpt-4o-mini'
    })
    const second = await service.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: 'New agent session',
      userText: 'Two',
      assistantText: 'B',
      modelId: 'openai:gpt-4o-mini'
    })

    expect(second).toEqual({ renamed: false, reason: 'locked' })
    release()
    await expect(first).resolves.toEqual({ renamed: true, title: 'Locked Title' })
    expect(renameSession).toHaveBeenCalledTimes(1)
  })

  it('skips repeated naming within the named TTL window', async () => {
    let now = 1_000
    const service = new AgentSessionNamingService({
      isEnabled: () => true,
      getLanguage: () => 'en-US',
      generateTitle: async () => 'First Title',
      renameSession: async () => {},
      now: () => now,
      namedTtlMs: 60_000
    })

    await service.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: 'New agent session',
      userText: 'One',
      assistantText: 'A',
      modelId: 'openai:gpt-4o-mini'
    })

    now = 30_000
    const second = await service.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: 'New agent session',
      userText: 'Two',
      assistantText: 'B',
      modelId: 'openai:gpt-4o-mini'
    })

    expect(second).toEqual({ renamed: false, reason: 'already-named' })
  })

  it('returns error when generateTitle throws and does not rename', async () => {
    const renameSession = vi.fn()
    const service = new AgentSessionNamingService({
      isEnabled: () => true,
      getLanguage: () => 'en-US',
      generateTitle: async () => {
        throw new Error('provider down')
      },
      renameSession
    })

    const result = await service.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: 'New agent session',
      userText: 'Hello',
      assistantText: 'Hi',
      modelId: 'openai:gpt-4o-mini'
    })

    expect(result).toEqual({ renamed: false, reason: 'error' })
    expect(renameSession).not.toHaveBeenCalled()
  })

  it('uses the configured naming prompt language placeholder', async () => {
    const generateTitle = vi.fn(async () => '标题')
    const service = new AgentSessionNamingService({
      isEnabled: () => true,
      getLanguage: () => 'zh-CN',
      getNamingPrompt: () => 'Name in {{language}} only.',
      generateTitle,
      renameSession: async () => {}
    })

    await service.maybeRenameAfterTurn({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sessionName: '新的智能体会话',
      userText: '你好',
      assistantText: '你好',
      modelId: 'openai:gpt-4o-mini'
    })

    expect(generateTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'Name in zh-CN only.'
      })
    )
  })
})
