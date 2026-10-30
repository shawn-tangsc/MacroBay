import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import { isAgentCompatibleModel } from '@platform/ai/agent-platform/agents/agentModelCompatibility'
import type { AgentStoreSeed } from '@platform/ai/agent-platform/store/agentStore'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

const CREATED_AT = '2026-01-01T00:00:00.000Z'
const AGENT_ID = 'daily-brief-editor'

const copy: Record<AppLanguage, { name: string; description: string; instructions: string }> = {
  'zh-CN': {
    name: '每日简报编辑',
    description: '以数字货币交易分析师视角决定日报候选可见性，写事件优先的导语与 why。',
    instructions: '你是每日简报主编兼数字货币交易分析师。事实、数字和已发布结论不可变。对候选宏观事件和舆情逐条判断是否展示；只给值得展示的内容写 why。导语围绕当天最重要的事件或矛盾，使用事件冲击、预期差、矛盾张力、资金/价格结构、日程前瞻、单点异常或证伪/反问中的一种。缺少高影响事件结论时，按 Skill 用 WebSearch/WebFetch 受控补查，结果必须带来源、时间和 08:00 cutoff；不得覆盖本地官方 actual，搜不到就写“结论未收录”。不给买卖建议、目标价或必涨必跌。最终没有合格输出就明确失败，不把事实层快照当日报。'
  },
  'en-US': {
    name: 'Daily Brief Editor',
    description: 'Decides which daily-brief candidates are worth showing and writes event-first copy as a crypto trading analyst.',
    instructions: 'You are the editor and crypto trading analyst for the daily brief. Facts, numbers and published conclusions are immutable. Decide show/hide for every candidate macro event and story; write why only for shown items. Lead the lede with the dominant event or tension, using one of: event shock, surprise gap, opposing forces, structure, setup, outlier, falsification. When a high-impact conclusion is missing, use WebSearch/WebFetch through the Skill with source, time and the 08:00 cutoff; never override a local official actual, and write “conclusion not available” when no reliable source exists. No trade advice, price targets or guaranteed moves. If no accepted output is produced, fail the brief rather than publish the fact-layer snapshot.'
  }
}

export function createDailyBriefEditorAgentSeed(
  providers: SafeModelProvider[] = [],
  options: { language?: AppLanguage } = {}
): AgentStoreSeed {
  const language = options.language === 'en-US' ? 'en-US' : 'zh-CN'
  const text = copy[language]
  const model = resolveModel(providers)
  const agent: AgentEntity = {
    id: AGENT_ID,
    type: 'claude-code',
    name: text.name,
    description: text.description,
    instructions: text.instructions,
    model: model.id,
    modelName: model.name,
    mcps: [],
    disabledTools: [],
    configuration: {
      avatar: '📰',
      permission_mode: 'plan',
      max_turns: 8,
      heartbeat_enabled: false,
      productId: 'market-intelligence',
      dataAccessProfileId: 'crypto-market-analysis-v1',
      configProfileId: 'daily-brief-editor-v1'
    },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    orderKey: '0110'
  }
  return {
    agents: [agent],
    sessions: [],
    messagesBySessionId: {},
    workspaces: [],
    agentSkills: [{ agentId: AGENT_ID, skillId: 'daily-brief-editor-skill-v1', isEnabled: true }],
    // No market-intelligence product tools: the editor only needs the built-in WebSearch/WebFetch.
    // Registering the same product tool package on a second agent collides by tool id.
    agentProductToolPackages: []
  }
}

function resolveModel(providers: SafeModelProvider[]): { id: string; name: string } {
  const unconfigured = { id: 'unconfigured:default-chat-model', name: 'unconfigured' }
  const provider = providers.find((candidate) => candidate.enabled && candidate.models.some((model) => isAgentCompatibleModel(candidate, model, 'claude-code', { requireReadyProvider: true })))
  if (!provider) return unconfigured
  const compatible = (candidate: SafeModelProvider['models'][number]) => isAgentCompatibleModel(provider, candidate, 'claude-code', { requireReadyProvider: true })
  const model = provider.models.find((candidate) => candidate.id === provider.defaultChatModelId && compatible(candidate)) ?? provider.models.find(compatible)
  return model ? { id: `${provider.id}:${model.id}`, name: `${provider.name} / ${model.name}` } : unconfigured
}

/** Registry entry point: one seed module exports the product seed factory. */
export function createProductAgentSeed(providers: SafeModelProvider[] = [], options: { language?: AppLanguage } = {}): AgentStoreSeed {
  return createDailyBriefEditorAgentSeed(providers, options)
}
