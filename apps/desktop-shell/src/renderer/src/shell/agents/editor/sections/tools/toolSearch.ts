import type { Tool } from '@platform/ai/agent-platform/schemas/toolSchemas'

export function matchesSearch(tool: Tool, search: string): boolean {
  return matchesText(`${tool.name} ${tool.description ?? ''}`, search)
}

export function matchesText(value: string, search: string): boolean {
  const keyword = search.trim().toLowerCase()
  if (!keyword) return true
  return value.toLowerCase().includes(keyword)
}
