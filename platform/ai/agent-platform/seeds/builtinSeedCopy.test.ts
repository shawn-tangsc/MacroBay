import { describe, expect, it } from 'vitest'

import { createAgentStoreState } from '../store/agentStore'
import { localizeBuiltinSeedCopy, type BuiltinSeedLanguageVariant } from './builtinSeedCopy'
import { createPlatformAgentSeed } from './defaultAgentSeed'

describe('localizeBuiltinSeedCopy', () => {
  it('switches untouched built-in agent and session copy to the current language', () => {
    const state = createAgentStoreState(createPlatformAgentSeed([], { locale: 'zh-CN' }))

    const localized = localizeBuiltinSeedCopy(state, 'en-US', variants())

    expect(localized.agents[0]).toMatchObject({
      id: 'default-assistant',
      name: 'Default Assistant',
      description: 'A general-purpose conversation and task assistant.'
    })
    expect(localized.agents[0]?.instructions).toContain('general desktop AI assistant')
    expect(localized.sessions[0]).toMatchObject({ id: 'default-assistant-session', name: 'New session' })
    expect(localized.sessions[0]?.description).toBe('Start a general conversation with the default assistant.')
  })

  it('round-trips back to Chinese without any extra migration step', () => {
    const english = createAgentStoreState(createPlatformAgentSeed([], { locale: 'en-US' }))
    const localized = localizeBuiltinSeedCopy(english, 'zh-CN', variants())

    expect(localized.agents[0]?.name).toBe('默认助手')
    expect(localized.sessions[0]?.name).toBe('新的会话')
  })

  it('keeps user-edited fields while localizing the ones still at a built-in value', () => {
    const state = createAgentStoreState(createPlatformAgentSeed([], { locale: 'zh-CN' }))
    const renamed = { ...state, agents: [{ ...state.agents[0]!, name: 'My Analyst' }] }

    const localized = localizeBuiltinSeedCopy(renamed, 'en-US', variants())

    expect(localized.agents[0]?.name).toBe('My Analyst')
    expect(localized.agents[0]?.description).toBe('A general-purpose conversation and task assistant.')
  })

  it('leaves user-created agents and sessions alone', () => {
    const state = createAgentStoreState(createPlatformAgentSeed([], { locale: 'zh-CN' }))
    const custom = {
      ...state,
      agents: [
        ...state.agents,
        {
          ...state.agents[0]!,
          id: 'custom-agent',
          name: '自定义智能体',
          description: '自定义描述',
          instructions: '自定义提示词'
        }
      ],
      sessions: [
        ...state.sessions,
        { ...state.sessions[0]!, id: 'custom-session', name: '自定义会话', description: '自定义会话描述' }
      ]
    }

    const localized = localizeBuiltinSeedCopy(custom, 'en-US', variants())

    expect(localized.agents.find((agent) => agent.id === 'custom-agent')).toMatchObject({
      name: '自定义智能体',
      description: '自定义描述',
      instructions: '自定义提示词'
    })
    expect(localized.sessions.find((session) => session.id === 'custom-session')?.name).toBe('自定义会话')
  })

  it('returns the same state when nothing needs to change', () => {
    const state = createAgentStoreState(createPlatformAgentSeed([], { locale: 'en-US' }))
    expect(localizeBuiltinSeedCopy(state, 'en-US', variants())).toBe(state)
  })

  it('ignores entries that are not defined in every supported language', () => {
    const state = createAgentStoreState(createPlatformAgentSeed([], { locale: 'zh-CN' }))
    const onlyChinese: BuiltinSeedLanguageVariant[] = [
      { language: 'zh-CN', seed: createPlatformAgentSeed([], { locale: 'zh-CN' }) }
    ]

    expect(localizeBuiltinSeedCopy(state, 'en-US', onlyChinese)).toBe(state)
  })

  it('fills empty copy from the built-in definition', () => {
    const state = createAgentStoreState(createPlatformAgentSeed([], { locale: 'zh-CN' }))
    const empty = { ...state, agents: [{ ...state.agents[0]!, description: '' }] }

    expect(localizeBuiltinSeedCopy(empty, 'en-US', variants()).agents[0]?.description).toBe(
      'A general-purpose conversation and task assistant.'
    )
  })
})

function variants(): BuiltinSeedLanguageVariant[] {
  return [
    { language: 'zh-CN', seed: createPlatformAgentSeed([], { locale: 'zh-CN' }) },
    { language: 'en-US', seed: createPlatformAgentSeed([], { locale: 'en-US' }) }
  ]
}
