import type { AppLanguage } from '../../../settings/schema/appSettings'
import type { AssistantLibraryService } from '../library/AssistantLibraryService'
import type { AssistantTemplateCatalogItem } from '../library/assistantTemplateSchemas'
import type { AssistantPlatformRepositories } from '../repositories/createAssistantPlatformRepositories'
import type { AssistantTopicPruneResult } from '../repositories/messageRepository'
import { extractAssistantSearchableText } from '../schemas/messageSchemas'
import type { AssistantChatRuntimeService } from '../runtime/assistantChatRuntimeTypes'
import type { ProviderState } from '../../providers/modelProviderTypes'
import { resolveChatModel } from '../../invocation/resolveChatModel'
import { resolveConfiguredModelId } from '../../model-defaults/configuredDefaultModel'
import type { AssistantInvocationFailureEvidence } from '../runtime/assistantInvocationFailureEvidence'

export type AssistantProgrammaticInvocationMetadata = {
  productId?: string
  feature?: string
  scopeKey?: string
  asOf?: string
} & Record<string, unknown>

export type AssistantProgrammaticInvocationClient = {
  ensureInstalledAssistantByTemplate(input: {
    sourceProductId?: string
    templateId: string
    language?: AppLanguage
  }): Promise<{ assistantId: string }>
  ensureTopic(input: {
    assistantId: string
    externalRef: string
    name: string
    groupId?: string
  }): Promise<{ topicId: string }>
  listOwnedTopics?(input: {
    sourceProductId: string
    templateId: string
    groupId: string
  }): Promise<Array<{ topicId: string }>>
  invoke(input: {
    assistantId: string
    topicId: string
    userMessage: string
    metadata?: AssistantProgrammaticInvocationMetadata
    responseMode: 'complete'
    /** Optional caller wait window; the service-level window applies when omitted or unusable. */
    timeoutMs?: number
  }): Promise<{
    topicId: string
    userMessageId: string
    assistantMessageId: string
    text: string
    modelId?: string | null
    modelProviderId?: string | null
    generatedAt: number
  }>
  pruneTopicHistory?(input: { topicId: string; latestTurns: number }): Promise<AssistantTopicPruneResult>
  resolveAssistantModelId?(assistantId: string): Promise<string | null>
}

export class AssistantProgrammaticInvocationFailureError extends Error {
  readonly evidence?: AssistantInvocationFailureEvidence

  constructor(code: string, evidence?: AssistantInvocationFailureEvidence) {
    super(code)
    this.name = 'AssistantProgrammaticInvocationFailureError'
    this.evidence = evidence
  }
}

/**
 * The caller stopped waiting for a still-running generation. This is a wait-window
 * outcome, not a transport failure, so consumers must not treat it as a retryable
 * network error or read the evidence-free message as a provider fault.
 */
export const ASSISTANT_PROGRAMMATIC_INVOCATION_TIMEOUT_MESSAGE = 'Assistant invocation timed out.'

export class AssistantProgrammaticInvocationTimeoutError extends Error {
  constructor() {
    super(ASSISTANT_PROGRAMMATIC_INVOCATION_TIMEOUT_MESSAGE)
    this.name = 'AssistantProgrammaticInvocationTimeoutError'
  }
}

export function assistantProgrammaticInvocationTimeoutError(): Error {
  return new AssistantProgrammaticInvocationTimeoutError()
}

type AssistantProgrammaticInvocationServiceDependencies = {
  library: Pick<AssistantLibraryService, 'listTemplates' | 'installTemplate'>
  repos: Pick<AssistantPlatformRepositories, 'assistants' | 'topics' | 'messages'>
  runtime: AssistantChatRuntimeService
  getProviderState?: () => Promise<ProviderState>
  /** 模型服务页「默认助手模型」；助手未绑定模型时使用。 */
  getDefaultAssistantModelId?: () => Promise<string | null> | string | null
  pollIntervalMs?: number
  timeoutMs?: number
  now?: () => number
}

