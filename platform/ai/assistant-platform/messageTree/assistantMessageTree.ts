import type { AssistantMessageEntity } from '../schemas/messageSchemas'

export type ResolveParentIdInput = {
  messages: readonly AssistantMessageEntity[]
  activeNodeId?: string | null
  parentAnchorId?: string | null
}

export type ResolveParentIdResult =
  | { ok: true; parentId: string | null }
  | {
      ok: false
      errorCode: 'missing-parent-anchor' | 'root-already-exists' | 'parent-not-found'
      message: string
    }

export type AssistantSiblingModelBucket = {
  modelId: string
  messages: AssistantMessageEntity[]
}

export type ActiveNodeDeleteStrategy = 'parent' | 'clear'

export function resolveParentIdForCreate(input: ResolveParentIdInput): ResolveParentIdResult {
  const hasRoot = input.messages.some((message) => message.parentId === null)

  if (input.parentAnchorId === null) {
    if (hasRoot) {
      return {
        ok: false,
        errorCode: 'root-already-exists',
        message: 'Topic already has a root message.'
      }
    }
    return { ok: true, parentId: null }
  }

  if (typeof input.parentAnchorId === 'string') {
    const parent = input.messages.find((message) => message.id === input.parentAnchorId)
    if (!parent) {
      return {
        ok: false,
        errorCode: 'parent-not-found',
        message: `Parent message was not found: ${input.parentAnchorId}`
      }
    }
    return { ok: true, parentId: parent.id }
  }

  if (input.messages.length === 0) {
    return { ok: true, parentId: null }
  }

  if (input.activeNodeId) {
    const active = input.messages.find((message) => message.id === input.activeNodeId)
    if (!active) {
      return {
        ok: false,
        errorCode: 'parent-not-found',
        message: `Active node was not found: ${input.activeNodeId}`
      }
    }
    return { ok: true, parentId: active.id }
  }

  return {
    ok: false,
    errorCode: 'missing-parent-anchor',
    message: 'Non-empty topics require an explicit parent anchor or active node.'
  }
}

export function flattenActiveBranch(
  messages: readonly AssistantMessageEntity[],
  leafId: string | null | undefined
): AssistantMessageEntity[] {
  if (!leafId) return []
  const byId = new Map(messages.map((message) => [message.id, message]))
  const path: AssistantMessageEntity[] = []
  let current = byId.get(leafId)
  const seen = new Set<string>()

  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    path.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }

  return path.reverse()
}

export function bucketAssistantSiblingsByModel(
  siblings: readonly AssistantMessageEntity[]
): AssistantSiblingModelBucket[] {
  const buckets = new Map<string, AssistantMessageEntity[]>()
  for (const message of siblings) {
    if (message.role !== 'assistant') continue
    const modelId = message.modelId ?? 'unknown'
    const existing = buckets.get(modelId)
    if (existing) {
      existing.push(message)
    } else {
      buckets.set(modelId, [message])
    }
  }
  return [...buckets.entries()].map(([modelId, messages]) => ({ modelId, messages }))
}

export function allocateSiblingsGroupId(current: number): number {
  if (current > 0) return current
  return Date.now()
}

export function resolveNextActiveNodeAfterDelete(input: {
  deletedId: string
  activeNodeId?: string | null
  parentId: string | null
  strategy: ActiveNodeDeleteStrategy
}): string | null {
  if (input.activeNodeId !== input.deletedId) {
    return input.activeNodeId ?? null
  }
  if (input.strategy === 'clear') return null
  return input.parentId
}

export function collectDescendantIds(
  messages: readonly AssistantMessageEntity[],
  rootId: string
): string[] {
  const childrenByParent = new Map<string, string[]>()
  for (const message of messages) {
    if (!message.parentId) continue
    const list = childrenByParent.get(message.parentId) ?? []
    list.push(message.id)
    childrenByParent.set(message.parentId, list)
  }

  const result: string[] = []
  const stack = [rootId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || seen.has(current)) continue
    seen.add(current)
    result.push(current)
    const children = childrenByParent.get(current) ?? []
    for (const childId of children) stack.push(childId)
  }
  return result
}
