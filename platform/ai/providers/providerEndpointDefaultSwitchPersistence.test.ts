import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createProviderStore } from './providerStore'
import type { ModelProvider, ProviderChatEndpoint } from './modelProviderTypes'
import { createProviderSqliteStorage } from './storage/providerSqliteStorage'

/**
 * T4/T5 回归：端点清单的顺序就是优先级 —— **切换默认端点 = 调整数组顺序**，
 * 不能丢/改任何其它端点。
 *
 * 这里走**真实 SQLite 存储 + store**（内存态与落库都断言），并覆盖增删路径。
 */
const directories: string[] = []

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'plat-t5-endpoint-switch-'))
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

/** 抽屉写入的实际载荷：整份端点清单（顺序即优先级）。 */
function draftInput(provider: ModelProvider, endpoints: readonly ProviderChatEndpoint[]) {
  return {
    id: provider.id,
    name: provider.name,
    enabled: provider.enabled,
    endpoints: [...endpoints],
    models: provider.models
  }
}

const threeEndpoints: ProviderChatEndpoint[] = [
  { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
  { protocol: 'responses', baseUrl: 'https://responses.siliconflow.cn' },
  { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' },
  { protocol: 'gemini', baseUrl: 'https://gemini.siliconflow.cn' }
]

async function seed(store: ReturnType<typeof createProviderStore>): Promise<ModelProvider> {
  await store.getState()
  await store.upsert({
    id: 'silicon',
    name: 'Silicon',
    endpoints: threeEndpoints,
    enabled: true,
    models: []
  })
  return (await store.getState()).providers.find((provider) => provider.id === 'silicon')!
}

describe('T4/T5 endpoint order is the default-endpoint source of truth', () => {
  it('moves the chosen endpoint to the front without dropping the others (memory and SQLite)', async () => {
    const path = workspace()
    const storage = sqliteStorage({ path })
    const store = createProviderStore(storage)
    const configured = await seed(store)

    expect(configured.endpoints.map((endpoint) => endpoint.protocol))
      .toEqual(['chat-completions', 'responses', 'messages', 'gemini'])
    // 默认端点 = endpoints[0]。
    expect(configured.endpoints[0]?.protocol).toBe('chat-completions')

    // 「设为默认」= 把 messages 移到数组头部。
    const moved = [configured.endpoints[2]!, ...configured.endpoints.filter((entry) => entry.protocol !== 'messages')]
    await store.upsert(draftInput(configured, moved))

    const switched = (await store.getState()).providers.find((provider) => provider.id === 'silicon')!
    expect(switched.endpoints.map((endpoint) => endpoint.protocol))
      .toEqual(['messages', 'chat-completions', 'responses', 'gemini'])
    expect(switched.endpoints[0]?.baseUrl).toBe('https://api.siliconflow.cn')
    // 主地址仍由 chat/completions 端点派生。
    expect(switched.baseUrl).toBe('https://api.siliconflow.cn')
    storage.close()

    // 从磁盘读回来：四个端点仍在、顺序一致（防止只有内存态正确、落库时被冲掉）。
    const reopened = createProviderStore(sqliteStorage({ path }))
    const persisted = (await reopened.getState()).providers.find((provider) => provider.id === 'silicon')!
    expect(persisted.endpoints).toEqual([
      { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' },
      { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
      { protocol: 'responses', baseUrl: 'https://responses.siliconflow.cn' },
      { protocol: 'gemini', baseUrl: 'https://gemini.siliconflow.cn' }
    ])
  })

  it('persists a declared-but-unconfigured endpoint (empty base) across a restart', async () => {
    const path = workspace()
    const storage = sqliteStorage({ path })
    const store = createProviderStore(storage)
    const configured = await seed(store)

    // 「已声明但没配地址」的聊天端点必须能 round-trip（空串 ≠ 没有这个端点）。
    await store.upsert(draftInput(configured, [
      ...configured.endpoints.filter((endpoint) => endpoint.protocol !== 'responses'),
      { protocol: 'responses', baseUrl: '' }
    ]))
    storage.close()

    const reopened = createProviderStore(sqliteStorage({ path }))
    const persisted = (await reopened.getState()).providers.find((provider) => provider.id === 'silicon')!
    expect(persisted.endpoints.find((endpoint) => endpoint.protocol === 'responses'))
      .toEqual({ protocol: 'responses', baseUrl: '' })
  })

  it('keeps the other endpoints when one of them is deleted', async () => {
    const path = workspace()
    const storage = sqliteStorage({ path })
    const store = createProviderStore(storage)
    const configured = await seed(store)

    // 删除 responses：只从清单里移除它，其余端点原样保留。
    await store.upsert(draftInput(
      configured,
      configured.endpoints.filter((endpoint) => endpoint.protocol !== 'responses')
    ))

    const afterDelete = (await store.getState()).providers.find((provider) => provider.id === 'silicon')!
    expect(afterDelete.endpoints.map((endpoint) => endpoint.protocol))
      .toEqual(['chat-completions', 'messages', 'gemini'])
    storage.close()

    const reopened = createProviderStore(sqliteStorage({ path }))
    const persisted = (await reopened.getState()).providers.find((provider) => provider.id === 'silicon')!
    expect(persisted.endpoints.map((endpoint) => endpoint.protocol))
      .toEqual(['chat-completions', 'messages', 'gemini'])
    expect(persisted.endpoints.find((endpoint) => endpoint.protocol === 'gemini')?.baseUrl)
      .toBe('https://gemini.siliconflow.cn')
  })
})
