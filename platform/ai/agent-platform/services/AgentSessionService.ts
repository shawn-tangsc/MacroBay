import type {
  AgentSessionEntity,
  CreateAgentSessionDto,
  DeleteAgentSessionsResult,
  ListAgentSessionsQuery,
  UpdateAgentSessionDto
} from '../schemas/sessionSchemas'
import type { AgentSessionWorkspaceSource } from '../schemas/workspaceSchemas'
import {
  createAgentSession,
  deleteAgentSession,
  deleteAgentSessions,
  deleteAgentSessionsByAgent,
  deleteAgentWorkspace,
  listAgentSessions,
  reorderAgentSessions,
  toggleSessionPin,
  upsertAgentWorkspace,
  updateAgentSessionAgent,
  updateAgentSessionWorkspace,
  updateAgentSession
} from '../store/agentStore'
import type { AgentPlatformQueryAdapters, AgentPlatformStateStore, SessionEntitySearchItem } from './agentServiceTypes'
import { includesSearchText, normalizeSearch } from './agentSearch'
import { normalizeWorkspacePath } from './AgentWorkspaceService'

export class AgentSessionService {
  constructor(
    private readonly store: AgentPlatformStateStore,
    private readonly queries: AgentPlatformQueryAdapters = {}
  ) {}

  async create(dto: CreateAgentSessionDto): Promise<AgentSessionEntity> {
    const before = await this.store.getState()
    const next = await this.store.update((state) => createAgentSession(state, dto))
    const created = next.sessions.find((item) => !before.sessions.some((session) => session.id === item.id))
    if (!created) throw new Error('create session failed')
    return created
  }

  async get(id: string): Promise<AgentSessionEntity | null> {
    return (await this.store.getState()).sessions.find((session) => session.id === id) ?? null
  }

  async getById(id: string): Promise<AgentSessionEntity> {
    const session = await this.get(id)
    if (!session) throw new Error(`Session "${id}" was not found.`)
    return session
  }

  async listByCursor(query: ListAgentSessionsQuery = {}) {
    const page = this.queries.sessions?.listByCursor(query)
    if (!page) {
      return listAgentSessions(await this.store.getState(), query)
    }

    const state = await this.store.getState()
    const sessionsById = new Map(state.sessions.map((session) => [session.id, session]))
    return {
      items: page.items.flatMap((item) => {
        const session = sessionsById.get(item.id)
        return session ? [session] : []
      }),
      nextCursor: page.nextCursor
    }
  }

  async update(id: string, patch: UpdateAgentSessionDto): Promise<AgentSessionEntity> {
    await this.store.update((state) => updateAgentSession(state, id, patch))
    return this.getById(id)
  }

  async setAgent(id: string, agentId: string | null): Promise<AgentSessionEntity> {
    await this.store.update((state) => updateAgentSessionAgent(state, id, agentId))
    return this.getById(id)
  }

  async setWorkspace(id: string, source: AgentSessionWorkspaceSource): Promise<AgentSessionEntity> {
    await this.store.update((state) => updateAgentSessionWorkspace(state, id, source))
    return this.getById(id)
  }

  async setWorkspaceByPath(id: string, rawPath: string): Promise<AgentSessionEntity> {
    const normalizedPath = normalizeWorkspacePath(rawPath)
    const state = await this.store.getState()
    const existing = state.workspaces.find((workspace) => workspace.path === normalizedPath)
    const nextState = existing
      ? await this.store.update((current) => updateAgentSessionWorkspace(current, id, { type: 'user', workspaceId: existing.id }))
      : await this.store.update((current) => createWorkspaceAndBindSession(current, id, normalizedPath))
    const session = nextState.sessions.find((item) => item.id === id)
    if (!session) throw new Error(`Session "${id}" was not found.`)
    return session
  }

  async delete(id: string): Promise<void> {
    await this.store.update((state) => deleteAgentSession(state, id))
  }

  async deleteByIds(ids: string[]): Promise<DeleteAgentSessionsResult> {
    const uniqueIds = Array.from(new Set(ids))
    const before = await this.store.getState()
    await this.store.update((state) => deleteAgentSessions(state, uniqueIds))
    const after = await this.store.getState()
    const remaining = new Set(after.sessions.map((session) => session.id))
    return {
      deletedIds: before.sessions.filter((session) => uniqueIds.includes(session.id) && !remaining.has(session.id)).map((session) => session.id)
    }
  }

  async deleteByAgentId(agentId: string): Promise<DeleteAgentSessionsResult> {
    const before = await this.store.getState()
    const targetIds = before.sessions.filter((session) => session.agentId === agentId).map((session) => session.id)
    await this.store.update((state) => deleteAgentSessionsByAgent(state, agentId))
    const after = await this.store.getState()
    const remaining = new Set(after.sessions.map((session) => session.id))
    return { deletedIds: targetIds.filter((id) => !remaining.has(id)) }
  }

  async deleteWorkspaceCascade(workspaceId: string): Promise<void> {
    await this.store.update((state) => deleteAgentWorkspace(state, workspaceId))
  }

  async reorderBatch(orderedSessionIds: readonly string[]): Promise<void> {
    await this.store.update((state) => reorderAgentSessions(state, orderedSessionIds))
  }

  async togglePin(id: string) {
    return this.store.update((state) => toggleSessionPin(state, id), { sessionPinRowsOnly: true })
  }

  async exists(id: string): Promise<boolean> {
    return (await this.get(id)) !== null
  }

  async search(query: { q: string; limit: number; updatedAtFrom?: number }): Promise<SessionEntitySearchItem[]> {
    const search = normalizeSearch(query.q)
    if (!search) return []
    const state = await this.store.getState()
    return state.sessions
      .filter((session) => {
        if (query.updatedAtFrom !== undefined && Date.parse(session.updatedAt) < query.updatedAtFrom) return false
        return includesSearchText(session.name, search) || includesSearchText(session.description, search)
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))
      .slice(0, Math.max(0, query.limit))
      .map((session) => ({
        type: 'session',
        id: session.id,
        title: session.name,
        subtitle: state.agents.find((agent) => agent.id === session.agentId)?.name,
        updatedAt: session.updatedAt,
        target: { sessionId: session.id, agentId: session.agentId }
      }))
  }
}

function createWorkspaceAndBindSession(
  state: Awaited<ReturnType<AgentPlatformStateStore['getState']>>,
  sessionId: string,
  normalizedPath: string
) {
  const withWorkspace = upsertAgentWorkspace(state, { path: normalizedPath })
  const workspace = withWorkspace.workspaces.find((item) => item.path === normalizedPath)
  if (!workspace) return withWorkspace
  return updateAgentSessionWorkspace(withWorkspace, sessionId, { type: 'user', workspaceId: workspace.id })
}
