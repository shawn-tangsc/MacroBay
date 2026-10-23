import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import type { ModelProvider, ProviderChatEndpoint } from './modelProviderTypes'
import { createProviderStore, normalizeProviderState, upsertProvider } from './providerStore'
import { createProviderSqliteStorage } from './storage/providerSqliteStorage'

/**
 * 端点墓碑的**唯一写入点**（`upsertProvider`）与落库：
 *
 *  - 本次写入的端点清单少了某个协议 ⇒ 记进 `removedEndpointProtocols`；
 *  - 再写回该协议 ⇒ 墓碑清除（`undefined` 语义，不写空数组）；
 *  - 预设合并不复活墓碑里的协议；
 *  - 墓碑能落库并读回（`removed_endpoint_protocols_json`，null = 没有墓碑）。
 */
const chat: ProviderChatEndpoint = { protocol: 'chat-completions', baseUrl: 'https://ai.burncloud.com' }
const messages: ProviderChatEndpoint = { protocol: 'messages', baseUrl: 'https://ai.burncloud.com' }
const gemini: ProviderChatEndpoint = { protocol: 'gemini', baseUrl: 'https://ai.burncloud.com' }

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function workspaceDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'provider-endpoint-tombstone-'))
  directories.push(directory)
  return join(directory, 'model-providers.sqlite')
}

function provider(id: string, endpoints: ProviderChatEndpoint[], removedEndpointProtocols?: string[]): unknown {
  return {
    providers: [{
      id,
      name: id,
      endpoints,
      enabled: true,
      baseUrl: endpoints[0]?.baseUrl ?? '',
      models: [],
      ...(removedEndpointProtocols ? { removedEndpointProtocols } : {})
    }]
  }
}

function endpointsOf(state: ReturnType<typeof normalizeProviderState>, providerId: string): string[] {
  const found = state.providers.find((provider) => provider.id === providerId)!
  return found.endpoints.map((endpoint) => endpoint.protocol)
}

describe('upsertProvider records endpoint deletions as tombstones', () => {
  it('records the protocol the new endpoint list dropped', () => {
    const initial = normalizeProviderState(provider('custom-burn', [chat, messages, gemini]))
    const next = upsertProvider(initial, {
      id: 'custom-burn',
      name: 'custom-burn',
      enabled: true,
      endpoints: [chat, messages]
    })

    const found = next.providers.find((item) => item.id === 'custom-burn')!
    expect(found.removedEndpointProtocols).toEqual(['gemini'])
    expect(found.endpoints).toEqual([chat, messages])
  })

  it('does not write a tombstone when the same protocols are kept with edited bases', () => {
    const initial = normalizeProviderState(provider('custom-burn', [chat, messages]))
    const next = upsertProvider(initial, {
      id: 'custom-burn',
      name: 'custom-burn',
      enabled: true,
      endpoints: [chat, { protocol: 'messages', baseUrl: 'https://proxy.example.test' }]
    })

    expect(next.providers[0].removedEndpointProtocols).toBeUndefined()
  })

  it('clears the tombstone when the user adds the protocol back', () => {
    const initial = normalizeProviderState(provider('custom-burn', [chat, messages]))
    const removed = upsertProvider(initial, {
      id: 'custom-burn',
      name: 'custom-burn',
      enabled: true,
      endpoints: [chat]
    })
    expect(removed.providers[0].removedEndpointProtocols).toEqual(['messages'])

    const reAdded = upsertProvider(removed, {
      id: 'custom-burn',
      name: 'custom-burn',
      enabled: true,
      endpoints: [chat, messages]
    })
    expect(reAdded.providers[0].removedEndpointProtocols).toBeUndefined()
    expect(endpointsOf(reAdded, 'custom-burn')).toEqual(['chat-completions', 'messages'])
  })

  it('keeps the tombstones of a write that does not touch the endpoint list', () => {
    const initial = normalizeProviderState(provider('custom-burn', [chat, messages, gemini]))
    const removed = upsertProvider(initial, {
      id: 'custom-burn',
      name: 'custom-burn',
      enabled: true,
      endpoints: [chat, messages]
    })

    // 改开关 / 改 Key 之类的写入不带 endpoints ⇒ 墓碑必须原样保留。
    const renamed = upsertProvider(removed, {
      id: 'custom-burn',
      name: 'Renamed',
      enabled: true
    })
    expect(renamed.providers[0].removedEndpointProtocols).toEqual(['gemini'])
  })
})

