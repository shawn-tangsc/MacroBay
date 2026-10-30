import { buildChatCompletionsUrl } from '../../providers/providerEndpoints'
import {
  classifyModelLifecycleFailure,
  modelLifecycleRuntimeFailureCode,
  resolveProviderRuntimeFailureCode
} from '../../providers/modelLifecycleFailure'
import { readUpstreamErrorMessage } from '../../providers/providerFailureMapping'
import type { AgentEntity, UniqueModelId } from '../schemas/agentSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity, MessageData, MessageStats } from '../schemas/sessionSchemas'
import { addAgentSessionMessage, getSessionMessages, type AgentStoreState } from '../store/agentStore'
import {
  ProviderRuntimeFailureError,
  ProviderRuntimeFailurePolicy,
  type ModelProvider,
  type ProviderState,
  type ProviderStateAccessor
} from '../../providers/modelProviderTypes'
import { isProviderConnectionReady } from '../../providers/providerStore'
import { normalizeModelChatProtocol } from '../../providers/modelChatProtocol'
import { requestConfiguredChatProtocolCompletion } from '../../chat/chatProtocolTransport'
import { mergeProviderHeaders } from '../../providers/providerRequestHeaders'
import { getAgentMessagePromptText } from '../schemas/messageDataHelpers'
import {
  addPendingAssistantMessageToState,
  buildRuntimePromptText,
  buildRuntimeTurnResult,
  createRuntimeTextData,
  createRuntimeUserMessageData,
  maybeAutoRenameSessionAfterTurn,
  patchRuntimeAssistantMessage,
  type AgentSessionAiNamingHook
} from './agentTurnPersistence'
import { createRuntimeTextDataFromDescriptor, createRuntimeTextDescriptor, runtimeStatusText } from './runtimeText'
import { resolveRuntimeMentionedModels, type AgentRuntimeMentionedModelInput } from './agentMentionedModels'
import { resolveEffectiveAgentModel } from './effectiveAgentModel'
import type { AgentRuntimeStopReason } from './runtimeTypes'

export type AgentChatRuntimeMentionedModelInput = AgentRuntimeMentionedModelInput

/** Display-only context card for a user message; the raw reference stays in `text`. */
export type AgentChatContextReference = {
  kind: string
  label: string
  detail?: string
  /** Product-owned identity for renderers/actions; never displayed raw. */
  payload?: Record<string, unknown>
}

export type AgentChatRuntimeRequest = {
  agentId: string
  sessionId: string
  text: string
  /** Question shown in the transcript when `text` also carries machine-readable context. */
  displayText?: string
  /** Readable card rendered above `displayText`; never sent to the model by itself. */
  context?: AgentChatContextReference
  mentionedModels?: AgentChatRuntimeMentionedModelInput[]
  runId?: string
}

export type AgentChatRuntimeResult = {
  state: AgentStoreState
  userMessage: AgentSessionMessageEntity
  assistantMessage: AgentSessionMessageEntity
  /** Tool calls completed during this turn; null when the runtime did not expose any. */
  toolInvocations?: readonly import('./runtimeTypes').AgentRuntimeToolInvocation[]
}

export type AgentChatRuntime = {
  sendMessage: (request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  cancelMessage: (runId: string, reason?: AgentRuntimeStopReason) => boolean
  cancelSession: (sessionId: string, reason?: AgentRuntimeStopReason) => boolean
}

export type AgentChatRuntimeDependencies = {
  getAgentState: () => Promise<AgentStoreState>
  saveAgentState: (state: AgentStoreState, options?: { mergeSessionId?: string }) => Promise<void>
  getProviderState: ProviderStateAccessor
  fetch?: typeof fetch
  aiNaming?: AgentSessionAiNamingHook
  resolveNamingModelId?: (input: {
    agentModelId: string | null
    providerState: ProviderState
  }) => Promise<string | null> | string | null
  /** 模型服务页「默认智能体模型」；智能体没有显式模型时使用。 */
  getDefaultAgentModelId?: () => Promise<string | null> | string | null
}

type ChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type ChatCompletionUsage = {
  total_tokens?: unknown
  prompt_tokens?: unknown
  completion_tokens?: unknown
}

type ChatCompletionStreamChunk = {
  id?: unknown
  choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown }; text?: unknown }>
  usage?: ChatCompletionUsage
}