export class AssistantProgrammaticInvocationService implements AssistantProgrammaticInvocationClient {
  private readonly library: AssistantProgrammaticInvocationServiceDependencies['library']
  private readonly repos: AssistantProgrammaticInvocationServiceDependencies['repos']
  private readonly runtime: AssistantChatRuntimeService
  private readonly getProviderState?: () => Promise<ProviderState>
  private readonly getDefaultAssistantModelId?: () => Promise<string | null> | string | null
  private readonly pollIntervalMs: number
  private readonly timeoutMs: number
  private readonly now: () => number

  constructor(deps: AssistantProgrammaticInvocationServiceDependencies) {
    this.library = deps.library
    this.repos = deps.repos
    this.runtime = deps.runtime
    this.getProviderState = deps.getProviderState
    this.getDefaultAssistantModelId = deps.getDefaultAssistantModelId
    this.pollIntervalMs = deps.pollIntervalMs ?? 100
    this.timeoutMs = deps.timeoutMs ?? 60_000
    this.now = deps.now ?? Date.now
  }

  async ensureInstalledAssistantByTemplate(input: {
    sourceProductId?: string
    templateId: string
    language?: AppLanguage
  }): Promise<{ assistantId: string }> {
    const templateId = normalizeTemplateId(input)
    const template = this.findTemplate(templateId)
    if (!template) throw new Error(`Assistant template not found: ${templateId}`)

    if (template.installedAssistantId) {
      const assistant = this.repos.assistants.getById(template.installedAssistantId)
      if (assistant) return { assistantId: assistant.id }
    }

    const installed = this.library.installTemplate({ templateId }, input.language ?? 'zh-CN')
    return { assistantId: installed.assistant.id }
  }

  async ensureTopic(input: {
    assistantId: string
    externalRef: string
    name: string
    groupId?: string
  }): Promise<{ topicId: string }> {
    const existing = this.findTopicByTraceId(input.assistantId, input.externalRef)
    if (existing) {
      if (existing.name !== input.name) {
        this.repos.topics.update(existing.id, {
          name: input.name,
          isNameManuallyEdited: true
        })
      }
      return { topicId: existing.id }
    }

    const created = this.repos.topics.create({
      assistantId: input.assistantId,
      name: input.name,
      isNameManuallyEdited: true,
      groupId: input.groupId,
      traceId: input.externalRef
    })
    return { topicId: created.id }
  }

  async listOwnedTopics(input: {
    sourceProductId: string
    templateId: string
    groupId: string
  }): Promise<Array<{ topicId: string }>> {
    return this.repos.topics.listByProductTemplateAndGroup(input).map((topic) => ({ topicId: topic.id }))
  }

  async invoke(input: {
    assistantId: string
    topicId: string
    userMessage: string
    metadata?: AssistantProgrammaticInvocationMetadata
    responseMode: 'complete'
    timeoutMs?: number
  }): Promise<{
    topicId: string
    userMessageId: string
    assistantMessageId: string
    text: string
    modelId?: string | null
    modelProviderId?: string | null
    generatedAt: number
  }> {
    if (input.responseMode !== 'complete') {
      throw new Error(`Unsupported assistant invocation response mode: ${input.responseMode}`)
    }

    const opened = await this.runtime.open({
      assistantId: input.assistantId,
      topicId: input.topicId,
      trigger: 'submit-message',
      contextMode: 'latest-user-only',
      userMessageParts: [{ type: 'text', text: input.userMessage }]
    })
    if (opened.mode !== 'started' || !opened.userMessageId || !opened.placeholderIds?.length) {
      throw new Error(opened.message ?? 'Assistant invocation did not start.')
    }

    const assistantMessage = await this.waitForAssistantMessage(
      opened.placeholderIds[0]!,
      input.timeoutMs
    )
    const text = extractAssistantSearchableText(assistantMessage.data)
    if (!text.trim()) throw new Error('Assistant invocation completed without text.')

    return {
      topicId: input.topicId,
      userMessageId: opened.userMessageId,
      assistantMessageId: assistantMessage.id,
      text,
      modelId: assistantMessage.modelId,
      modelProviderId: parseProviderId(assistantMessage.modelId),
      generatedAt: this.now()
    }
  }

