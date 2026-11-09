import { describe, expect, it, vi } from 'vitest'

import { createAssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import { createAssistantPlatformRepositories } from '../repositories/createAssistantPlatformRepositories'
import { createDefaultAssistantSeed } from '../seeds/defaultAssistantSeed'
import { createAssistantChatRuntimeService } from './AssistantChatRuntimeService'

/**
 * 崩溃收尾的判据是 `ownerBootId`——「这条 pending 是哪一次主进程启动写的」。
 * 与 agent 侧同一口径：本批次的不动，缺失（老行）和别的批次都收，不用时间判。
 */

const CURRENT_BOOT = 'boot-current'
const PREVIOUS_BOOT = 'boot-previous'

function harness(bootId?: string) {
  const db = createAssistantPlatformDatabase(':memory:')
  const repos = createAssistantPlatformRepositories(db, bootId === undefined ? {} : { bootId })
  const assistant = repos.assistants.create(createDefaultAssistantSeed())
  const topic = repos.topics.create({ assistantId: assistant.id })
  const runtime = createAssistantChatRuntimeService({
    fetch: vi.fn() as unknown as typeof fetch,
    repos,
    ownerBootId: CURRENT_BOOT,
    getProviderState: async () => ({ providers: [] })
  })
  return { repos, topic, runtime }
}

describe('assistant startup convergence judged by ownerBootId', () => {
  it('①收掉上一个进程批次留下的 pending', () => {
    const { repos, topic, runtime } = harness(PREVIOUS_BOOT)
    repos.messages.create(topic.id, { role: 'assistant', data: { parts: [] }, status: 'pending' })

    expect(runtime.reconcileStalePending()).toBe(1)
    expect(repos.messages.listByTopic(topic.id)[0]?.status).toBe('error')
  })

  it('②本批次的 pending 一条都不动', () => {
    const { repos, topic, runtime } = harness(CURRENT_BOOT)
    repos.messages.create(topic.id, { role: 'assistant', data: { parts: [] }, status: 'pending' })

    expect(runtime.reconcileStalePending()).toBe(0)
    expect(repos.messages.listByTopic(topic.id)[0]?.status).toBe('pending')
  })

  it('③没有字段的老行仍是「上一个进程」，在 boot 那一趟收掉', () => {
    const { repos, topic, runtime } = harness(undefined)
    repos.messages.create(topic.id, { role: 'assistant', data: { parts: [] }, status: 'pending' })

    expect(runtime.reconcileStalePending()).toBe(1)
    expect(repos.messages.listByTopic(topic.id)[0]?.status).toBe('error')
    // 老行收一次就定了：再跑一次不许重复改（否则每次读都跑一遍就成了运行期收尾）。
    expect(runtime.reconcileStalePending()).toBe(0)
  })
})