export function createAgentChatRuntime(deps: AgentChatRuntimeDependencies): AgentChatRuntime {
  const activeRuns = new Map<string, AbortController>()
  const activeRunIdBySessionId = new Map<string, string>()
  const busySessions = new Set<string>()
  const pendingTurnsBySessionId = new Map<string, PendingRuntimeTurn[]>()

  return {
    cancelMessage(runId, reason) {
      const controller = activeRuns.get(runId)
      if (!controller) return false
      controller.abort(reason)
      return true
    },
    cancelSession(sessionId, reason) {
      const runId = activeRunIdBySessionId.get(sessionId)
      if (!runId) return false
      const controller = activeRuns.get(runId)
      if (!controller) return false
      controller.abort(reason)
      return true
    },
    async sendMessage(request) {
      const initialState = await deps.getAgentState()
      const agent = findAgent(initialState, request.agentId)
      const session = findSession(initialState, request.sessionId)
      if (!agent) {
        throw new Error(`Agent "${request.agentId}" was not found.`)
      }
      if (!session) {
        throw new Error(`Session "${request.sessionId}" was not found.`)
      }
      if (session.agentId !== agent.id) {
        throw new Error(`Session "${request.sessionId}" does not belong to agent "${request.agentId}".`)
      }

      if (busySessions.has(session.id)) {
        return enqueuePendingTurn({
          request,
          session,
          deps,
          pendingTurnsBySessionId
        })
      }

      return executeTurn({
        request,
        session,
        agent,
        deps,
        activeRuns,
        activeRunIdBySessionId,
        busySessions,
        pendingTurnsBySessionId
      })
    }
  }
}

type PendingRuntimeTurn = {
  request: AgentChatRuntimeRequest
  userMessageId: string
  resolve: (result: AgentChatRuntimeResult) => void
  reject: (error: unknown) => void
}

async function enqueuePendingTurn(input: {
  request: AgentChatRuntimeRequest
  session: AgentSessionEntity
  deps: AgentChatRuntimeDependencies
  pendingTurnsBySessionId: Map<string, PendingRuntimeTurn[]>
}): Promise<AgentChatRuntimeResult> {
  const userMessageId = createId('user')
  const providerState = await input.deps.getProviderState()
  const nextState = addAgentSessionMessage(await input.deps.getAgentState(), input.session.id, {
    id: userMessageId,
    role: 'user',
    status: 'success',
      data: createRuntimeUserMessageData(
      input.request.text,
      resolveRuntimeMentionedModels(input.request.mentionedModels, providerState),
      {
        ...(input.request.displayText ? { displayText: input.request.displayText } : {}),
        ...(input.request.context ? { context: input.request.context } : {})
      }
    )
  })
  await input.deps.saveAgentState(nextState, { mergeSessionId: input.session.id })

  return new Promise<AgentChatRuntimeResult>((resolve, reject) => {
    const queued = input.pendingTurnsBySessionId.get(input.session.id) ?? []
    queued.push({ request: input.request, userMessageId, resolve, reject })
    input.pendingTurnsBySessionId.set(input.session.id, queued)
  })
}

