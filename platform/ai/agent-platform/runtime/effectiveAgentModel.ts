import { isAgentCompatibleModel } from '../agents/agentModelCompatibility'
import type { AgentEntity, AgentType, UniqueModelId } from '../schemas/agentSchemas'
import type { ProviderStateAccessor } from '../../providers/modelProviderTypes'
import {
  resolveConfiguredModel,
  type ResolvableProvider
} from '../../model-defaults/configuredDefaultModel'

/**
 * 智能体的「实际使用模型」= 显式绑定的模型，否则模型服务里的「默认智能体模型」。
 *
 * 唯一实现：`AgentRuntimeCompositionService`（生产链路）与 `agentChatRuntime`
 * （chat-completions 链路）都从这里取，不各自推导。
 *
 * 语义与助手一致：显式绑定永远优先；默认值不可用（供应商停用 / 未连接 / 模型下线 /
 * 不满足 claude-code 兼容）时返回 null，由调用方保留原有报错，绝不静默换成别的模型。
 */
export type EffectiveAgentModel = {
  model: UniqueModelId
  modelName: string
}

export const UNCONFIGURED_AGENT_MODEL_PREFIX = 'unconfigured:'

export function isUnconfiguredAgentModel(modelId: string | null | undefined): boolean {
  return Boolean(modelId?.trim().startsWith(UNCONFIGURED_AGENT_MODEL_PREFIX))
}

/**
 * 纯函数版：把「默认智能体模型」解析成一个可用的 `providerId:modelId`。
 * 主进程运行期与渲染层状态判断都用它，保证"UI 说能用"和"真的能用"一致。
 */
export function resolveConfiguredAgentModel(input: {
  providers: readonly ResolvableProvider[]
  configuredDefaultModelId?: string | null
  agentType: AgentType | string | undefined
}):
  | { ok: true; model: UniqueModelId; modelName: string }
  | { ok: false; reason: string } {
  const resolved = resolveConfiguredModel({
    value: input.configuredDefaultModelId,
    providers: input.providers,
    // 凭据/启用状态由 `resolveConfiguredModel` 统一判断；这里只看 claude-code 能力与端点。
    isModelAcceptable: (provider, model) =>
      isAgentCompatibleModel(provider, model, input.agentType, { requireReadyProvider: false })
  })
  if (!resolved.ok) return resolved
  return {
    ok: true,
    model: `${resolved.ref.providerId}:${resolved.ref.modelId}` as UniqueModelId,
    modelName: `${resolved.providerName} / ${resolved.modelName}`
  }
}

export async function resolveEffectiveAgentModel(input: {
  agent: Pick<AgentEntity, 'model' | 'modelName' | 'type'>
  getProviderState: ProviderStateAccessor
  /** 模型服务页「默认智能体模型」（`settings.modelDefaults.agentModelId`）。 */
  getConfiguredDefaultModelId?: () => Promise<string | null> | string | null
}): Promise<EffectiveAgentModel | null> {
  const boundModelId = input.agent.model?.trim() ?? ''
  if (boundModelId && !isUnconfiguredAgentModel(boundModelId)) {
    return {
      model: boundModelId as UniqueModelId,
      modelName: input.agent.modelName?.trim() || boundModelId
    }
  }

  const configuredDefault = await input.getConfiguredDefaultModelId?.()
  const providerState = await input.getProviderState()
  const resolved = resolveConfiguredAgentModel({
    providers: providerState.providers,
    configuredDefaultModelId: configuredDefault,
    agentType: input.agent.type
  })
  if (!resolved.ok) return null
  return { model: resolved.model, modelName: resolved.modelName }
}
