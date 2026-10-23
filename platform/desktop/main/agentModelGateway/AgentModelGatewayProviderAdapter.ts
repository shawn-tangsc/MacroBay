import { buildMessagesUrl } from '../../../ai/providers/providerEndpoints'
import type { AgentModelGatewayProviderConfig } from './agentModelGatewayTypes'
import {
  classifyGatewayConfigError,
  classifyGatewayHttpStatus,
  classifyGatewayTransportError,
  toSafeGatewayErrorBody
} from './gatewayErrorClassifier'
import { createGatewayAbortTimeout } from './gatewayAbortAndTimeout'
import { forwardOpenAiChatCompletions } from './openAiChatCompletionsAdapter'
import { forwardOpenAiResponses } from './openAiResponsesAdapter'

export type AgentModelGatewayForwardInput = {
  config: AgentModelGatewayProviderConfig
  body: string
  upstreamApiKey: string
  fetch: typeof fetch
  abortSignal?: AbortSignal
  timeoutMs?: number
}

export type AgentModelGatewayForwardResult = {
  status: number
  headers: Record<string, string>
  body: string
}

export type AgentModelGatewayProviderAdapter = {
  forwardAnthropicMessages: (input: AgentModelGatewayForwardInput) => Promise<AgentModelGatewayForwardResult>
}

export function createAgentModelGatewayProviderAdapter(): AgentModelGatewayProviderAdapter {
  return {
    forwardAnthropicMessages: forwardAnthropicMessages
  }
}

async function forwardAnthropicMessages(input: AgentModelGatewayForwardInput): Promise<AgentModelGatewayForwardResult> {
  if (input.config.apiType === 'openai-chat-completions') {
    return forwardOpenAiChatCompletions({
      upstreamBaseUrl: input.config.upstreamBaseUrl,
      upstreamApiKey: input.upstreamApiKey,
      body: input.body,
      fetch: input.fetch,
      abortSignal: input.abortSignal,
      timeoutMs: input.timeoutMs
    })
  }

  if (input.config.apiType === 'openai-responses') {
    return forwardOpenAiResponses({
      upstreamBaseUrl: input.config.upstreamBaseUrl,
      upstreamApiKey: input.upstreamApiKey,
      body: input.body,
      fetch: input.fetch,
      abortSignal: input.abortSignal,
      timeoutMs: input.timeoutMs
    })
  }

  if (input.config.apiType !== 'anthropic-messages') {
    const classified = classifyGatewayConfigError(
      `Gateway adapter does not support ${input.config.apiType} yet.`
    )
    return {
      status: 501,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(toSafeGatewayErrorBody(classified))
    }
  }

  const abortHandle = createGatewayAbortTimeout({
    timeoutMs: input.timeoutMs,
    parentSignal: input.abortSignal
  })

  try {
    const response = await input.fetch(buildMessagesUrl(input.config.upstreamBaseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': input.upstreamApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: input.body,
      signal: abortHandle.signal
    })

    const body = await response.text()
    if (!response.ok) {
      const classified = classifyGatewayHttpStatus(response.status, {
        location: 'upstream',
        bodyText: body
      })
      return {
        status: classified.status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(toSafeGatewayErrorBody(classified))
      }
    }

    return {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8'
      },
      body
    }
  } catch (error) {
    const classified = classifyGatewayTransportError(error)
    return {
      status: classified.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(toSafeGatewayErrorBody(classified))
    }
  } finally {
    abortHandle.clear()
  }
}