async function executeTurn(input: {
  request: AgentChatRuntimeRequest
  session: AgentSessionEntity
  agent: AgentEntity
  deps: AgentChatRuntimeDependencies
  activeRuns: Map<string, AbortController>
  activeRunIdBySessionId: Map<string, string>
  busySessions: Set<string>
  pendingTurnsBySessionId: Map<string, PendingRuntimeTurn[]>
  queuedUserMessageId?: string
}): Promise<AgentChatRuntimeResult> {
  const runId = input.request.runId ?? createId('run')
  const controller = new AbortController()
  input.activeRuns.set(runId, controller)
  input.activeRunIdBySessionId.set(input.session.id, runId)
  input.busySessions.add(input.session.id)
  const providerState = await input.deps.getProviderState()
  const mentionedModels = resolveRuntimeMentionedModels(input.request.mentionedModels, providerState)
  // 没显式绑定模型 ⇒ 模型服务里的「默认智能体模型」；解析不出来时保留原值，让下面照旧报错。
  const effectiveModel = await resolveEffectiveAgentModel({
    agent: input.agent,
    getProviderState: input.deps.getProviderState,
    getConfiguredDefaultModelId: input.deps.getDefaultAgentModelId
  })
  const agent = effectiveModel
    ? { ...input.agent, model: effectiveModel.model, modelName: effectiveModel.modelName }
    : input.agent

      const assistantMessageId = createId('assistant')
  const initialState = await input.deps.getAgentState()
  const withUser = input.queuedUserMessageId
    ? initialState
    : addAgentSessionMessage(initialState, input.session.id, {
          role: 'user',
          status: 'success',
          data: createRuntimeUserMessageData(input.request.text, mentionedModels, {
            ...(input.request.displayText ? { displayText: input.request.displayText } : {}),
            ...(input.request.context ? { context: input.request.context } : {})
          })
        })
  const withPending = addPendingAssistantMessageToState(withUser, {
    sessionId: input.session.id,
    assistantMessageId,
    modelId: agent.model,
    modelName: agent.modelName
  })
  await input.deps.saveAgentState(withPending, { mergeSessionId: input.session.id })

  try {
    const providerId = resolveModelReference(agent.model).providerId
    const metadataProvider = providerState.providers.find((provider) => provider.id === providerId)
    const runtimeProvider = input.deps.getProviderState.resolveRuntimeProvider
      ? await input.deps.getProviderState.resolveRuntimeProvider(providerId)
      : metadataProvider
    if (!runtimeProvider?.apiKey?.trim()) {
      throw new ProviderRuntimeFailureError(ProviderRuntimeFailurePolicy.configurationRequired)
    }
    const runtimeProviderState = runtimeProvider
      ? { providers: providerState.providers.map((provider) => provider.id === runtimeProvider.id ? runtimeProvider : provider) }
      : providerState
    let streamingState = withPending
    const response = await runProviderChatCompletion({
      providerState: runtimeProviderState,
      state: withPending,
      agent,
      session: input.session,
      text: buildRuntimePromptText(input.request.text, mentionedModels),
      signal: controller.signal,
      fetch: input.deps.fetch,
      onDelta: async (partialText) => {
        streamingState = await patchRuntimeAssistantMessage(input.deps, input.session.id, assistantMessageId, {
          status: 'pending',
          data: createRuntimeTextData(partialText)
        })
      }
    })
    const successState = await patchRuntimeAssistantMessage(input.deps, input.session.id, assistantMessageId, {
      status: 'success',
      data: createRuntimeTextData(response.text),
      stats: response.stats,
      modelSnapshot: response.modelSnapshot,
      runtimeResumeToken: response.runtimeResumeToken
    })
    const namingModelId =
      (await input.deps.resolveNamingModelId?.({
        agentModelId: agent.model,
        providerState
      })) ?? agent.model
    const renamedState = await maybeAutoRenameSessionAfterTurn(
      input.deps,
      successState,
      input.session.id,
      input.request.text,
      {
        assistantText: response.text,
        modelId: namingModelId,
        aiNaming: input.deps.aiNaming
      }
    )
    return buildRuntimeTurnResult(renamedState, input.session.id, assistantMessageId)
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      const pausedState = await patchRuntimeAssistantMessage(input.deps, input.session.id, assistantMessageId, {
        status: 'paused',
        data: createRuntimeTextDataFromDescriptor(runtimeStatusText.stopped)
      })
      return buildRuntimeTurnResult(pausedState, input.session.id, assistantMessageId)
    }

    const errorState = await patchRuntimeAssistantMessage(input.deps, input.session.id, assistantMessageId, {
      status: 'error',
      data: createRuntimeTextDataFromDescriptor(createProviderRuntimeFailureText(error))
    })
    return buildRuntimeTurnResult(errorState, input.session.id, assistantMessageId)
  } finally {
    input.activeRuns.delete(runId)
    if (input.activeRunIdBySessionId.get(input.session.id) === runId) {
      input.activeRunIdBySessionId.delete(input.session.id)
    }
    input.busySessions.delete(input.session.id)
    void drainNextPendingTurn(input)
  }
}

async function drainNextPendingTurn(input: {
  session: AgentSessionEntity
  agent: AgentEntity
  deps: AgentChatRuntimeDependencies
  activeRuns: Map<string, AbortController>
  activeRunIdBySessionId: Map<string, string>
  busySessions: Set<string>
  pendingTurnsBySessionId: Map<string, PendingRuntimeTurn[]>
}): Promise<void> {
  if (input.busySessions.has(input.session.id)) return
  const queue = input.pendingTurnsBySessionId.get(input.session.id)
  const next = queue?.shift()
  if (!next) {
    input.pendingTurnsBySessionId.delete(input.session.id)
    return
  }
  if (queue && queue.length > 0) input.pendingTurnsBySessionId.set(input.session.id, queue)
  else input.pendingTurnsBySessionId.delete(input.session.id)

  try {
    next.resolve(
      await executeTurn({
        request: next.request,
        session: input.session,
        agent: input.agent,
        deps: input.deps,
        activeRuns: input.activeRuns,
        activeRunIdBySessionId: input.activeRunIdBySessionId,
        busySessions: input.busySessions,
        pendingTurnsBySessionId: input.pendingTurnsBySessionId,
        queuedUserMessageId: next.userMessageId
      })
    )
  } catch (error) {
    next.reject(error)
  }
}

