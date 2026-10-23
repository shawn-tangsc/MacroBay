import path from 'node:path'

import type { AgentWorkspaceEntity, CreateAgentWorkspaceDto, UpdateAgentWorkspaceDto } from '../schemas/workspaceSchemas'
import { deleteAgentWorkspace, updateAgentWorkspace, upsertAgentWorkspace } from '../store/agentStore'
import type { AgentPlatformQueryAdapters, AgentPlatformStateStore } from './agentServiceTypes'

export type FindOrCreateAgentWorkspaceResult = {
  workspace: AgentWorkspaceEntity
  created: boolean
}

export class AgentWorkspaceService {
  constructor(
    private readonly store: AgentPlatformStateStore,
    private readonly queries: AgentPlatformQueryAdapters = {}
  ) {}

  async list(options: { includeSystem?: boolean } = {}): Promise<AgentWorkspaceEntity[]> {
    const adapterWorkspaces = this.queries.workspaces?.list(options)
    if (adapterWorkspaces) return adapterWorkspaces
    const workspaces = (await this.store.getState()).workspaces
      .filter((workspace) => options.includeSystem || workspace.type === 'user')
      .sort((a, b) => a.orderKey.localeCompare(b.orderKey) || a.id.localeCompare(b.id))
    return workspaces
  }

  async getById(id: string, options: { includeSystem?: boolean } = {}): Promise<AgentWorkspaceEntity> {
    if (this.queries.workspaces?.getById) {
      const workspace = this.queries.workspaces.getById(id, options)
      if (!workspace) throw new Error(`Workspace "${id}" was not found.`)
      return workspace
    }
    const workspace = (await this.store.getState()).workspaces.find(
      (item) => item.id === id && (options.includeSystem || item.type === 'user')
    )
    if (!workspace) throw new Error(`Workspace "${id}" was not found.`)
    return workspace
  }

  async findOrCreateByPath(rawPath: string, options: { name?: string } = {}): Promise<AgentWorkspaceEntity> {
    return (await this.findOrCreateByPathResult(rawPath, options)).workspace
  }

  async findOrCreateByPathResult(
    rawPath: string,
    options: { name?: string } = {}
  ): Promise<FindOrCreateAgentWorkspaceResult> {
    const normalizedPath = normalizeWorkspacePath(rawPath)
    const existing = this.queries.workspaces?.findByPath
      ? this.queries.workspaces.findByPath(normalizedPath)
      : (await this.store.getState()).workspaces.find((workspace) => workspace.path === normalizedPath)
    if (existing) {
      if (existing.type !== 'user') throw new Error(`Workspace path "${normalizedPath}" already exists.`)
      return { workspace: existing, created: false }
    }

    const before = await this.store.getState()
    const next = await this.store.update((state) => upsertAgentWorkspace(state, { path: normalizedPath, name: options.name }))
    const created = next.workspaces.find((workspace) => !before.workspaces.some((item) => item.id === workspace.id))
    if (!created) throw new Error('create workspace failed')
    return { workspace: created, created: true }
  }

  async create(dto: CreateAgentWorkspaceDto): Promise<AgentWorkspaceEntity> {
    return this.findOrCreateByPath(dto.path, { name: dto.name })
  }

  async update(id: string, dto: UpdateAgentWorkspaceDto): Promise<AgentWorkspaceEntity> {
    await this.store.update((state) => updateAgentWorkspace(state, id, dto))
    return this.getById(id)
  }

  async deleteCascade(id: string): Promise<void> {
    await this.store.update((state) => deleteAgentWorkspace(state, id))
  }

  async deleteById(id: string): Promise<void> {
    await this.deleteCascade(id)
  }

  async reorderBatch(orderedWorkspaceIds: readonly string[]): Promise<void> {
    const orderById = new Map(orderedWorkspaceIds.map((id, index) => [id, index]))
    await this.store.update((state) => ({
      ...state,
      workspaces: state.workspaces.map((workspace) => {
        const index = orderById.get(workspace.id)
        return index === undefined || workspace.type !== 'user'
          ? workspace
          : {
              ...workspace,
              orderKey: String(index).padStart(4, '0'),
              updatedAt: new Date().toISOString()
            }
      })
    }))
  }
}

export function normalizeWorkspacePath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) throw new Error('Workspace path is required.')
  if (!path.isAbsolute(trimmed)) throw new Error('Workspace path must be absolute.')
  const normalized = path.normalize(trimmed)
  const root = path.parse(normalized).root
  let end = normalized.length
  while (end > root.length && /[\\/]/.test(normalized[end - 1])) end -= 1
  return normalized.slice(0, end)
}
