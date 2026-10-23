import type { AssistantPlatformRepositories } from '../repositories/createAssistantPlatformRepositories'
import type { AssistantTopicNamingService } from '../naming/AssistantTopicNamingService'
import type {
  AssistantStreamChunkPayload,
  AssistantStreamDonePayload,
  AssistantStreamErrorPayload,
  AssistantStreamOpenRequest,
  AssistantStreamOpenResponse,
  AssistantTopicStreamSnapshot
} from '../schemas/streamSchemas'
import type { ProviderStateAccessor } from '../../providers/modelProviderTypes'
import type { WebSearchService } from '../../web-search/runtime/WebSearchService'
import type { AssistantInvocationFailureEvidence } from './assistantInvocationFailureEvidence'

export type AssistantChatRuntimeEventSink = {
  onChunk?: (payload: AssistantStreamChunkPayload) => void
  onStatus?: (snapshot: AssistantTopicStreamSnapshot) => void
  onDone?: (payload: AssistantStreamDonePayload) => void
  onError?: (payload: AssistantStreamErrorPayload) => void
}

export type AssistantChatRuntimeDependencies = {
  repos: AssistantPlatformRepositories
  getProviderState: ProviderStateAccessor
  fetch?: typeof fetch
  events?: AssistantChatRuntimeEventSink
  now?: () => Date
  topicNaming?: AssistantTopicNamingService
  getTopicNamingModelId?: () => Promise<string | null>
  /**
   * 模型服务页「默认助手模型」（`settings.modelDefaults.assistantModelId`）。
   * 只在助手**没有显式绑定模型**时读取；显式绑定永远优先。
   */
  getDefaultAssistantModelId?: () => Promise<string | null> | string | null
  webSearchService?: WebSearchService
}

export type AssistantChatRuntimeService = {
  open: (request: AssistantStreamOpenRequest) => Promise<AssistantStreamOpenResponse>
  attach: (topicId: string) => {
    snapshot: AssistantTopicStreamSnapshot
    bufferedChunks: AssistantStreamChunkPayload[]
  }
  abort: (topicId: string) => boolean
  discardTopic: (topicId: string) => void
  getStatus: (topicId: string) => AssistantTopicStreamSnapshot
  consumeInvocationFailureEvidence?: (messageId: string) => AssistantInvocationFailureEvidence | undefined
  reconcileStalePending: () => number
}
