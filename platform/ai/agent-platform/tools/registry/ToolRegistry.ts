import type { Tool } from '../../schemas/toolSchemas'

export class ToolRegistry {
  private readonly toolsBySource = new Map<string, Tool[]>()

  registerTools(sourceId: string, tools: readonly Tool[]): void {
    const nextTools = tools.map((tool) => ({ ...tool }))
    const ownersByToolId = new Map<string, string>()

    for (const [ownerSourceId, ownerTools] of this.toolsBySource.entries()) {
      if (ownerSourceId === sourceId) continue
      for (const tool of ownerTools) {
        ownersByToolId.set(tool.id, ownerSourceId)
      }
    }

    for (const tool of nextTools) {
      const owner = ownersByToolId.get(tool.id)
      if (owner) {
        throw new Error(`Tool id "${tool.id}" is already registered by source "${owner}".`)
      }
    }

    this.toolsBySource.set(sourceId, nextTools)
  }

  unregisterSource(sourceId: string): void {
    this.toolsBySource.delete(sourceId)
  }

  get(toolId: string): Tool | null {
    for (const tools of this.toolsBySource.values()) {
      const tool = tools.find((item) => item.id === toolId)
      if (tool) return { ...tool }
    }
    return null
  }

  listAll(): Tool[] {
    return [...this.toolsBySource.values()].flatMap((tools) => tools.map((tool) => ({ ...tool })))
  }

  listBySource(sourceId: string): Tool[] {
    return (this.toolsBySource.get(sourceId) ?? []).map((tool) => ({ ...tool }))
  }

  listBySources(sourceIds: readonly string[]): Tool[] {
    return sourceIds.flatMap((sourceId) => this.listBySource(sourceId))
  }
}
