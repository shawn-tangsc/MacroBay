import { describe, expect, it } from 'vitest'

import {
  applyAgentFormPatch,
  buildAgentFormStateForEditor,
  buildCreateAgentPayload,
  buildInitialAgentFormState,
  diffAgentSaveIntent,
  diffAgentUpdate,
  validateAgentCreateForm,
  type AgentDetail
} from './agentConfigDescriptor'

const agent: AgentDetail = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Agent',
  description: 'Desc',
  instructions: 'Prompt',
  model: 'anthropic:claude-sonnet',
  modelName: 'Claude Sonnet',
  mcps: ['github'],
  disabledTools: ['Bash'],
  configuration: {
    avatar: '🤖',
    permission_mode: 'default',
    max_turns: 20,
    env_vars: { FOO: 'bar' },
    heartbeat_enabled: true,
    heartbeat_interval: 15,
    custom_key: 'kept'
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  orderKey: 'a'
}

describe('agent config descriptor', () => {
  it('prefills the default agent model only when creating without a model', () => {
    expect(buildAgentFormStateForEditor(null, 'anthropic:claude-sonnet').model).toBe('anthropic:claude-sonnet')
    expect(buildAgentFormStateForEditor(null, '').model).toBe('')
    expect(buildAgentFormStateForEditor(null).model).toBe('')
    // 已有智能体：显式绑定（或用户改过的值）优先，不被默认值覆盖。
    expect(buildAgentFormStateForEditor(agent, 'other:gpt').model).toBe('anthropic:claude-sonnet')
  })

  it('builds initial form state from an agent', () => {
    const form = buildInitialAgentFormState(agent)

    expect(form.name).toBe('Agent')
    expect(form.model).toBe('anthropic:claude-sonnet')
    expect(form.avatar).toBe('🤖')
    expect(form.maxTurns).toBe(20)
    expect(form.envVarsText).toBe('FOO=bar')
    expect(form.heartbeatInterval).toBe(15)
  })

  it('validates create form name and model', () => {
    expect(validateAgentCreateForm(buildInitialAgentFormState()).isValid).toBe(false)
    expect(validateAgentCreateForm({ ...buildInitialAgentFormState(), name: 'Agent', model: 'provider:model' }).isValid).toBe(true)
  })

  it('builds create payload with trimmed name and compact configuration', () => {
    const payload = buildCreateAgentPayload({
      ...buildInitialAgentFormState(),
      name: '  Agent  ',
      model: 'provider:model',
      avatar: '🧠',
      permissionMode: 'plan',
      envVarsText: 'FOO=bar\nEMPTY',
      disabledTools: ['Bash', 'Bash']
    })

    expect(payload.name).toBe('Agent')
    expect(payload.type).toBe('claude-code')
    expect(payload.disabledTools).toEqual(['Bash'])
    expect(payload.configuration).toMatchObject({
      avatar: '🧠',
      permission_mode: 'plan',
      env_vars: { FOO: 'bar', EMPTY: '' }
    })
  })

  it('links soul mode to bypass permissions', () => {
    const form = buildInitialAgentFormState(agent)

    const soul = applyAgentFormPatch(form, { soulEnabled: true })
    expect(soul.permissionMode).toBe('bypassPermissions')

    const normal = applyAgentFormPatch({ ...soul, soulEnabled: true }, { permissionMode: 'default' })
    expect(normal.soulEnabled).toBe(false)
  })

  it('diffs agent updates while preserving unknown configuration keys', () => {
    const baseline = buildInitialAgentFormState(agent)
    const next = {
      ...baseline,
      name: 'Next',
      maxTurns: 0,
      envVarsText: 'FOO=baz',
      disabledTools: ['Read', 'Read']
    }

    const diff = diffAgentUpdate(baseline, next, agent)

    expect(diff?.dto).toMatchObject({
      name: 'Next',
      disabledTools: ['Read'],
      configuration: {
        custom_key: 'kept',
        max_turns: 100,
        env_vars: { FOO: 'baz' }
      }
    })
  })

  it('returns null when edit form is unchanged', () => {
    const baseline = buildInitialAgentFormState(agent)
    expect(diffAgentSaveIntent(baseline, baseline, agent)).toBeNull()
  })

  it('returns create intent only when create form is valid', () => {
    const invalid = buildInitialAgentFormState()
    const valid = { ...invalid, name: 'Agent', model: 'provider:model' }

    expect(diffAgentSaveIntent(invalid, invalid, null)).toBeNull()
    expect(diffAgentSaveIntent(valid, invalid, null)?.kind).toBe('create')
  })
})
