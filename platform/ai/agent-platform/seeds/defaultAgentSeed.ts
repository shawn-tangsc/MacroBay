import type { SafeModelProvider } from '../../providers/modelProviderTypes'
import { isAgentCompatibleModel } from '../agents/agentModelCompatibility'
import type { AgentEntity } from '../schemas/agentSchemas'
import type { McpServerEntity } from '../schemas/mcpServerSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '../schemas/sessionSchemas'
import { DEFAULT_SYSTEM_WORKSPACE_PATH, type AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import type { AgentStoreSeed } from '../store/agentStore'
import {
  createRuntimeTextDescriptor,
  resolveRuntimeText,
  runtimeTextKeys,
  type RuntimeTextDescriptor
} from '../runtime/runtimeText'

const createdAt = '2026-01-01T00:00:00.000Z'

export type PlatformAgentSeedLocale = 'zh-CN' | 'en-US'

export type CreatePlatformAgentSeedOptions = {
  locale?: PlatformAgentSeedLocale
  textCatalog?: Partial<Record<string, string>>
}

const seedTextDescriptors = {
  workspaceName: createRuntimeTextDescriptor(runtimeTextKeys.seedWorkspaceName, '默认工作区'),
  agentName: createRuntimeTextDescriptor(runtimeTextKeys.seedAgentName, '默认助手'),
  agentDescription: createRuntimeTextDescriptor(
    runtimeTextKeys.seedAgentDescription,
    '通用对话与任务处理智能体。'
  ),
  agentInstructions: createRuntimeTextDescriptor(
    runtimeTextKeys.seedAgentInstructions,
    '你是一个通用桌面 AI 助手。先理解用户目标，再给出清晰、可执行的帮助。'
  ),
  sessionName: createRuntimeTextDescriptor(runtimeTextKeys.seedSessionName, '新的会话'),
  sessionDescription: createRuntimeTextDescriptor(
    runtimeTextKeys.seedSessionDescription,
    '和默认助手开始一次通用对话。'
  ),
  welcomeMessage: createRuntimeTextDescriptor(
    runtimeTextKeys.seedWelcomeMessage,
    '你好，我已经准备好了。你可以直接告诉我想完成什么任务。'
  ),
  unconfiguredModelName: createRuntimeTextDescriptor(
    runtimeTextKeys.seedUnconfiguredModelName,
    '未选择模型'
  )
} as const

const englishSeedCatalog: Record<string, string> = {
  [runtimeTextKeys.seedWorkspaceName]: 'Default Workspace',
  [runtimeTextKeys.seedAgentName]: 'Default Assistant',
  [runtimeTextKeys.seedAgentDescription]: 'A general-purpose conversation and task assistant.',
  [runtimeTextKeys.seedAgentInstructions]:
    'You are a general desktop AI assistant. Understand the user goal first, then provide clear and actionable help.',
  [runtimeTextKeys.seedSessionName]: 'New session',
  [runtimeTextKeys.seedSessionDescription]: 'Start a general conversation with the default assistant.',
  [runtimeTextKeys.seedWelcomeMessage]:
    'Hello, I am ready. Tell me what you would like to accomplish.',
  [runtimeTextKeys.seedUnconfiguredModelName]: 'No model selected'
}

export function createPlatformAgentSeed(
  providers: SafeModelProvider[] = [],
  options: CreatePlatformAgentSeedOptions = {}
): AgentStoreSeed {
  const catalog = resolveSeedCatalog(options)
  const model = resolveDefaultModel(providers, catalog)
  const workspace: AgentWorkspaceEntity = {
    id: 'platform-agent-workspace',
    name: resolveSeedText(seedTextDescriptors.workspaceName, catalog),
    path: DEFAULT_SYSTEM_WORKSPACE_PATH,
    type: 'system',
    orderKey: '0001',
    createdAt,
    updatedAt: createdAt
  }
  const agent: AgentEntity = {
    id: 'default-assistant',
    type: 'claude-code',
    name: resolveSeedText(seedTextDescriptors.agentName, catalog),
    description: resolveSeedText(seedTextDescriptors.agentDescription, catalog),
    instructions: resolveSeedText(seedTextDescriptors.agentInstructions, catalog),
    model: model.id,
    modelName: model.name,
    mcps: [],
    disabledTools: [],
    configuration: {
      avatar: '🤖',
      permission_mode: 'default',
      max_turns: 100,
      heartbeat_enabled: true,
      heartbeat_interval: 30
    },
    createdAt,
    updatedAt: createdAt,
    orderKey: '0001'
  }
  const session = createSession({
    id: 'default-assistant-session',
    agentId: agent.id,
    name: resolveSeedText(seedTextDescriptors.sessionName, catalog),
    description: resolveSeedText(seedTextDescriptors.sessionDescription, catalog),
    workspace
  })

  return {
    agents: [agent],
    sessions: [session],
    workspaces: [workspace],
    mcpServers: createDefaultMcpServers(),
    mcpToolsByServerId: {
      'builtin-filesystem': [
        { id: 'read_file', name: 'read_file', description: 'Read a file from the configured workspace.' },
        { id: 'list_directory', name: 'list_directory', description: 'List files and folders under a workspace path.' },
        { id: 'search_files', name: 'search_files', description: 'Search workspace files by path or content.' }
      ],
      'builtin-git': [
        { id: 'status', name: 'status', description: 'Inspect repository status.' },
        { id: 'log', name: 'log', description: 'Read commit history.' },
        { id: 'diff', name: 'diff', description: 'Inspect repository changes.' }
      ]
    },
    messagesBySessionId: {
      [session.id]: [
        createMessage({
          id: `${session.id}-welcome`,
          sessionId: session.id,
          modelId: agent.id,
          text: resolveSeedText(seedTextDescriptors.welcomeMessage, catalog)
        })
      ]
    },
    activeAgentId: agent.id,
    activeSessionId: session.id
  }
}

export function getPlatformAgentSeedTextDescriptors(): Record<string, RuntimeTextDescriptor> {
  return { ...seedTextDescriptors }
}

function resolveSeedCatalog(options: CreatePlatformAgentSeedOptions): Partial<Record<string, string>> {
  if (options.textCatalog) return options.textCatalog
  if (options.locale === 'en-US') return englishSeedCatalog
  return {}
}

function resolveSeedText(descriptor: RuntimeTextDescriptor, catalog: Partial<Record<string, string>>): string {
  return resolveRuntimeText(descriptor, catalog)
}

function createDefaultMcpServers(): McpServerEntity[] {
  return [
    {
      id: 'builtin-filesystem',
      name: 'Filesystem',
      description: 'Local workspace file access MCP server.',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      tags: ['local', 'files'],
      isActive: false,
      installSource: 'builtin',
      sortOrder: 1,
      createdAt,
      updatedAt: createdAt
    },
    {
      id: 'builtin-git',
      name: 'Git',
      description: 'Repository inspection and git operation MCP server.',
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-git'],
      tags: ['code', 'repository'],
      isActive: false,
      installSource: 'builtin',
      sortOrder: 2,
      createdAt,
      updatedAt: createdAt
    }
  ]
}

function createSession(input: {
  id: string
  agentId: string
  name: string
  description: string
  workspace: AgentWorkspaceEntity
}): AgentSessionEntity {
  return {
    id: input.id,
    agentId: input.agentId,
    name: input.name,
    description: input.description,
    workspaceId: input.workspace.id,
    workspace: input.workspace,
    orderKey: '0001',
    createdAt,
    updatedAt: createdAt
  }
}

function createMessage(input: {
  id: string
  sessionId: string
  modelId: string
  text: string
}): AgentSessionMessageEntity {
  return {
    id: input.id,
    sessionId: input.sessionId,
    role: 'assistant',
    data: { parts: [{ type: 'text', text: input.text }] },
    searchableText: input.text,
    status: 'success',
    modelId: input.modelId,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt,
    updatedAt: createdAt
  }
}

function resolveDefaultModel(
  providers: SafeModelProvider[],
  catalog: Partial<Record<string, string>>
): { id: string; name: string } {
  const providerWithCompatibleDefault = providers.find((provider) =>
    provider.models.some(
      (item) =>
        item.id === provider.defaultChatModelId &&
        isAgentCompatibleModel(provider, item, 'claude-code', { requireReadyProvider: true })
    )
  )
  const enabledProvider =
    providerWithCompatibleDefault ??
    providers.find((provider) =>
      provider.models.some((model) => isAgentCompatibleModel(provider, model, 'claude-code', { requireReadyProvider: true }))
    )
  if (!enabledProvider) {
    return {
      id: 'unconfigured:default-chat-model',
      name: resolveSeedText(seedTextDescriptors.unconfiguredModelName, catalog)
    }
  }

  const model =
    enabledProvider.models.find(
      (item) =>
        item.id === enabledProvider.defaultChatModelId &&
        isAgentCompatibleModel(enabledProvider, item, 'claude-code', { requireReadyProvider: true })
    ) ??
    enabledProvider.models.find((item) =>
      isAgentCompatibleModel(enabledProvider, item, 'claude-code', { requireReadyProvider: true })
    )

  return model
    ? { id: `${enabledProvider.id}:${model.id}`, name: `${enabledProvider.name} / ${model.name}` }
    : { id: enabledProvider.id, name: enabledProvider.name }
}
