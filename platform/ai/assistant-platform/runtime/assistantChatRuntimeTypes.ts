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
import type { AssistantContextPlanSummary } from './assistantContextPlan'

export type AssistantChatRuntimeEventSink = {
  onChunk?: (payload: AssistantStreamChunkPayload) => void
  onStatus?: (snapshot: AssistantTopicStreamSnapshot) => void
  onDone?: (payload: AssistantStreamDonePayload) => void
  onError?: (payload: AssistantStreamErrorPayload) => void
}

export type AssistantChatRuntimeDependencies = {
  /** 凭据判定信号（进程级依赖，由组合根注入一次）；不注入时行为与之前完全一致。 */
  onProviderCredentialSignal?: (input: { providerId: string; state: 'ok' | 'invalid' }) => void
  repos: AssistantPlatformRepositories
  getProviderState: ProviderStateAccessor
  /** 出网通道，必传；由组合根注入 `platformFetch`。 */
  fetch: typeof fetch
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
  /**
   * 每次发请求前把「这次发出去多少、窗口是哪来的」交给调用方记一行。
   * 存在的理由：`budgetSource: 'fallback'` 必须有一个真实出口，否则它就是一个没人读的预留字段。
   */
  logContextPlan?: (summary: AssistantContextPlanSummary) => void
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