async function runProviderChatCompletion(input: {
  providerState: ProviderState
  state: AgentStoreState
  agent: AgentEntity
  session: AgentSessionEntity
  text: string
  signal?: AbortSignal
  fetch?: typeof fetch
  onDelta?: (partialText: string) => Promise<void> | void
}): Promise<{
  text: string
  stats: MessageStats | null
  modelSnapshot: AgentSessionMessageEntity['modelSnapshot']
  runtimeResumeToken: string | null
}> {
  const modelRef = resolveModelReference(input.agent.model)
  const provider = input.providerState.providers.find((item) => item.id === modelRef.providerId)
  if (!provider) throw new Error(`Provider "${modelRef.providerId}" was not found.`)
  if (!isProviderConnectionReady(provider)) {
    throw new ProviderRuntimeFailureError(ProviderRuntimeFailurePolicy.configurationRequired)
  }

  const model =
    provider.models.find((item) => item.id === modelRef.modelId && item.capabilities.chat) ??
    provider.models.find((item) => item.id === provider.defaultChatModelId && item.capabilities.chat) ??
    provider.models.find((item) => item.capabilities.chat)
  if (!model) throw new Error('Add at least one chat-capable model first.')

  /**
   * T4/T5：协议是模型自己的事实；不是 chat-completions ⇒ 走共用适配器（非流式）。
   * 返回 null ⇒ chat/completions 链路，下面的代码逐字不变。
   */
  const configuredProtocol = await requestConfiguredChatProtocolCompletion({
    // 运行时只读模型自己的协议（同步/新增时已把供应商默认快照进去）。
    protocol: normalizeModelChatProtocol(model.chatProtocol),
    endpoints: provider.endpoints,
    apiKey: provider.apiKey?.trim() ?? '',
    providerId: provider.id,
    modelId: model.id,
    messages: buildRuntimeMessages(input.state, input.session.id, input.agent, input.text),
    temperature: 0.2,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.fetch ? { fetch: input.fetch } : {}),
    ...(input.onDelta ? { onDelta: input.onDelta } : {})
  })
  if (configuredProtocol) {
    return {
      text: configuredProtocol.text,
      stats: configuredProtocol.stats,
      modelSnapshot: {
        id: model.id,
        name: model.name,
        provider: provider.id
      },
      // 新协议没有 chat/completions 的 `id` 续跑语义。
      runtimeResumeToken: null
    }
  }

  const response = await (input.fetch ?? fetch)(buildChatCompletionsUrl(provider.baseUrl), {
    method: 'POST',
    headers: mergeProviderHeaders({
      authorization: `Bearer ${provider.apiKey?.trim() ?? ''}`,
      'content-type': 'application/json'
    }, provider.customHeaders),
    signal: input.signal,
    body: JSON.stringify({
      model: model.id,
      messages: buildRuntimeMessages(input.state, input.session.id, input.agent, input.text),
      temperature: 0.2,
      stream: true
    })
  })

  if (!response.ok) {
    // PLAT-74：把状态码 + 上游文案交给生命周期分类，才能区分「已下线 / 未开通 / 不存在」与普通失败。
    const upstream = await readUpstreamErrorMessage(response, provider.apiKey ?? '')
    const lifecycle = classifyModelLifecycleFailure({ status: response.status, summary: upstream })
    throw new ProviderRuntimeFailureError(
      lifecycle ? modelLifecycleRuntimeFailureCode(lifecycle) : ProviderRuntimeFailurePolicy.requestFailed
    )
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    const streamResult = await readStreamingChatCompletion(response, input.onDelta)
    return {
      ...streamResult,
      modelSnapshot: {
        id: model.id,
        name: model.name,
        provider: provider.id
      }
    }
  }

  const payload = (await response.json()) as ChatCompletionStreamChunk
  const text = extractAssistantText(payload)
  return {
    text,
    stats: normalizeUsage(payload.usage),
    modelSnapshot: {
      id: model.id,
      name: model.name,
      provider: provider.id
    },
    runtimeResumeToken: typeof payload.id === 'string' ? payload.id : null
  }
}

function createProviderRuntimeFailureText(error: unknown) {
  const code = resolveProviderRuntimeFailureCode(error)
  return createRuntimeTextDescriptor(`agent.runtime.${code}`, `agent.runtime.${code}`)
}

