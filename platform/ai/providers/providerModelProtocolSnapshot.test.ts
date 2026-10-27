import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createProviderStore } from './providerStore'
import type { ModelProvider } from './modelProviderTypes'
import { createProviderSqliteStorage } from './storage/providerSqliteStorage'
import { DEFAULT_MODEL_LIST_SHAPE } from './modelList/modelListShape'
import { normalizeRemoteModels } from './modelList/remoteModelNormalize'

/**
 * T4/T5：协议是**模型自己的事实**。
 *
 * - 同步/新增时把「厂商声明 ?? 供应商当时的默认端点」写进 `ModelDefinition.chatProtocol` 并落库；
 * - 之后改供应商默认端点只影响以后新加/新同步的模型，已存在的模型不变；
 * - 旧数据（没有 `chatProtocol`）在加载时回填一次并落库，此后固定不再跟随。
 */
const directories: string[] = []

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'plat-t5-model-protocol-'))
  directories.push(directory)
  return join(directory, 'model-providers.sqlite')
}

/**
 * Windows cannot unlink a SQLite file that is still open, so the teardown has to close the
 * storage before deleting its directory; otherwise rmSync throws EBUSY/EPERM and an otherwise
 * green test is reported as failed. The retry is only a backstop for the close file handle.
 */
const storages: Array<{ close: () => void }> = []

function sqliteStorage(options: Parameters<typeof createProviderSqliteStorage>[0]) {
  const storage = createProviderSqliteStorage(options)
  storages.push(storage)
  return storage
}

afterEach(() => {
  for (const storage of storages.splice(0)) {
    try {
      storage.close()
    } catch {
      // The case already closed it; close() is idempotent.
    }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

function chatModel(id: string) {
  return { id, name: id, provider: 'acme', capabilities: { chat: true } }
}

/** 抽屉写入的实际载荷：整份端点清单（顺序即优先级，`[0]` = 默认端点）。 */
function draftInput(provider: ModelProvider, endpoints: ModelProvider['endpoints']) {
  return {
    id: provider.id,
    name: provider.name,
    enabled: provider.enabled,
    endpoints: [...endpoints],
    models: provider.models
  }
}

describe('T4/T5 models keep their own chat protocol', () => {
  it('does not change existing models when the provider default endpoint changes', async () => {
    const path = workspace()
    const storage = sqliteStorage({ path })
    const store = createProviderStore(storage)
    await store.getState()

    await store.upsert({
      id: 'silicon',
      name: 'Silicon',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
        { protocol: 'responses', baseUrl: 'https://responses.siliconflow.cn' },
        { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
      ],
      enabled: true,
      models: [{ ...chatModel('acme-chat'), provider: 'silicon', presetModel: true }]
    })
    const before = (await store.getState()).providers.find((provider) => provider.id === 'silicon')!
    expect(before.models.find((model) => model.id === 'acme-chat')?.chatProtocol).toBe('chat-completions')

    // 只改供应商默认端点（抽屉「设为默认」的同一份写入：把 responses 移到清单头部）。
    await store.upsert(draftInput(before, [
      before.endpoints.find((endpoint) => endpoint.protocol === 'responses')!,
      ...before.endpoints.filter((endpoint) => endpoint.protocol !== 'responses')
    ]))

    const after = (await store.getState()).providers.find((provider) => provider.id === 'silicon')!
    expect(after.endpoints[0]?.protocol).toBe('responses')
    // 已存在的模型协议**不变**（它已经是模型自己的事实）。
    expect(after.models.find((model) => model.id === 'acme-chat')?.chatProtocol).toBe('chat-completions')
    storage.close()

    const reopened = createProviderStore(sqliteStorage({ path }))
    const persisted = (await reopened.getState()).providers.find((provider) => provider.id === 'silicon')!
    expect(persisted.models.find((model) => model.id === 'acme-chat')?.chatProtocol).toBe('chat-completions')
  })

  it('gives models synced later the provider default endpoint of that moment', () => {
    const items = [
      { id: 'plain-chat' },
      { id: 'messages-chat', supports_anthropic: true },
      { id: 'responses-chat', supports_responses: true }
    ]

    const syncedUnderChat = normalizeRemoteModels(items, DEFAULT_MODEL_LIST_SHAPE, {
      providerDefaultProtocol: 'chat-completions'
    })
    expect(syncedUnderChat.map((model) => [model.id, model.chatProtocol])).toEqual([
      ['plain-chat', 'chat-completions'],
      // 声明不抢默认路由：默认永远是**同步那一刻的供应商默认端点**。
      ['messages-chat', 'chat-completions'],
      ['responses-chat', 'chat-completions']
    ])

    const syncedUnderGemini = normalizeRemoteModels(items, DEFAULT_MODEL_LIST_SHAPE, {
      providerDefaultProtocol: 'gemini'
    })
    expect(syncedUnderGemini.map((model) => model.chatProtocol)).toEqual(['gemini', 'gemini', 'gemini'])
  })

  it('backfills old models with the current default exactly once and persists it', async () => {
    const path = workspace()

    // 模拟旧库：模型只有 id/name/capabilities，没有 chatProtocol。
    const legacyStorage = sqliteStorage({ path })
    await legacyStorage.write({
      providers: [{
        id: 'gemini',
        name: 'Gemini',
        endpoints: [
          { protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' }
        ],
        enabled: true,
        baseUrl: 'https://generativelanguage.googleapis.com',
        isSystem: true,
        models: [chatModel('gemini-3.5-flash')]
      }]
    })
    legacyStorage.close()

    // 加载 ⇒ 回填成当时的默认端点（gemini），并写回库。
    const storage = sqliteStorage({ path })
    const store = createProviderStore(storage)
    const loaded = (await store.getState()).providers.find((provider) => provider.id === 'gemini')!
    expect(loaded.models.find((model) => model.id === 'gemini-3.5-flash')?.chatProtocol).toBe('gemini')
    storage.close()

    const persisted = createProviderStore(sqliteStorage({ path }))
    const reread = (await persisted.getState()).providers.find((provider) => provider.id === 'gemini')!
    expect(reread.models.find((model) => model.id === 'gemini-3.5-flash')?.chatProtocol).toBe('gemini')

    // 之后改默认端点：回填过的模型**不再跟随**。
    const changing = createProviderStore(sqliteStorage({ path }))
    const current = (await changing.getState()).providers.find((provider) => provider.id === 'gemini')!
    await changing.upsert(draftInput(current, [
      { protocol: 'chat-completions', baseUrl: 'https://generativelanguage.googleapis.com' },
      ...current.endpoints
    ]))
    const changed = (await changing.getState()).providers.find((provider) => provider.id === 'gemini')!
    expect(changed.endpoints[0]?.protocol).toBe('chat-completions')
    expect(changed.models.find((model) => model.id === 'gemini-3.5-flash')?.chatProtocol).toBe('gemini')
  })
})
