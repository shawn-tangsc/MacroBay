import type { AssistantPlatformRepositories } from '../../ai/assistant-platform/repositories/createAssistantPlatformRepositories'
import type { CreateAssistantDto, UpdateAssistantDto } from '../../ai/assistant-platform/schemas/assistantSchemas'
import type {
  AssistantTemplateListQuery,
  InstallAssistantTemplateRequest
} from '../../ai/assistant-platform/library/assistantTemplateSchemas'
import type { AssistantLibraryService } from '../../ai/assistant-platform/library/AssistantLibraryService'
import type { AppLanguage } from '../../settings/schema/appSettings'
import type {
  AssistantStreamOpenRequest,
  AssistantStreamOpenResponse
} from '../../ai/assistant-platform/schemas/streamSchemas'
import type { CreateAssistantTopicDto, AssistantTopicListQuery, UpdateAssistantTopicDto } from '../../ai/assistant-platform/schemas/topicSchemas'
import type {
  CreateAssistantSiblingDto,
  AssistantMessagePart,
  DeleteAssistantMessageOptions
} from '../../ai/assistant-platform/schemas/messageSchemas'
import type { AssistantChatRuntimeService } from '../../ai/assistant-platform/runtime/assistantChatRuntimeTypes'

export function createAssistantIpcHandlers(
  repos: AssistantPlatformRepositories,
  runtime: AssistantChatRuntimeService,
  library?: AssistantLibraryService
) {
  return {
    listAssistants: () => repos.assistants.list(),
    getAssistant: (assistantId: string) => repos.assistants.getById(assistantId),
    createAssistant: (input: CreateAssistantDto) => repos.assistants.create(input),
    updateAssistant: (assistantId: string, patch: UpdateAssistantDto) => repos.assistants.update(assistantId, patch),
    deleteAssistant: (assistantId: string) => repos.assistants.delete(assistantId),
    reorderAssistants: (orderedIds: string[]) => repos.assistants.reorder(orderedIds),
    listAssistantTemplates: (query?: AssistantTemplateListQuery, language?: AppLanguage) =>
      requireAssistantLibrary(library).listTemplates(query, language),
    getAssistantTemplate: (templateId: string, language?: AppLanguage) =>
      requireAssistantLibrary(library).getTemplate(templateId, language),
    installAssistantTemplate: (input: InstallAssistantTemplateRequest, language?: AppLanguage) =>
      requireAssistantLibrary(library).installTemplate(input, language),
    listAssistantTemplateGroups: (language?: AppLanguage) =>
      requireAssistantLibrary(library).listGroups(language),
    createAssistantFromLibrary: (input: CreateAssistantDto) =>
      Promise.resolve(requireAssistantLibrary(library).createAssistant(input)),
    listTopics: (query?: AssistantTopicListQuery) => repos.topics.listByCursor(query),
    createTopic: (input: CreateAssistantTopicDto) => repos.topics.create(input),
    updateTopic: (topicId: string, patch: UpdateAssistantTopicDto) => repos.topics.update(topicId, patch),
    deleteTopic: (topicId: unknown) => {
      const normalizedTopicId = normalizeEntityId(topicId)
      if (!normalizedTopicId || !repos.topics.getById(normalizedTopicId)) return false
      runtime.abort(normalizedTopicId)
      const deleted = repos.topics.delete(normalizedTopicId)
      if (deleted) runtime.discardTopic(normalizedTopicId)
      return deleted
    },
    pinTopic: (topicId: string) => {
      repos.topics.pin(topicId)
      return repos.topics.getById(topicId)
    },
    unpinTopic: (topicId: string) => {
      repos.topics.unpin(topicId)
      return repos.topics.getById(topicId)
    },
    setActiveNode: (topicId: string, nodeId: string | null) => repos.topics.setActiveNode(topicId, nodeId),
    renameTopic: (topicId: string, name: string, isNameManuallyEdited = true) =>
      repos.topics.update(topicId, { name, isNameManuallyEdited }),
    listTopicMessages: (topicId: string, nodeId?: string | null) =>
      repos.messages.getBranchMessages(topicId, nodeId),
    createMessageSibling: (messageId: string, dto: CreateAssistantSiblingDto) =>
      repos.messages.createSibling(messageId, dto),
    editAndResendUserMessage: async (input: {
      topicId: string
      messageId: string
      parts: AssistantMessagePart[]
      assistantId?: string
      mentionedModelIds?: string[]
    }) => {
      const source = repos.messages.getById(input.messageId)
      if (!source || source.topicId !== input.topicId || source.role !== 'user') {
        throw new Error('Edit and resend requires a valid user message.')
      }
      const sibling = repos.messages.createSibling(input.messageId, {
        data: { parts: input.parts },
        status: 'success'
      })
      return runtime.open({
        topicId: input.topicId,
        assistantId: input.assistantId,
        mentionedModelIds: input.mentionedModelIds,
        trigger: 'resend-user-message',
        userMessageId: sibling.id
      })
    },
    deleteMessage: (messageId: unknown, options?: DeleteAssistantMessageOptions) => {
      const normalizedMessageId = normalizeEntityId(messageId)
      if (!normalizedMessageId) return false
      const message = repos.messages.getById(normalizedMessageId)
      if (!message) return false
      runtime.abort(message.topicId)
      const deleted = repos.messages.delete(normalizedMessageId, options)
      if (deleted) runtime.discardTopic(message.topicId)
      return deleted
    },
    clearTopicMessages: (topicId: unknown) => {
      const normalizedTopicId = normalizeEntityId(topicId)
      if (!normalizedTopicId || !repos.topics.getById(normalizedTopicId)) return 0
      runtime.abort(normalizedTopicId)
      const cleared = repos.messages.clearByTopic(normalizedTopicId)
      runtime.discardTopic(normalizedTopicId)
      return cleared
    },
    searchTopicMessages: (topicId: string, query: string, limit?: number) =>
      repos.messages.searchInTopic(topicId, query, limit),
    streamOpen: (request: AssistantStreamOpenRequest): Promise<AssistantStreamOpenResponse> => runtime.open(request),
    streamAttach: (topicId: string) => runtime.attach(topicId),
    streamAbort: (topicId: string) => runtime.abort(topicId),
    streamGetStatus: (topicId: string) => runtime.getStatus(topicId)
  }
}

export type AssistantIpcHandlers = ReturnType<typeof createAssistantIpcHandlers>

function requireAssistantLibrary(library?: AssistantLibraryService): AssistantLibraryService {
  if (!library) throw new Error('Assistant library service is not available.')
  return library
}

function normalizeEntityId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
