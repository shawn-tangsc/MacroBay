import { randomUUID } from 'node:crypto'

import { resolveChatModelForRuntime, resolveChatModelMetadata } from '../../invocation/resolveChatModel'
import {
  parseConfiguredModelRef,
  resolveConfiguredModelId
} from '../../model-defaults/configuredDefaultModel'
import { resolveProviderRuntimeFailureCode } from '../../providers/modelLifecycleFailure'
import {
  ProviderRuntimeFailureError,
  ProviderRuntimeFailurePolicy,
  type ProviderStateAccessor
} from '../../providers/modelProviderTypes'
import type { AssistantTopicNamingService } from '../naming/AssistantTopicNamingService'
import { summarizeAssistantTopicFallback } from '../naming/assistantTopicAutoTitle'
import { flattenActiveBranch, resolveParentIdForCreate } from '../messageTree/assistantMessageTree'
import {
  createAssistantTextData,
  extractAssistantSearchableText,
  type AssistantMessageData,
  type AssistantMessagePart,
  type AssistantMessageEntity
} from '../schemas/messageSchemas'
import {
  assistantWebSearchTools,
  createAssistantWebSearchToolService
} from '../../web-search/assistant/assistantWebSearchTools'
import { createAssistantWebSearchMessagePart } from '../../web-search/assistant/assistantWebSearchMessageParts'
import type { AssistantEntity } from '../schemas/assistantSchemas'
import type {
  AssistantStreamOpenRequest,
  AssistantStreamOpenResponse
} from '../schemas/streamSchemas'
import type { AssistantChatRuntimeDependencies, AssistantChatRuntimeService } from './assistantChatRuntimeTypes'
import {
  type AssistantToolCall,
  type ChatCompletionMessage
} from './assistantOpenAiStreamClient'
import { requestAssistantChatCompletion } from './assistantChatProtocolClient'
import { normalizeModelChatProtocol } from '../../providers/modelChatProtocol'
import {
  ASSISTANT_INVOCATION_FAILURE_EVIDENCE_V1,
  assistantInvocationFailureEvidence,
  type AssistantInvocationFailureEvidence
} from './assistantInvocationFailureEvidence'
import { AssistantStreamRegistry } from './assistantStreamRegistry'