describe('the preset merge never revives a tombstoned endpoint protocol', () => {
  it('appends a preset protocol once, then leaves it deleted after the user removes it', () => {
    const presetBurnCloud = normalizeProviderState(provider('burncloud', [chat, messages]))
    // 第一次合并：预设新增的 gemini 自动补进来，默认端点位置不变。
    expect(endpointsOf(presetBurnCloud, 'burncloud')).toEqual(['chat-completions', 'messages', 'gemini'])

    const removed = upsertProvider(presetBurnCloud, {
      id: 'burncloud',
      name: 'BurnCloud',
      enabled: true,
      endpoints: [chat, messages]
    })
    const restarted = normalizeProviderState(removed)
    expect(endpointsOf(restarted, 'burncloud')).toEqual(['chat-completions', 'messages'])
    expect(restarted.providers.find((item) => item.id === 'burncloud')?.removedEndpointProtocols)
      .toEqual(['gemini'])

    // 再重启一次也不会回来（墓碑稳定）。
    expect(endpointsOf(normalizeProviderState(restarted), 'burncloud')).toEqual(['chat-completions', 'messages'])
  })

  it('keeps an emptied endpoint list empty when every preset protocol is tombstoned', () => {
    const state = normalizeProviderState(provider('burncloud', [], [
      'chat-completions',
      'messages',
      'gemini'
    ])) as { providers: ModelProvider[] }

    expect(state.providers.find((item) => item.id === 'burncloud')?.endpoints).toEqual([])
  })
})

describe('endpoint tombstones survive the sqlite round trip', () => {
  it('persists the tombstone and reads it back after a restart', async () => {
    const databasePath = workspaceDatabasePath()
    const storage = createProviderSqliteStorage({ path: databasePath })
    const store = createProviderStore(storage)

    await store.upsert({ id: 'custom-one', name: 'Custom One', enabled: true, endpoints: [chat, messages, gemini] })
    await store.upsert({ id: 'custom-one', name: 'Custom One', enabled: true, endpoints: [chat, messages] })
    storage.close()

    const restarted = createProviderSqliteStorage({ path: databasePath })
    const state = await createProviderStore(restarted).getState()
    restarted.close()

    const found = state.providers.find((item) => item.id === 'custom-one')!
    expect(found.removedEndpointProtocols).toEqual(['gemini'])
    expect(found.endpoints.map((endpoint) => endpoint.protocol)).toEqual(['chat-completions', 'messages'])
  })

  it('adds the tombstone column to a database created before it existed', async () => {
    const databasePath = workspaceDatabasePath()
    const first = createProviderSqliteStorage({ path: databasePath })
    await first.read()
    first.close()

    // 模拟"旧库"：把墓碑列与它的迁移记录一起退回 0008 之前。
    const legacy = new DatabaseSync(databasePath)
    legacy.exec('alter table model_providers drop column removed_endpoint_protocols_json;')
    legacy.prepare('delete from model_provider_migrations where id = ?')
      .run('0008_model_provider_removed_endpoint_protocols_column')
    legacy.close()

    const upgraded = createProviderSqliteStorage({ path: databasePath })
    const state = await upgraded.read() as { providers: Array<{ endpoints: unknown[] }> }
    upgraded.close()

    const columns = new DatabaseSync(databasePath)
    const names = (columns.prepare('pragma table_info(model_providers)').all() as unknown as Array<{ name: string }>)
      .map((column) => column.name)
    // 不回填：旧行是 NULL ⇒ 没有墓碑，端点清单原样读回。
    const tombstones = columns
      .prepare('select count(*) as total from model_providers where removed_endpoint_protocols_json is not null')
      .get() as { total?: number }
    columns.close()

    expect(names).toContain('removed_endpoint_protocols_json')
    expect(tombstones.total).toBe(0)
    expect(state.providers.length).toBeGreaterThan(0)
  })
})