async function readStreamingChatCompletion(
  response: Response,
  onDelta?: (partialText: string) => Promise<void> | void
): Promise<{
  text: string
  stats: MessageStats | null
  modelSnapshot: AgentSessionMessageEntity['modelSnapshot']
  runtimeResumeToken: string | null
}> {
  if (!response.body) throw new Error('Model stream did not include a response body.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage: ChatCompletionUsage | undefined
  let runtimeResumeToken: string | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: !done })

    const events = extractSseEvents(buffer)
    buffer = events.remainder
    for (const event of events.items) {
      if (event === '[DONE]') continue
      const chunk = parseStreamChunk(event)
      if (!chunk) continue

      if (typeof chunk.id === 'string') runtimeResumeToken = chunk.id
      if (chunk.usage) usage = chunk.usage

      const delta = extractDeltaText(chunk)
      if (!delta) continue
      text += delta
      await onDelta?.(text)
    }

    if (done) break
  }

  if (!text.trim()) throw new Error('Model response did not include assistant text.')
  return {
    text: text.trim(),
    stats: normalizeUsage(usage),
    modelSnapshot: null,
    runtimeResumeToken
  }
}

function buildRuntimeMessages(
  state: AgentStoreState,
  sessionId: string,
  agent: AgentEntity,
  text: string
): ChatCompletionMessage[] {
  const messages: ChatCompletionMessage[] = []
  if (agent.instructions?.trim()) {
    messages.push({ role: 'system', content: agent.instructions.trim() })
  }

  for (const message of getSessionMessages(state, sessionId).slice(-12)) {
    if (message.status !== 'success') continue
    const content = messageDataToText(message.data)
    if (!content) continue
    if (message.role === 'system') messages.push({ role: 'system', content })
    if (message.role === 'user') messages.push({ role: 'user', content })
    if (message.role === 'assistant') messages.push({ role: 'assistant', content })
  }

  if (messages[messages.length - 1]?.role !== 'user' || messages[messages.length - 1]?.content !== text) {
    messages.push({ role: 'user', content: text })
  }
  return messages
}

function resolveModelReference(modelId: UniqueModelId | null): { providerId: string; modelId: string } {
  if (!modelId) throw new Error('Select a model for this agent before chatting.')
  const separatorIndex = modelId.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === modelId.length - 1) {
    throw new Error('Select a model for this agent before chatting.')
  }
  return {
    providerId: modelId.slice(0, separatorIndex),
    modelId: modelId.slice(separatorIndex + 1)
  }
}

function findAgent(state: AgentStoreState, agentId: string): AgentEntity | null {
  return state.agents.find((item) => item.id === agentId) ?? null
}

function findSession(state: AgentStoreState, sessionId: string): AgentSessionEntity | null {
  return state.sessions.find((item) => item.id === sessionId) ?? null
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function messageDataToText(data: MessageData): string {
  return getAgentMessagePromptText(data)
}

function extractAssistantText(payload: { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> }): string {
  const firstChoice = payload.choices?.[0]
  const messageContent = firstChoice?.message?.content
  if (typeof messageContent === 'string' && messageContent.trim()) return messageContent.trim()
  if (typeof firstChoice?.text === 'string' && firstChoice.text.trim()) return firstChoice.text.trim()
  throw new Error('Model response did not include assistant text.')
}

function extractDeltaText(payload: ChatCompletionStreamChunk): string {
  const firstChoice = payload.choices?.[0]
  const deltaContent = firstChoice?.delta?.content
  if (typeof deltaContent === 'string') return deltaContent
  const messageContent = firstChoice?.message?.content
  if (typeof messageContent === 'string') return messageContent
  if (typeof firstChoice?.text === 'string') return firstChoice.text
  return ''
}

function parseStreamChunk(raw: string): ChatCompletionStreamChunk | null {
  try {
    return JSON.parse(raw) as ChatCompletionStreamChunk
  } catch {
    return null
  }
}

function extractSseEvents(buffer: string): { items: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const remainder = parts.pop() ?? ''
  const items = parts
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join('\n')
    )
    .filter(Boolean)

  return { items, remainder }
}

function normalizeUsage(usage: ChatCompletionUsage | undefined): MessageStats | null {
  if (!usage) return null
  const stats: MessageStats = {}
  if (typeof usage.total_tokens === 'number') stats.totalTokens = usage.total_tokens
  if (typeof usage.prompt_tokens === 'number') stats.promptTokens = usage.prompt_tokens
  if (typeof usage.completion_tokens === 'number') stats.completionTokens = usage.completion_tokens
  return Object.keys(stats).length > 0 ? stats : null
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