function messageDataToText(message: AssistantMessageEntity): string {
  return extractAssistantSearchableText(message.data)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function createAssistantInterruptionData(): AssistantMessageData {
  return { parts: [{ type: 'interruption', message: '' }] }
}

export function createAssistantChatRuntimeService(
  deps: AssistantChatRuntimeDependencies
): AssistantChatRuntimeService {
  const registry = new AssistantStreamRegistry()
  const invocationFailureEvidenceByMessageId = new Map<string, AssistantInvocationFailureEvidence>()
  const getRuntimeProviderState = deps.getProviderState as ProviderStateAccessor

  return {
    open: (request) => openStream(request),
    attach: (topicId) => registry.attach(topicId),
    abort: (topicId) => abortTopic(topicId),
    discardTopic: (topicId) => discardTopic(topicId),
    getStatus: (topicId) => registry.getSnapshot(topicId),
    consumeInvocationFailureEvidence(messageId) {
      const evidence = invocationFailureEvidenceByMessageId.get(messageId)
      invocationFailureEvidenceByMessageId.delete(messageId)
      return evidence
    },
    reconcileStalePending: () => reconcileStalePending()
  }

  async function openStream(request: AssistantStreamOpenRequest): Promise<AssistantStreamOpenResponse> {
    const topic = deps.repos.topics.getById(request.topicId)
    if (!topic) {
      return { mode: 'blocked', message: `Topic not found: ${request.topicId}` }
    }

    const assistantId = request.assistantId ?? topic.assistantId
    if (!assistantId) {
      return { mode: 'blocked', message: 'Select an assistant before chatting.' }
    }

    const assistant = deps.repos.assistants.getById(assistantId)
    if (!assistant) {
      return { mode: 'blocked', message: `Assistant not found: ${assistantId}` }
    }

    const providerState = await deps.getProviderState()
    const modelIds = await resolveMentionedModelIds(request, assistant, providerState)
    if (modelIds.length === 0) {
      return { mode: 'blocked', message: 'Enable a provider and select a chat model first.' }
    }

    const placeholders = modelIds.map((modelId) => {
      const reference = parseConfiguredModelRef(modelId)
      const resolved = reference
        ? resolveChatModelMetadata(providerState, reference.providerId, reference.modelId)
        : resolveChatModelMetadata(providerState)
      if (!resolved.ok) {
        if (
          assistant.modelId === modelId &&
          resolved.errorCode === 'model-not-ready' &&
          !hasMissingBoundProviderEndpoint(providerState, reference?.providerId)
        ) {
          throw new Error('assistant-bound-model-not-ready')
        }
        throw new ProviderRuntimeFailureError(ProviderRuntimeFailurePolicy.configurationRequired)
      }
      return {
        id: randomUUID(),
        modelId,
        modelSnapshot: {
          id: resolved.model.modelId,
          name: resolved.model.modelName,
          provider: resolved.model.providerId
        }
      }
    })

    let userMessageId: string | undefined
    if (request.trigger === 'submit-message') {
      const contextMode = request.contextMode ?? 'thread'
      const parentId = contextMode === 'latest-user-only'
        ? null
        : resolveThreadParentId({
            topicId: request.topicId,
            activeNodeId: topic.activeNodeId,
            parentAnchorId: request.parentAnchorId
          })
      if (typeof parentId !== 'string' && parentId !== null) return parentId

      const turn = deps.repos.messages.createUserMessageWithPlaceholders(request.topicId, {
        userMessage: {
          mode: 'create',
          id: randomUUID(),
          parentAnchorId: parentId,
          data: { parts: request.userMessageParts },
          allowDetachedRoot: contextMode === 'latest-user-only'
        },
        placeholders
      })
      userMessageId = turn.userMessage.id
      applyFirstMessageTopicName(topic, turn.userMessage)
      const executionIds = await startExecutions({
        topicId: request.topicId,
        assistant,
        userMessage: turn.userMessage,
        placeholders: turn.placeholders,
        contextMode
      })
      return {
        mode: 'started',
        executionIds,
        userMessageId,
        placeholderIds: turn.placeholders.map((item) => item.id)
      }
    }

    if (request.trigger === 'resend-user-message') {
      const userMessage = deps.repos.messages.getById(request.userMessageId)
      if (!userMessage || userMessage.topicId !== request.topicId || userMessage.role !== 'user') {
        return { mode: 'blocked', message: 'Resend requires a valid user message.' }
      }
      const turn = deps.repos.messages.createUserMessageWithPlaceholders(request.topicId, {
        userMessage: { mode: 'existing', id: userMessage.id },
        placeholders
      })
      userMessageId = turn.userMessage.id
      const executionIds = await startExecutions({
        topicId: request.topicId,
        assistant,
        userMessage: turn.userMessage,
        placeholders: turn.placeholders,
        contextMode: 'thread'
      })
      return {
        mode: 'started',
        executionIds,
        userMessageId,
        placeholderIds: turn.placeholders.map((item) => item.id)
      }
    }

    const anchor = deps.repos.messages.getById(request.parentAnchorId)
    if (!anchor || anchor.topicId !== request.topicId || anchor.role !== 'user') {
      return { mode: 'blocked', message: 'Regenerate requires a valid user message anchor.' }
    }

    const turn = deps.repos.messages.createUserMessageWithPlaceholders(request.topicId, {
      userMessage: { mode: 'existing', id: anchor.id },
      placeholders
    })
    userMessageId = turn.userMessage.id
    const executionIds = await startExecutions({
      topicId: request.topicId,
      assistant,
      userMessage: turn.userMessage,
      placeholders: turn.placeholders,
      contextMode: 'thread'
    })
    return {
      mode: 'started',
      executionIds,
      userMessageId,
      placeholderIds: turn.placeholders.map((item) => item.id)
    }
  }

  async function resolveMentionedModelIds(
    request: AssistantStreamOpenRequest,
    assistant: AssistantEntity,
    providerState: Awaited<ReturnType<typeof deps.getProviderState>>
  ): Promise<string[]> {
    if (request.mentionedModelIds && request.mentionedModelIds.length > 0) {
      return request.mentionedModelIds
    }
    if (assistant.modelId) return [assistant.modelId]
    // 没显式绑定模型 ⇒ 模型服务里的「默认助手模型」优先；默认值不可用时不静默换模型，
    // 落到下面原有的「供应商默认模型」行为（与接线前一致）。
    const configuredDefault = await deps.getDefaultAssistantModelId?.()
    const defaultModelId = resolveConfiguredModelId({
      value: configuredDefault,
      providers: providerState.providers,
      isModelAcceptable: (_provider, model) => model.capabilities.chat === true
    })
    if (defaultModelId) return [defaultModelId]
    const resolved = resolveChatModelMetadata(providerState)
    if (resolved.ok) {
      return [`${resolved.model.providerId}:${resolved.model.modelId}`]
    }
    return []
  }

  function hasMissingBoundProviderEndpoint(
    providerState: Awaited<ReturnType<typeof deps.getProviderState>>,
    providerId: string | undefined
  ): boolean {
    if (!providerId) return false
    const provider = providerState.providers.find((entry) => entry.id === providerId)
    return Boolean(provider && !provider.baseUrl.trim())
  }

  function resolveThreadParentId(input: {
    topicId: string
    activeNodeId?: string | null
    parentAnchorId?: string | null
  }): string | null | AssistantStreamOpenResponse {
    const messages = deps.repos.messages.listByTopic(input.topicId)
    const parentResolution = resolveParentIdForCreate({
      messages,
      activeNodeId: input.activeNodeId,
      parentAnchorId: input.parentAnchorId
    })
    if (!parentResolution.ok) {
      return { mode: 'blocked', message: parentResolution.message }
    }
    return parentResolution.parentId
  }

  async function startExecutions(input: {
    topicId: string
    assistant: AssistantEntity
    userMessage: AssistantMessageEntity
    placeholders: AssistantMessageEntity[]
    contextMode: 'thread' | 'latest-user-only'
  }): Promise<string[]> {
    const executionIds: string[] = []
    for (const placeholder of input.placeholders) {
      const executionId = randomUUID()
      executionIds.push(executionId)
      const controller = registry.startExecution(input.topicId, executionId, placeholder.id)
      void runExecution({
        topicId: input.topicId,
        assistant: input.assistant,
        userMessage: input.userMessage,
        placeholder,
        executionId,
        contextMode: input.contextMode,
        captureInvocationFailureEvidence: input.contextMode === 'latest-user-only',
        signal: controller.signal
      })
    }
    return executionIds
  }

  async function runExecution(input: {
    topicId: string
    assistant: AssistantEntity
    userMessage: AssistantMessageEntity
    placeholder: AssistantMessageEntity
    executionId: string
    contextMode: 'thread' | 'latest-user-only'
    captureInvocationFailureEvidence: boolean
    signal: AbortSignal
  }): Promise<void> {
    const emitChunk = (partialText: string): void => {
      const payload = {
        topicId: input.topicId,
        executionId: input.executionId,
        chunk: { type: 'text-delta', text: partialText }
      }
      if (!registry.pushChunk(input.topicId, payload)) return
      deps.events?.onChunk?.(payload)
      deps.repos.messages.update(input.placeholder.id, {
        data: createAssistantTextData(partialText),
        status: 'pending'
      })
    }

    try {
      const reference = input.placeholder.modelId ? parseConfiguredModelRef(input.placeholder.modelId) : null
      const resolved = reference
        ? await resolveChatModelForRuntime(getRuntimeProviderState, reference.providerId, reference.modelId)
        : await resolveChatModelForRuntime(getRuntimeProviderState)
      if (!resolved.ok) {
        throw new ProviderRuntimeFailureError(ProviderRuntimeFailurePolicy.configurationRequired)
      }

      const topic = deps.repos.topics.getById(input.topicId)
      const branch = input.contextMode === 'latest-user-only'
        ? [input.userMessage]
        : flattenActiveBranch(deps.repos.messages.listByTopic(input.topicId), input.placeholder.id).filter(
            (message) => message.id !== input.placeholder.id && message.status === 'success'
          )
      const promptMessages = buildRuntimeMessages(input.assistant, branch, messageDataToText(input.userMessage))

      // T4/T5：协议是模型自己的事实；缺对应端点时派发前即抛 configuration-required。
      const runtimeProviders = (await getRuntimeProviderState()).providers
      const runtimeProvider = runtimeProviders.find((entry) => entry.id === resolved.model.providerId)
      const runtimeModel = runtimeProvider?.models.find((entry) => entry.id === resolved.model.modelId)
      const result = await requestAssistantChatCompletion({
        // 运行时只读模型自己的协议（同步/新增时已把供应商默认快照进去）。
        protocol: normalizeModelChatProtocol(runtimeModel?.chatProtocol),
        ...(runtimeProvider ? { endpoints: runtimeProvider.endpoints } : {}),
        baseUrl: resolved.model.baseUrl,
        apiKey: resolved.model.apiKey,
        providerId: resolved.model.providerId,
        modelId: resolved.model.modelId,
        messages: promptMessages,
        temperature: input.assistant.settings.enableTemperature ? input.assistant.settings.temperature : 0.2,
        signal: input.signal,
        fetch: deps.fetch,
        onDelta: emitChunk,
        ...createWebSearchToolRuntimeOptions({
          assistant: input.assistant,
          topicId: input.topicId,
          signal: input.signal
        })
      })

      if (!registry.isExecutionActive(input.topicId, input.executionId)) return

      invocationFailureEvidenceByMessageId.delete(input.placeholder.id)

      deps.repos.messages.update(input.placeholder.id, {
        data: createAssistantRuntimeMessageData(result.text, result.messageParts),
        status: 'success',
        stats: result.stats
      })

      const donePayload = {
        topicId: input.topicId,
        executionId: input.executionId,
        status: 'success' as const,
        isTopicDone: true
      }
      registry.finishExecution(input.topicId, input.executionId)
      deps.events?.onDone?.(donePayload)
      deps.events?.onStatus?.(registry.getSnapshot(input.topicId))
      if (topic) {
        void maybeRenameTopic({
          topic,
          userMessage: input.userMessage,
          assistantText: result.text,
          modelId: input.placeholder.modelId
        })
      }
    } catch (error) {
      if (!registry.isExecutionActive(input.topicId, input.executionId)) return
      if (isAbortError(error)) {
        const existing = deps.repos.messages.getById(input.placeholder.id)
        const partial = existing ? messageDataToText(existing) : ''
        deps.repos.messages.update(input.placeholder.id, {
          data: partial.trim()
            ? createAssistantTextData(partial)
            : createAssistantInterruptionData(),
          status: 'paused'
        })
        registry.finishExecution(input.topicId, input.executionId, { aborted: true })
        deps.events?.onDone?.({
          topicId: input.topicId,
          executionId: input.executionId,
          status: 'paused',
          isTopicDone: true
        })
        deps.events?.onStatus?.(registry.getSnapshot(input.topicId))
        return
      }

      const code = resolveProviderRuntimeFailureCode(error)
      const failureEvidence = assistantInvocationFailureEvidence(error)
      if (input.captureInvocationFailureEvidence && failureEvidence) {
        retainInvocationFailureEvidence(input.placeholder.id, failureEvidence)
      }
      deps.repos.messages.update(input.placeholder.id, {
        data: { parts: [{ type: 'error', code, message: '' }] },
        status: 'error'
      })
      registry.finishExecution(input.topicId, input.executionId, { error: true })
      deps.events?.onError?.({
        topicId: input.topicId,
        executionId: input.executionId,
        isTopicDone: true,
        error: { code, message: '' }
      })
      deps.events?.onStatus?.(registry.getSnapshot(input.topicId))
    }
  }

  function createWebSearchToolRuntimeOptions(input: {
    assistant: AssistantEntity
    topicId: string
    signal: AbortSignal
  }) {
    if (!input.assistant.settings.enableWebSearch || !deps.webSearchService) return {}
    const toolService = createAssistantWebSearchToolService(deps.webSearchService)
    const maxToolCalls = input.assistant.settings.enableMaxToolCalls
      ? input.assistant.settings.maxToolCalls
      : 6
    return {
      tools: [...assistantWebSearchTools],
      maxToolCalls,
      executeTool: async (call: AssistantToolCall) => {
        const startedAt = Date.now()
        const result = await toolService.execute(call, {
          signal: input.signal,
          consumer: {
            kind: 'assistant',
            id: input.assistant.id,
            sessionId: input.topicId
          }
        })
        if (!result.ok) {
          return {
            ok: false,
            content: JSON.stringify({ error: result.error ?? 'Web Search failed.' }),
            messagePart: createAssistantWebSearchMessagePart({
              toolName: result.name,
              status: 'error',
              sources: [],
              elapsedMs: Date.now() - startedAt,
              error: result.error
            })
          }
        }
        return {
          ok: true,
          content: JSON.stringify(result.output),
          messagePart: createAssistantWebSearchMessagePart({
            toolName: result.name,
            status: 'success',
            providerId: result.response?.providerId,
            query: result.response?.query,
            urls: result.response?.capability === 'fetchUrls' ? result.response.inputs : undefined,
            sources: result.output.map((source) => ({
              id: source.id,
              title: source.title,
              url: source.url,
              snippet: createWebSearchSnippet(source.content)
            })),
            statusItems: result.response?.status,
            elapsedMs: Date.now() - startedAt
          })
        }
      }
    }
  }

  function reconcileStalePending(): number {
    let count = 0
    const { topics } = deps.repos.topics.listByCursor({ limit: 500 })
    for (const topic of topics) {
      for (const message of deps.repos.messages.listByTopic(topic.id)) {
        if (message.status !== 'pending') continue
        deps.repos.messages.update(message.id, {
          data: { parts: [{ type: 'error', message: 'Interrupted before completion.' }] },
          status: 'error'
        })
        count += 1
      }
    }
    return count
  }

  function discardTopic(topicId: string): void {
    registry.clearTopic(topicId)
    for (const message of deps.repos.messages.listByTopic(topicId)) {
      invocationFailureEvidenceByMessageId.delete(message.id)
      if (message.status !== 'pending') continue
      deps.repos.messages.update(message.id, {
        data: createAssistantInterruptionData(),
        status: 'paused'
      })
    }
  }

  function retainInvocationFailureEvidence(messageId: string, evidence: AssistantInvocationFailureEvidence): void {
    invocationFailureEvidenceByMessageId.delete(messageId)
    invocationFailureEvidenceByMessageId.set(messageId, evidence)
    while (invocationFailureEvidenceByMessageId.size > ASSISTANT_INVOCATION_FAILURE_EVIDENCE_V1.maximumRetainedEntries) {
      const oldestMessageId = invocationFailureEvidenceByMessageId.keys().next().value
      if (!oldestMessageId) return
      invocationFailureEvidenceByMessageId.delete(oldestMessageId)
    }
  }

  function abortTopic(topicId: string): boolean {
    const result = registry.abortTopic(topicId)
    if (!result.aborted) return false
    const pendingMessageIds = new Set(result.anchorMessageIds)
    for (const message of deps.repos.messages.listByTopic(topicId)) {
      if (message.status !== 'pending') continue
      if (!pendingMessageIds.has(message.id)) continue
      deps.repos.messages.update(message.id, {
        data: messageDataToText(message).trim()
          ? createAssistantTextData(messageDataToText(message))
          : createAssistantInterruptionData(),
        status: 'paused'
      })
    }
    deps.events?.onStatus?.(registry.getSnapshot(topicId))
    return true
  }

  function applyFirstMessageTopicName(
    topic: NonNullable<ReturnType<typeof deps.repos.topics.getById>>,
    userMessage: AssistantMessageEntity
  ): void {
    const fallback =
      deps.topicNaming?.applyFirstMessageFallback(topic.name, messageDataToText(userMessage)) ??
      summarizeAssistantTopicFallback(messageDataToText(userMessage))
    if (!fallback || topic.isNameManuallyEdited) return
    deps.repos.topics.update(topic.id, { name: fallback })
  }

  async function maybeRenameTopic(input: {
    topic: NonNullable<ReturnType<typeof deps.repos.topics.getById>>
    userMessage: AssistantMessageEntity
    assistantText: string
    modelId: string | null
  }): Promise<void> {
    if (!deps.topicNaming) return
    const namingModelId = input.modelId ?? (await deps.getTopicNamingModelId?.()) ?? null
    await deps.topicNaming.maybeRenameAfterTurn({
      topicId: input.topic.id,
      topicName: input.topic.name,
      isNameManuallyEdited: input.topic.isNameManuallyEdited,
      userText: messageDataToText(input.userMessage),
      assistantText: input.assistantText,
      modelId: namingModelId
    })
  }
}

function createAssistantRuntimeMessageData(text: string, parts: AssistantMessagePart[] = []): AssistantMessageData {
  return {
    parts: [...parts, ...createAssistantTextData(text).parts]
  }
}

function buildRuntimeMessages(
  assistant: AssistantEntity,
  branch: readonly AssistantMessageEntity[],
  latestUserText: string
): ChatCompletionMessage[] {
  const messages: ChatCompletionMessage[] = []
  if (assistant.prompt.trim()) {
    messages.push({ role: 'system', content: assistant.prompt.trim() })
  }

  for (const message of branch) {
    const content = messageDataToText(message)
    if (!content) continue
    if (message.role === 'system') messages.push({ role: 'system', content })
    if (message.role === 'user') messages.push({ role: 'user', content })
    if (message.role === 'assistant') messages.push({ role: 'assistant', content })
  }

  if (messages[messages.length - 1]?.role !== 'user' || messages[messages.length - 1]?.content !== latestUserText) {
    messages.push({ role: 'user', content: latestUserText })
  }
  return messages
}

function createWebSearchSnippet(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 240)
}
