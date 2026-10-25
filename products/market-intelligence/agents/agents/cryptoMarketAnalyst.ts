import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import { isAgentCompatibleModel } from '@platform/ai/agent-platform/agents/agentModelCompatibility'
import type { AgentStoreSeed } from '@platform/ai/agent-platform/store/agentStore'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

const CREATED_AT = '2026-01-01T00:00:00.000Z'
const AGENT_ID = 'crypto-market-analyst'

type CryptoMarketAnalystCopy = {
  name: string
  description: string
  instructions: string
}

/** 内置产品 Agent 文案：唯一一份，种子与语言对齐都从这里读。 */
const agentCopy: Record<AppLanguage, CryptoMarketAnalystCopy> = {
  'zh-CN': {
    name: '数字货币市场解读员',
    description: '基于可追溯市场证据生成条件式分析。',
    instructions:
      '你是数字货币市场解读员。只基于可追溯证据，明确区分事实、假设、条件与不确定性，不给出无条件买卖建议。上下文缺失时，先说明缺口，再按 Skill 使用 WebSearch/WebFetch 做受控补查；补查结果必须带来源和时间边界，不能改写历史分析快照。'
  },
  'en-US': {
    name: 'Crypto Market Analyst',
    description: 'Generates conditional analysis from traceable market evidence.',
    instructions:
      'You are a crypto market analyst. Work only from traceable evidence, and always separate facts, hypotheses, conditions, and uncertainty. Never give unconditional buy or sell advice. When context is missing, state the gap first, then use WebSearch/WebFetch through the Skill for controlled follow-up; every follow-up result must carry its source and time boundary and must not rewrite historical analysis snapshots.'
  }
}

const unconfiguredModelName: Record<AppLanguage, string> = {
  'zh-CN': '未选择模型',
  'en-US': 'No model selected'
}

export type CreateProductAgentSeedOptions = {
  language?: AppLanguage
}

export function createProductAgentSeed(
  providers: SafeModelProvider[] = [],
  options: CreateProductAgentSeedOptions = {}
): AgentStoreSeed {
  return createCryptoMarketAnalystAgentSeed(providers, options)
}

export function createCryptoMarketAnalystAgentSeed(
  providers: SafeModelProvider[] = [],
  options: CreateProductAgentSeedOptions = {}
): AgentStoreSeed {
  const language = resolveLanguage(options.language)
  const copy = agentCopy[language]
  const model = resolveDefaultModel(providers, language)
  const agent: AgentEntity = {
    id: AGENT_ID,
    type: 'claude-code',
    name: copy.name,
    description: copy.description,
    instructions: copy.instructions,
    model: model.id,
    modelName: model.name,
    mcps: [],
    disabledTools: [],
    configuration: {
      avatar: '₿',
      permission_mode: 'plan',
      max_turns: 80,
      heartbeat_enabled: false,
      productId: 'market-intelligence',
      dataAccessProfileId: 'crypto-market-analysis-v1',
      configProfileId: 'crypto-market-analyst-default-v1'
    },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    orderKey: '0100'
  }
  return {
    agents: [agent],
    sessions: [],
    messagesBySessionId: {},
    workspaces: [],
    agentSkills: [
      { agentId: AGENT_ID, skillId: 'market-analysis-skill-v1', isEnabled: true },
      { agentId: AGENT_ID, skillId: 'intelligence-ops-skill-v1', isEnabled: true }
    ],
    agentProductToolPackages: [
      {
        agentId: AGENT_ID,
        productId: 'market-intelligence',
        permissionMode: 'allow-read-only',
        updatedAt: CREATED_AT
      }
    ]
  }
}

function resolveLanguage(language: AppLanguage | undefined): AppLanguage {
  return language === 'en-US' ? 'en-US' : 'zh-CN'
}

function resolveDefaultModel(
  providers: SafeModelProvider[],
  language: AppLanguage
): { id: string; name: string } {
  const unconfigured = { id: 'unconfigured:default-chat-model', name: unconfiguredModelName[language] }
  const provider = providers.find((candidate) => candidate.enabled && candidate.models.some((model) => isAgentCompatibleModel(candidate, model, 'claude-code', { requireReadyProvider: true })))
  if (!provider) return unconfigured
  const compatible = (candidate: SafeModelProvider['models'][number]) => isAgentCompatibleModel(provider, candidate, 'claude-code', { requireReadyProvider: true })
  const model = provider.models.find((candidate) => candidate.id === provider.defaultChatModelId && compatible(candidate))
    ?? provider.models.find(compatible)
  return model ? { id: `${provider.id}:${model.id}`, name: `${provider.name} / ${model.name}` } : unconfigured
}
