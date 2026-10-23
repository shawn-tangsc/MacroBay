import { describe, expect, it } from 'vitest'

import { runtimeTextKeys } from '@platform/ai/agent-platform/runtime/runtimeText'

import { agentText } from './agentText'
import { resolveAgentMessagePartText, resolveAgentRuntimeTextPart } from './resolveAgentRuntimeText'

describe('resolveAgentRuntimeText', () => {
  it('resolves runtime-text parts through agent i18n catalogs', () => {
    expect(
      resolveAgentRuntimeTextPart(
        {
          type: 'runtime-text',
          key: runtimeTextKeys.stopped,
          fallback: '已停止。',
          text: '已停止。'
        },
        agentText['en-US']
      )
    ).toBe('Stopped.')

    expect(
      resolveAgentMessagePartText(
        {
          type: 'runtime-text',
          key: runtimeTextKeys.connecting,
          fallback: '正在连接模型服务...',
          text: '正在连接模型服务...'
        },
        agentText['zh-CN']
      )
    ).toBe('正在连接模型服务...')
  })

  it('localizes provider runtime failure codes and safely falls back for an unknown code', () => {
    expect(
      resolveAgentMessagePartText(
        {
          type: 'runtime-text',
          key: 'agent.runtime.provider-configuration-required',
          fallback: 'provider-configuration-required',
          text: 'provider-configuration-required'
        },
        agentText['en-US']
      )
    ).toBe('Configure an enabled model service before trying again.')

    expect(
      resolveAgentMessagePartText(
        {
          type: 'runtime-text',
          key: 'agent.runtime.provider-request-failed',
          fallback: 'provider-request-failed',
          text: 'provider-request-failed'
        },
        agentText['zh-CN']
      )
    ).toBe('模型请求失败，请重试。')

    expect(
      resolveAgentMessagePartText(
        {
          type: 'runtime-text',
          key: 'agent.runtime.provider-model-retired',
          fallback: 'provider-model-retired',
          text: 'provider-model-retired'
        },
        agentText['zh-CN']
      )
    ).toBe('该模型已下线，请更换模型。')

    expect(
      resolveAgentMessagePartText(
        {
          type: 'runtime-text',
          key: 'agent.runtime.provider-model-not-activated',
          fallback: 'provider-model-not-activated',
          text: 'provider-model-not-activated'
        },
        agentText['en-US']
      )
    ).toBe('This model is not activated. Enable it in the provider console.')

    expect(
      resolveAgentMessagePartText(
        {
          type: 'runtime-text',
          key: 'agent.runtime.provider-model-not-found',
          fallback: 'provider-model-not-found',
          text: 'provider-model-not-found'
        },
        agentText['en-US']
      )
    ).toBe('This model no longer exists. Switch to another model.')

    const unknownCode = 'fixture-runtime-error-payload-1234567890'
    const fallback = resolveAgentMessagePartText(
      {
        type: 'runtime-text',
        key: `agent.runtime.${unknownCode}`,
        fallback: unknownCode,
        text: unknownCode
      },
      agentText['en-US']
    )

    expect(fallback).toBe('Model request failed. Try again.')
    expect(fallback).not.toContain(unknownCode)
  })
})
