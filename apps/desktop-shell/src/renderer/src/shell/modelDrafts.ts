import type {
  ModelCapabilities,
  ModelChatProtocol,
  ModelDeclarationSource,
  ModelDefinition,
  ModelMessagesSupport,
  ModelPricing
} from '@platform/ai/providers/modelProviderTypes'
import { resolveModelCapabilities } from '@platform/ai/providers/modelCapabilityInference'
import { withModelPriceTag } from '@platform/ai/providers/modelPriceTag'

export type ModelDraft = {
  id: string
  name: string
  group?: string
  provider?: string
  capabilities: ModelCapabilities
  /** T4/T5：模型级聊天协议；缺省 = chat/completions。 */
  chatProtocol?: ModelChatProtocol
  /** 用户手动标记免费（只存 true）；随草稿往返，保存后选择器筛选可见。 */
  freeOverride?: boolean
  /**
   * 抽屉不编辑价格/上下文，但必须**原样带回**：保存时若丢掉 `pricing`，
   * 价格推导出来的「免费」状态与价格展示会一起消失。
   */
  pricing?: ModelPricing
  contextLength?: number
  maxCompletionTokens?: number
  /**
   * PLAT-82：厂商声明必须随草稿往返 —— 抽屉只编辑能力/协议，不能把
   * `messagesSupport` / `responsesSupport` / `declarationSource` / `supportedProtocols` 弄丢。
   */
  messagesSupport?: ModelMessagesSupport
  responsesSupport?: ModelMessagesSupport
  declarationSource?: ModelDeclarationSource
  supportedProtocols?: ModelChatProtocol[]
  declaredProtocols?: ModelChatProtocol[]
  /** PLAT-82：检测证据（实测通过的协议）同样必须随草稿往返，编辑不能把它抹掉。 */
  probedProtocols?: ModelChatProtocol[]
}

function declarationFieldsOf(model: ModelDefinition): Pick<
  ModelDraft,
  'messagesSupport' | 'responsesSupport' | 'declarationSource' | 'supportedProtocols' | 'declaredProtocols' | 'probedProtocols'
> {
  return {
    ...(model.messagesSupport ? { messagesSupport: model.messagesSupport } : {}),
    ...(model.responsesSupport ? { responsesSupport: model.responsesSupport } : {}),
    ...(model.declarationSource ? { declarationSource: model.declarationSource } : {}),
    ...(model.supportedProtocols?.length ? { supportedProtocols: [...model.supportedProtocols] } : {}),
    ...(model.declaredProtocols?.length ? { declaredProtocols: [...model.declaredProtocols] } : {}),
    ...(model.probedProtocols?.length ? { probedProtocols: [...model.probedProtocols] } : {})
  }
}

export function createEmptyModelDraft(): ModelDraft {
  return {
    id: '',
    name: '',
    capabilities: {
      chat: true,
      vision: false,
      embedding: false,
      tools: true
    }
  }
}

export function createModelDraftFromModel(model: ModelDefinition): ModelDraft {
  return {
    id: model.id,
    name: model.name,
    group: model.group,
    provider: model.provider,
    ...(model.chatProtocol ? { chatProtocol: model.chatProtocol } : {}),
    ...(model.freeOverride === true ? { freeOverride: true } : {}),
    ...(model.pricing ? { pricing: { ...model.pricing } } : {}),
    ...(model.contextLength === undefined ? {} : { contextLength: model.contextLength }),
    ...(model.maxCompletionTokens === undefined ? {} : { maxCompletionTokens: model.maxCompletionTokens }),
    ...declarationFieldsOf(model),
    capabilities: {
      ...resolveModelCapabilities(model),
      agentRuntimes: model.capabilities.agentRuntimes ? { ...model.capabilities.agentRuntimes } : undefined
    }
  }
}

export function buildModelDefinitionFromDraft(draft: ModelDraft): ModelDefinition {
  return withModelPriceTag({
    id: draft.id,
    name: draft.name,
    group: draft.group,
    provider: draft.provider,
    ...(draft.chatProtocol ? { chatProtocol: draft.chatProtocol } : {}),
    ...(draft.freeOverride === true ? { freeOverride: true } : {}),
    ...(draft.pricing ? { pricing: { ...draft.pricing } } : {}),
    ...(draft.contextLength === undefined ? {} : { contextLength: draft.contextLength }),
    ...(draft.maxCompletionTokens === undefined ? {} : { maxCompletionTokens: draft.maxCompletionTokens }),
    ...(draft.messagesSupport ? { messagesSupport: draft.messagesSupport } : {}),
    ...(draft.responsesSupport ? { responsesSupport: draft.responsesSupport } : {}),
    ...(draft.declarationSource ? { declarationSource: draft.declarationSource } : {}),
    ...(draft.supportedProtocols?.length ? { supportedProtocols: [...draft.supportedProtocols] } : {}),
    ...(draft.declaredProtocols?.length ? { declaredProtocols: [...draft.declaredProtocols] } : {}),
    ...(draft.probedProtocols?.length ? { probedProtocols: [...draft.probedProtocols] } : {}),
    capabilities: {
      ...draft.capabilities,
      agentRuntimes: draft.capabilities.agentRuntimes ? { ...draft.capabilities.agentRuntimes } : undefined
    }
  })
}
