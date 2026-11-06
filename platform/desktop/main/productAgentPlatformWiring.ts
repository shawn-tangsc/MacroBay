import type { AgentPlatformServices } from '../../ai/agent-platform/services/agentServices'
import type { AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import type { AgentEntity, UpdateAgentDto } from '../../ai/agent-platform/schemas/agentSchemas'
import type {
  AgentChatRuntimeRequest,
  AgentChatRuntimeResult
} from '../../ai/agent-platform/runtime/agentChatRuntime'
import type {
  AgentSessionEntity,
  AgentSessionMessageEntity,
  CreateAgentSessionDto,
  CreateAgentSessionMessagesDto,
  UpdateAgentSessionDto
} from '../../ai/agent-platform/schemas/sessionSchemas'
import type {
  ProductAgentToolInvokeInput,
  ProductAgentToolInvokeResult
} from '../../ai/agent-platform/productTools/productAgentToolSchemas'
import type { WebSearchResponse, WebSearchSearchKeywordsRequest } from '../../ai/web-search/contracts/webSearchContracts'
import type { WebSearchService } from '../../ai/web-search/runtime/WebSearchService'

/**
 * 产品能看到的**智能体会话面**：读状态、建/改/删会话、发消息、按幂等键取一条会话，
 * 以及「缺值时按平台既定开关替产品搜一次」和「调产品自己的工具与 IPC」。
 *
 * 从 `app.ts` 抽出来有两个原因：
 * - 启动文件贴着体积基线，这一段是产品契约的形状 + 绑定，不是宿主启动流程；
 * - 这 13 个字段回答的是同一个问题（产品能给智能体做什么），和宿主自己的
 *   `register` / `jobRuntime` / `secretVault` 那些字段不是一件事，混在一个内联类型里
 *   谁也说不清边界在哪。宿主面留在 `app.ts`，两部分在调用处 `&` 起来。
 *
 * **这是受保护接缝的一部分**：字段名与方法签名就是产品的注入面，改一个名字等于改契约；
 * 抽出来只搬家，一个字段、一个行为都没有变。
 */
export type ProductAgentPlatformDeps = {
  getAgentState?: () => Promise<AgentStoreState>
  /**
   * 自动会话的幂等窄查：按「智能体 + 幂等键（这一次运行）」取一条会话，只读。
   * 产品侧唯一的按身份找会话的入口——不另开「按描述查」的口子；可选，没接时产品侧退回自己的兜底。
   */
  findAgentSessionByAutomationRef?: (agentId: string, originRef: string) => Promise<AgentSessionEntity | null>
  createAgentSession?: (input: CreateAgentSessionDto) => Promise<AgentSessionEntity>
  sendAgentMessage?: (request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  cancelAgentSession?: (sessionId: string) => Promise<void> | void
  appendAgentSessionMessages?: (input: CreateAgentSessionMessagesDto) => Promise<AgentSessionMessageEntity[]>
  updateAgentSession?: (sessionId: string, patch: UpdateAgentSessionDto) => Promise<AgentSessionEntity>
  deleteAgentSessions?: (sessionIds: string[]) => Promise<unknown>
  updateAgent?: (agentId: string, patch: UpdateAgentDto) => Promise<AgentEntity>
  isWebSearchProviderReady?: () => Promise<boolean>
  /**
   * 只读搜索入口：产品侧缺实际值时按平台既定开关/授权/代理去搜一次。
   * 只读、不写设置、不改变既有 IPC 面。
   */
  searchWeb?: (request: WebSearchSearchKeywordsRequest) => Promise<Pick<WebSearchResponse, 'results'>>
  invokeProductAgentTool?: (
    state: AgentStoreState,
    input: ProductAgentToolInvokeInput
  ) => Promise<ProductAgentToolInvokeResult>
  invokeProductIpc?: (productId: string, method: string, payload?: unknown) => Promise<unknown>
}

/** 绑定这段契约需要的东西：只列**被用到的方法**，不把整个服务的接口搬过来。 */
export type ProductAgentPlatformSource = {
  agentStore: { getState: () => Promise<AgentStoreState> }
  agentServices: AgentPlatformServices
  agentRuntimeService: {
    sendMessage: (request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
    cancelSession: (sessionId: string, options: { kind: 'runtime-stop'; message: string }) => void
  }
  webSearchService: WebSearchService
  productAgentToolRuntimeService: {
    invokeTool: (state: AgentStoreState, input: ProductAgentToolInvokeInput) => Promise<ProductAgentToolInvokeResult>
  }
  productIpcRegistry: { invoke: (productId: string, method: string, payload?: unknown) => Promise<unknown> }
  isAgentWebSearchProviderReady: () => Promise<boolean>
}

/**
 * 把上面那些服务绑成产品可调的那一面。
 *
 * 每个闭包都只做一次转发，不在这里加判断、加默认值或改参数：产品的可用与否由服务本身决定，
 * 这一层再判一次就会有两处判据。唯一带常量的一处是取消会话的停止原因，那是运行时要求的枚举。
 */
export function composeProductAgentPlatformDeps(source: ProductAgentPlatformSource): ProductAgentPlatformDeps {
  const { agentStore, agentServices, agentRuntimeService, webSearchService } = source

  return {
    getAgentState: () => agentStore.getState(),
    // 自动会话的幂等窄查：只读一条，不扫全量列表（产品侧靠它把「同一次运行一条会话」做成 O(1)）。
    findAgentSessionByAutomationRef: (agentId, originRef) =>
      agentServices.sessions.findByAutomationRef(agentId, originRef),
    createAgentSession: (input) => agentServices.sessions.create(input),
    sendAgentMessage: (request) => agentRuntimeService.sendMessage(request),
    cancelAgentSession: (sessionId) => {
      agentRuntimeService.cancelSession(sessionId, { kind: 'runtime-stop', message: 'daily-brief-deadline' })
    },
    appendAgentSessionMessages: (input) => agentServices.messages.saveMessages(input),
    updateAgentSession: (sessionId, patch) => agentServices.sessions.update(sessionId, patch),
    deleteAgentSessions: (sessionIds) => agentServices.sessions.deleteByIds(sessionIds),
    updateAgent: (agentId, patch) => agentServices.agents.update(agentId, patch),
    isWebSearchProviderReady: source.isAgentWebSearchProviderReady,
    searchWeb: (request) => webSearchService.searchKeywords(request),
    invokeProductAgentTool: (state, input) => source.productAgentToolRuntimeService.invokeTool(state, input),
    invokeProductIpc: (productId, method, payload) => source.productIpcRegistry.invoke(productId, method, payload)
  }
}
