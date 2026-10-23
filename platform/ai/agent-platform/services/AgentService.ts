import type { AgentEntity, CreateAgentDto, UpdateAgentDto } from '../schemas/agentSchemas'
import { createAgent, deleteAgent, selectAgent, updateAgent, type AgentStoreState } from '../store/agentStore'
import type {
  AgentEntitySearchItem,
  AgentListOptions,
  AgentPlatformQueryAdapters,
  AgentPlatformStateStore
} from './agentServiceTypes'
import { includesSearchText, normalizeSearch, sortIsoAsc, sortTextAsc } from './agentSearch'

export class AgentService {
  constructor(
    private readonly store: AgentPlatformStateStore,
    private readonly queries: AgentPlatformQueryAdapters = {}
  ) {}

  async create(dto: CreateAgentDto): Promise<AgentEntity> {
    const before = await this.store.getState()
    const next = await this.store.update((state) => createAgent(state, dto))
    const created = next.agents.find((item) => !before.agents.some((agent) => agent.id === item.id))
    if (!created) throw new Error('create agent failed')
    return created
  }

  async get(id: string): Promise<AgentEntity | null> {
    if (this.queries.agents?.get) return this.queries.agents.get(id)
    return (await this.store.getState()).agents.find((agent) => agent.id === id) ?? null
  }

  async list(options: AgentListOptions = {}): Promise<{ agents: AgentEntity[]; total: number }> {
    const page = this.queries.agents?.list(options)
    if (page) return page
    const search = normalizeSearch(options.search)
    const sortBy = options.sortBy ?? 'orderKey'
    const sortOrder = options.sortOrder ?? (sortBy === 'orderKey' || sortBy === 'name' ? 'asc' : 'desc')
    const offset = Math.max(0, options.offset ?? 0)
    const agents = (await this.store.getState()).agents
      .filter((agent) => {
        if (!search) return true
        return includesSearchText(agent.name, search) || includesSearchText(agent.description, search)
      })
      .sort((a, b) => sortAgents(a, b, sortBy, sortOrder))
    const total = agents.length
    const sliced = options.limit === undefined ? agents.slice(offset) : agents.slice(offset, offset + Math.max(0, options.limit))
    return { agents: sliced, total }
  }

  async update(id: string, patch: UpdateAgentDto): Promise<AgentEntity> {
    await this.store.update((state) => updateAgent(state, id, patch))
    const agent = await this.get(id)
    if (!agent) throw new Error(`Agent "${id}" was not found.`)
    return agent
  }

  async delete(id: string): Promise<void> {
    await this.store.update((state) => deleteAgent(state, id))
  }

  async select(id: string): Promise<AgentStoreState> {
    return this.store.update((state) => selectAgent(state, id), { activeSelectionRowOnly: true })
  }

  async search(query: { q: string; limit: number; updatedAtFrom?: number }): Promise<AgentEntitySearchItem[]> {
    const search = normalizeSearch(query.q)
    if (!search) return []
    const updatedAtFrom = query.updatedAtFrom
    const { agents } = await this.list({ search, sortBy: 'updatedAt', sortOrder: 'desc', limit: query.limit })
    return agents
      .filter((agent) => updatedAtFrom === undefined || Date.parse(agent.updatedAt) >= updatedAtFrom)
      .slice(0, Math.max(0, query.limit))
      .map((agent) => ({
        type: 'agent',
        id: agent.id,
        title: agent.name,
        subtitle: agent.description,
        emoji: typeof agent.configuration?.avatar === 'string' ? agent.configuration.avatar : undefined,
        updatedAt: agent.updatedAt,
        target: { agentId: agent.id }
      }))
  }

  async reorder(orderedAgentIds: readonly string[]): Promise<void> {
    const orderById = new Map(orderedAgentIds.map((id, index) => [id, index]))
    await this.store.update((state) => ({
      ...state,
      agents: state.agents
        .map((agent) => {
          const index = orderById.get(agent.id)
          return index === undefined
            ? agent
            : {
                ...agent,
                orderKey: String(index).padStart(4, '0'),
                updatedAt: new Date().toISOString()
              }
        })
        .sort((a, b) => sortAgents(a, b, 'orderKey', 'asc'))
    }))
  }
}

function sortAgents(
  a: AgentEntity,
  b: AgentEntity,
  sortBy: NonNullable<AgentListOptions['sortBy']>,
  sortOrder: NonNullable<AgentListOptions['sortOrder']>
): number {
  const direction = sortOrder === 'asc' ? 1 : -1
  let result = 0
  if (sortBy === 'name') result = sortTextAsc(a.name, b.name)
  else if (sortBy === 'createdAt') result = sortIsoAsc(a.createdAt, b.createdAt)
  else if (sortBy === 'updatedAt') result = sortIsoAsc(a.updatedAt, b.updatedAt)
  else result = sortTextAsc(a.orderKey, b.orderKey)
  return result === 0 ? a.id.localeCompare(b.id) : result * direction
}
