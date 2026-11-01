import type {
  McpRuntimeErrorKind,
  McpRuntimeState,
  McpRuntimeStatus,
  McpServerEntity
} from '../schemas/mcpServerSchemas'

import { buildMcpRuntimeCredentialActions, type RuntimeCredentialAction } from './runtimeCredentialActions'

export type AgentMcpCatalogItem = {
  id: string
  name: string
  description: string
  type: McpServerEntity['type']
  command: string | null
  baseUrl: string | null
  providerUrl: string | null
  tags: string[]
  bound: boolean
  pickable: boolean
  status: McpRuntimeState
  statusText: string
  errorKind?: McpRuntimeErrorKind
  retryable?: boolean
  actions: RuntimeCredentialAction[]
}

export type AgentMcpCatalog = {
  all: AgentMcpCatalogItem[]
  bound: AgentMcpCatalogItem[]
  addable: AgentMcpCatalogItem[]
}

export function buildAgentMcpCatalog(
  servers: readonly McpServerEntity[],
  boundServerIds: readonly string[],
  search: string,
  runtimeStatusByServerId: Record<string, McpRuntimeStatus> = {}
): AgentMcpCatalog {
  const boundIds = new Set(boundServerIds)
  const all = servers
    .map((server) => toCatalogItem(server, boundIds.has(server.id), runtimeStatusByServerId[server.id]))
    .filter((item) => matchesSearch(item, search))

  return {
    all,
    bound: all.filter((item) => item.bound),
    addable: all.filter((item) => !item.bound && item.pickable)
  }
}

function toCatalogItem(server: McpServerEntity, bound: boolean, runtimeStatus?: McpRuntimeStatus): AgentMcpCatalogItem {
  // 没有运行时上报就是「还没启动过」，不是「正在连接」。用 `error` 兜底同样不行——
  // 那是把未知说成失败，和编一个「连接中」是同一类错误，只是方向相反。
  const status: McpRuntimeState = server.isActive ? (runtimeStatus?.state ?? 'idle') : 'disabled'
  const statusText = server.isActive ? runtimeStatus?.message ?? '' : ''
  const errorKind = status === 'error' ? runtimeStatus?.errorKind : undefined
  const retryable = status === 'error' ? runtimeStatus?.retryable : undefined
  const providerUrl = server.providerUrl ?? null
  const baseUrl = server.baseUrl ?? null

  return {
    id: server.id,
    name: server.name,
    description: server.description ?? server.baseUrl ?? server.command ?? '',
    type: server.type,
    command: server.command ?? null,
    baseUrl,
    providerUrl,
    tags: server.tags ?? [],
    bound,
    pickable: server.isActive,
    status,
    statusText,
    ...(errorKind ? { errorKind } : {}),
    ...(typeof retryable === 'boolean' ? { retryable } : {}),
    actions: buildMcpRuntimeCredentialActions({
      status,
      ...(errorKind ? { errorKind } : {}),
      ...(statusText ? { message: statusText } : {}),
      ...(typeof retryable === 'boolean' ? { retryable } : {}),
      providerUrl,
      baseUrl
    })
  }
}

function matchesSearch(item: AgentMcpCatalogItem, search: string): boolean {
  const keyword = search.trim().toLowerCase()
  if (!keyword) return true
  return [item.name, item.description, item.command ?? '', item.baseUrl ?? '', ...item.tags]
    .join(' ')
    .toLowerCase()
    .includes(keyword)
}