  async resolveAssistantModelId(assistantId: string): Promise<string | null> {
    const assistantModelId = this.repos.assistants.getById(assistantId)?.modelId ?? null
    if (assistantModelId) return assistantModelId
    if (!this.getProviderState) return null

    const providerState = await this.getProviderState()
    const configuredDefault = await this.getDefaultAssistantModelId?.()
    const defaultModelId = resolveConfiguredModelId({
      value: configuredDefault,
      providers: providerState.providers,
      isModelAcceptable: (_provider, model) => model.capabilities.chat === true
    })
    if (defaultModelId) return defaultModelId

    const resolved = resolveChatModel(providerState)
    if (!resolved.ok) return null
    return `${resolved.model.providerId}:${resolved.model.modelId}`
  }

  async pruneTopicHistory(input: { topicId: string; latestTurns: number }): Promise<AssistantTopicPruneResult> {
    return this.repos.messages.pruneTopicToLatestTurns(input.topicId, input.latestTurns)
  }

  private findTemplate(templateId: string): AssistantTemplateCatalogItem | null {
    return this.library.listTemplates({}, 'zh-CN').find((template) => template.templateId === templateId) ?? null
  }

  private findTopicByTraceId(assistantId: string, externalRef: string) {
    let cursor: string | undefined
    do {
      const page = this.repos.topics.listByCursor({
        assistantId,
        cursor,
        limit: 200,
        pinnedFirst: false
      })
      const match = page.topics.find((topic) => topic.traceId === externalRef)
      if (match) return match
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return null
  }

  private async waitForAssistantMessage(messageId: string, requestedTimeoutMs?: number) {
    const startedAt = this.now()
    const waitMs = Number.isFinite(requestedTimeoutMs) && (requestedTimeoutMs as number) > 0
      ? (requestedTimeoutMs as number)
      : this.timeoutMs
    while (this.now() - startedAt <= waitMs) {
      const message = this.repos.messages.getById(messageId)
      if (message?.status === 'success') return message
      if (message?.status === 'error') {
        const code = programmaticFailureCode(message.data) ?? 'Assistant invocation failed.'
        throw new AssistantProgrammaticInvocationFailureError(
          code,
          this.runtime.consumeInvocationFailureEvidence?.(messageId)
        )
      }
      if (message?.status === 'paused') throw new Error('Assistant invocation paused.')
      await sleep(this.pollIntervalMs)
    }
    throw assistantProgrammaticInvocationTimeoutError()
  }
}

const PROGRAMMATIC_PROVIDER_FAILURE_CODES = new Set<string>([
  'provider-configuration-required',
  'provider-request-failed',
  // PLAT-74：模型生命周期结论同样是"这次请求失败了"，且要原样交给调用方。
  'provider-model-retired',
  'provider-model-not-activated',
  'provider-model-not-found'
])

function programmaticFailureCode(data: { parts: Array<{ type: string; code?: unknown }> }): string | null {
  for (const part of data.parts) {
    if (part.type !== 'error' || typeof part.code !== 'string') continue
    if (PROGRAMMATIC_PROVIDER_FAILURE_CODES.has(part.code)) return part.code
  }
  return null
}

function normalizeTemplateId(input: { sourceProductId?: string; templateId: string }): string {
  if (input.templateId.includes(':')) return input.templateId
  if (input.sourceProductId) return `product:${input.sourceProductId}:${input.templateId}`
  return input.templateId
}

function parseProviderId(modelId: string | null): string | null {
  if (!modelId) return null
  const separatorIndex = modelId.indexOf(':')
  if (separatorIndex <= 0) return null
  return modelId.slice(0, separatorIndex)
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}
