import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createAssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import { createAssistantTextData } from '../schemas/messageSchemas'
import { createAssistantPlatformRepositories } from './createAssistantPlatformRepositories'

describe('assistant platform repositories', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates assistants with relation sync and supports topic/message branch turns', () => {
    const repos = createRepos()
    const assistant = repos.assistants.create({
      name: 'General',
      prompt: 'Be helpful.',
      mcpServerIds: ['mcp-1'],
      tags: [{ id: 'tag-1', name: 'general' }]
    })

    expect(assistant.mcpServerIds).toEqual(['mcp-1'])
    expect(assistant.tags).toEqual([{ id: 'tag-1', name: 'general' }])

    const topic = repos.topics.create({ assistantId: assistant.id, name: '' })
    expect(topic.activeNodeId).toBeNull()

    const turn = repos.messages.createUserMessageWithPlaceholders(topic.id, {
      userMessage: {
        mode: 'create',
        data: createAssistantTextData('Hello')
      },
      placeholders: [
        {
          modelId: 'openai:gpt-5',
          modelSnapshot: { id: 'gpt-5', name: 'GPT-5', provider: 'openai' }
        },
        {
          modelId: 'anthropic:claude',
          modelSnapshot: { id: 'claude', name: 'Claude', provider: 'anthropic' }
        }
      ]
    })

    expect(turn.userMessage.role).toBe('user')
    expect(turn.placeholders).toHaveLength(2)
    expect(turn.placeholders.every((item) => item.status === 'pending')).toBe(true)
    expect(turn.placeholders.every((item) => item.siblingsGroupId > 0)).toBe(true)
    expect(repos.topics.getById(topic.id)?.activeNodeId).toBe(turn.placeholders[1]?.id)

    repos.messages.update(turn.placeholders[0]!.id, {
      status: 'success',
      data: createAssistantTextData('Hi from GPT')
    })

    const branch = repos.messages.getBranchMessages(topic.id, turn.placeholders[0]!.id, {
      includeSiblings: true
    })
    expect(branch.messages.map((item) => item.message.id)).toEqual([
      turn.userMessage.id,
      turn.placeholders[0]!.id
    ])
    expect(branch.messages[1]?.siblingsGroup?.map((item) => item.id).sort()).toEqual(
      turn.placeholders.map((item) => item.id).sort()
    )
  })

  it('supports sibling create, cascade delete, and active-node recovery', () => {
    const repos = createRepos()
    const assistant = repos.assistants.create({ name: 'Editor' })
    const topic = repos.topics.create({ assistantId: assistant.id })
    const user = repos.messages.create(topic.id, {
      role: 'user',
      data: createAssistantTextData('Draft')
    })
    const assistantMessage = repos.messages.create(topic.id, {
      parentId: user.id,
      role: 'assistant',
      data: createAssistantTextData('v1')
    })
    const sibling = repos.messages.createSibling(assistantMessage.id, {
      data: createAssistantTextData('v2')
    })

    expect(sibling.parentId).toBe(user.id)
    expect(sibling.siblingsGroupId).toBeGreaterThan(0)
    expect(repos.topics.getById(topic.id)?.activeNodeId).toBe(sibling.id)

    repos.messages.delete(user.id, { cascade: true, activeNodeStrategy: 'clear' })
    expect(repos.messages.listByTopic(topic.id)).toEqual([])
    expect(repos.topics.getById(topic.id)?.activeNodeId).toBeNull()
  })

  it('persists topic trace ids for external programmatic invocation refs', () => {
    const repos = createRepos()
    const assistant = repos.assistants.create({ name: 'Programmatic' })
    const topic = repos.topics.create({
      assistantId: assistant.id,
      name: '指标解读 · BTCUSDT · 15m',
      isNameManuallyEdited: true,
      groupId: 'chart-indicator-insight',
      traceId: 'sample-product:chart:btc:15m'
    })

    expect(topic.traceId).toBe('sample-product:chart:btc:15m')
    expect(repos.topics.getById(topic.id)?.traceId).toBe('sample-product:chart:btc:15m')
  })

  it('allows editing and resending the root user message as a sibling branch', () => {
    const repos = createRepos()
    const assistant = repos.assistants.create({ name: 'Editor' })
    const topic = repos.topics.create({ assistantId: assistant.id })
    const rootUser = repos.messages.create(topic.id, {
      role: 'user',
      data: createAssistantTextData('Original root prompt')
    })

    const editedRootUser = repos.messages.createSibling(rootUser.id, {
      data: createAssistantTextData('Edited root prompt'),
      status: 'success'
    })

    expect(editedRootUser.parentId).toBeNull()
    expect(editedRootUser.role).toBe('user')
    expect(editedRootUser.siblingsGroupId).toBeGreaterThan(0)
    expect(repos.topics.getById(topic.id)?.activeNodeId).toBe(editedRootUser.id)
  })

  it('clears topic messages and supports searchable lookup', () => {
    const repos = createRepos()
    const assistant = repos.assistants.create({ name: 'Search' })
    const topic = repos.topics.create({ assistantId: assistant.id })
    repos.messages.create(topic.id, {
      role: 'user',
      data: createAssistantTextData('Bitcoin market review')
    })

    expect(repos.messages.searchInTopic(topic.id, 'bitcoin')).toHaveLength(1)
    expect(repos.messages.clearByTopic(topic.id)).toBe(1)
    expect(repos.messages.listByTopic(topic.id)).toEqual([])
  })

  it('prunes a topic to the latest user turns and their assistant replies', () => {
    const repos = createRepos()
    const assistant = repos.assistants.create({ name: 'Programmatic' })
    const topic = repos.topics.create({ assistantId: assistant.id })

    for (let index = 1; index <= 7; index += 1) {
      const turn = repos.messages.createUserMessageWithPlaceholders(topic.id, {
        userMessage: {
          mode: 'create',
          data: createAssistantTextData(`large structured input ${index}`),
          allowDetachedRoot: true
        },
        placeholders: [
          {
            modelId: 'openai:gpt-test',
            modelSnapshot: { id: 'gpt-test', name: 'GPT Test', provider: 'openai' }
          }
        ]
      })
      repos.messages.update(turn.placeholders[0]!.id, {
        status: 'success',
        data: createAssistantTextData(`structured output ${index}`)
      })
    }

    const pruneResult = repos.messages.pruneTopicToLatestTurns(topic.id, 5)
    expect(pruneResult).toMatchObject({
      topicId: topic.id,
      latestTurns: 5,
      activeMessagesBefore: 14,
      activeMessagesAfter: 10,
      deletedMessages: 4
    })
    expect(pruneResult.activeBytesBefore).toBeGreaterThan(pruneResult.activeBytesAfter)
    expect(pruneResult.durationMs).toEqual(expect.any(Number))

    const remaining = repos.messages.listByTopic(topic.id)
    expect(remaining).toHaveLength(10)
    expect(new Set(remaining.map((message) => message.searchableText))).toEqual(new Set([
      'large structured input 3',
      'structured output 3',
      'large structured input 4',
      'structured output 4',
      'large structured input 5',
      'structured output 5',
      'large structured input 6',
      'structured output 6',
      'large structured input 7',
      'structured output 7'
    ]))
    const activeNodeId = repos.topics.getById(topic.id)?.activeNodeId
    expect(remaining.some((message) => message.id === activeNodeId)).toBe(true)
    expect(activeNodeId ? repos.messages.getById(activeNodeId)?.searchableText : null).toBe('structured output 7')
  })

  it('bulk-prunes large programmatic topics without hydrating every message', () => {
    const repos = createRepos()
    const assistant = repos.assistants.create({ name: 'Programmatic' })
    const topic = repos.topics.create({ assistantId: assistant.id })
    const largeInput = 'large structured input '.repeat(400)

    for (let index = 1; index <= 1_200; index += 1) {
      const turn = repos.messages.createUserMessageWithPlaceholders(topic.id, {
        userMessage: {
          mode: 'create',
          data: createAssistantTextData(`${largeInput}${index}`),
          allowDetachedRoot: true
        },
        placeholders: [
          {
            modelId: 'openai:gpt-test',
            modelSnapshot: { id: 'gpt-test', name: 'GPT Test', provider: 'openai' }
          }
        ]
      })
      repos.messages.update(turn.placeholders[0]!.id, {
        status: 'success',
        data: createAssistantTextData(`structured output ${index}`)
      })
    }

    const result = repos.messages.pruneTopicToLatestTurns(topic.id, 5)

    expect(result).toMatchObject({
      activeMessagesBefore: 2_400,
      activeMessagesAfter: 10,
      deletedMessages: 2_390
    })
    expect(result.activeBytesAfter).toBeLessThan(result.activeBytesBefore)
    expect(repos.messages.listByTopic(topic.id)).toHaveLength(10)
  }, 30_000)

  it('lists product-owned group topics so maintenance can prune orphan audit topics', () => {
    const repos = createRepos()
    const assistant = repos.assistants.create({ name: 'Chart Indicator Analyst' })
    repos.templateInstalls.upsert({
      assistantId: assistant.id,
      sourceKind: 'product',
      sourceProductId: 'sample-product',
      sourceTemplateId: 'product:sample-product:chart-indicator-analyst',
      sourceTemplateVersion: 1,
      promptHashAtInstall: 'hash'
    })
    const sessionTopic = repos.topics.create({
      assistantId: assistant.id,
      groupId: 'chart-indicator-insight',
      name: '指标解读 · BTC/USDT · 15m'
    })
    const orphanTopic = repos.topics.create({
      assistantId: assistant.id,
      groupId: 'chart-indicator-insight',
      name: '指标解读 · ETH/USDT · 1m'
    })
    const unrelatedTopic = repos.topics.create({
      assistantId: assistant.id,
      groupId: 'ordinary-chat',
      name: '普通聊天'
    })

    for (const topic of [sessionTopic, orphanTopic, unrelatedTopic]) {
      for (let index = 1; index <= 8; index += 1) {
        const turn = repos.messages.createUserMessageWithPlaceholders(topic.id, {
          userMessage: {
            mode: 'create',
            data: createAssistantTextData(`structured input ${topic.id} ${index}`),
            allowDetachedRoot: true
          },
          placeholders: [
            {
              modelId: 'openai:gpt-test',
              modelSnapshot: { id: 'gpt-test', name: 'GPT Test', provider: 'openai' }
            }
          ]
        })
        repos.messages.update(turn.placeholders[0]!.id, {
          status: 'success',
          data: createAssistantTextData(`structured output ${topic.id} ${index}`)
        })
      }
    }

    const owned = repos.topics.listByProductTemplateAndGroup({
      sourceProductId: 'sample-product',
      templateId: 'chart-indicator-analyst',
      groupId: 'chart-indicator-insight'
    })

    expect(owned.map((topic) => topic.id)).toEqual([sessionTopic.id, orphanTopic.id])
    for (const topic of owned) {
      repos.messages.pruneTopicToLatestTurns(topic.id, 5)
    }
    expect(repos.messages.listByTopic(sessionTopic.id)).toHaveLength(10)
    expect(repos.messages.listByTopic(orphanTopic.id)).toHaveLength(10)
    expect(repos.messages.listByTopic(unrelatedTopic.id)).toHaveLength(16)
  })

  function createRepos() {
    const dir = mkdtempSync(join(tmpdir(), 'assistant-platform-'))
    dirs.push(dir)
    const db = createAssistantPlatformDatabase(join(dir, 'assistants.sqlite'))
    return createAssistantPlatformRepositories(db)
  }
})
