import { describe, expect, it } from 'vitest'

import {
  allocateSiblingsGroupId,
  bucketAssistantSiblingsByModel,
  flattenActiveBranch,
  resolveNextActiveNodeAfterDelete,
  resolveParentIdForCreate
} from '../messageTree/assistantMessageTree'
import type { AssistantMessageEntity } from '../schemas/messageSchemas'

const timestamp = '2026-07-10T00:00:00.000Z'

describe('assistantMessageTree', () => {
  it('resolves parent for empty topics, active node, and explicit anchors', () => {
    expect(
      resolveParentIdForCreate({
        messages: [],
        activeNodeId: null,
        parentAnchorId: undefined
      })
    ).toEqual({ ok: true, parentId: null })

    expect(
      resolveParentIdForCreate({
        messages: [msg('u1', null, 'user')],
        activeNodeId: 'u1',
        parentAnchorId: undefined
      })
    ).toEqual({ ok: true, parentId: 'u1' })

    expect(
      resolveParentIdForCreate({
        messages: [msg('u1', null, 'user')],
        activeNodeId: 'u1',
        parentAnchorId: null
      })
    ).toMatchObject({ ok: false, errorCode: 'root-already-exists' })

    expect(
      resolveParentIdForCreate({
        messages: [msg('u1', null, 'user')],
        activeNodeId: null,
        parentAnchorId: undefined
      })
    ).toMatchObject({ ok: false, errorCode: 'missing-parent-anchor' })
  })

  it('flattens the active branch from leaf to root oldest-first', () => {
    const messages = [
      msg('u1', null, 'user'),
      msg('a1', 'u1', 'assistant'),
      msg('u2', 'a1', 'user'),
      msg('a2', 'u2', 'assistant'),
      msg('a2b', 'u2', 'assistant', { siblingsGroupId: 100, modelId: 'openai:gpt-5' })
    ]

    expect(flattenActiveBranch(messages, 'a2').map((item) => item.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(flattenActiveBranch(messages, 'missing')).toEqual([])
  })

  it('buckets assistant siblings by model for regenerate and multi-model fan-out', () => {
    const siblings = [
      msg('a1', 'u1', 'assistant', { siblingsGroupId: 10, modelId: 'openai:gpt-5', modelSnapshot: snap('openai', 'gpt-5') }),
      msg('a2', 'u1', 'assistant', { siblingsGroupId: 10, modelId: 'openai:gpt-5', modelSnapshot: snap('openai', 'gpt-5') }),
      msg('a3', 'u1', 'assistant', {
        siblingsGroupId: 10,
        modelId: 'anthropic:claude',
        modelSnapshot: snap('anthropic', 'claude')
      })
    ]

    expect(bucketAssistantSiblingsByModel(siblings)).toEqual([
      {
        modelId: 'openai:gpt-5',
        messages: [siblings[0], siblings[1]]
      },
      {
        modelId: 'anthropic:claude',
        messages: [siblings[2]]
      }
    ])
  })

  it('allocates sibling group ids and resolves active node after delete', () => {
    expect(allocateSiblingsGroupId(0)).toBeGreaterThan(0)
    expect(allocateSiblingsGroupId(42)).toBe(42)
    expect(
      resolveNextActiveNodeAfterDelete({
        deletedId: 'a2',
        activeNodeId: 'a2',
        parentId: 'u1',
        strategy: 'parent'
      })
    ).toBe('u1')
    expect(
      resolveNextActiveNodeAfterDelete({
        deletedId: 'a2',
        activeNodeId: 'a2',
        parentId: 'u1',
        strategy: 'clear'
      })
    ).toBeNull()
    expect(
      resolveNextActiveNodeAfterDelete({
        deletedId: 'a2',
        activeNodeId: 'u1',
        parentId: null,
        strategy: 'parent'
      })
    ).toBe('u1')
  })
})

function msg(
  id: string,
  parentId: string | null,
  role: 'user' | 'assistant' | 'system',
  overrides: Partial<AssistantMessageEntity> = {}
): AssistantMessageEntity {
  return {
    id,
    topicId: 'topic-1',
    parentId,
    role,
    data: { parts: [{ type: 'text', text: id }] },
    searchableText: id,
    status: 'success',
    siblingsGroupId: 0,
    modelId: null,
    modelSnapshot: null,
    stats: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function snap(provider: string, id: string) {
  return { id, name: id, provider }
}
