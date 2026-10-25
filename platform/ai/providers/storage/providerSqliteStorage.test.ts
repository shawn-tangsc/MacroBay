import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { createProviderStore, type ProviderStore } from '../providerStore'
import { createSystemProviderPresets } from '../providerPresets'
import type { ModelDefinition, ModelProvider } from '../modelProviderTypes'
import { createProviderSqliteStorage } from './providerSqliteStorage'

/**
 * PLAT-72 阶段 1：SQLite 存储 + 预设种子。
 *
 * 关键约束：
 *  - 首次启动（空库）用预设灌种子：全部 `enabled=false`、无 Key、无自定义端点/请求头；
 *  - 种子只灌一次（`meta.seeded`），用户删光供应商后重启不得被复活；
 *  - 写入单事务：中途抛错必须整体回滚，库回到上一状态；
 *  - 旧 `model-providers.json` 不读/不改/不删（用户备份）。
 */
const directories: string[] = []

function workspace(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'plat72-provider-sqlite-'))
  directories.push(directory)
  return { directory, databasePath: join(directory, 'model-providers.sqlite') }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** 与持久化同口径：undefined 字段不落库，比较前按 canonical JSON 归一。 */
function canon<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function provider(overrides: Partial<ModelProvider> & Pick<ModelProvider, 'id'>): ModelProvider {
  return {
    name: overrides.id,
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://example.test' }
    ],
    enabled: false,
    baseUrl: 'https://example.test',
    models: [],
    ...overrides
  }
}

/** 直接读库（绕过 storage）用于断言"磁盘上到底写了什么"。 */
function queryRows<T>(databasePath: string, sql: string, ...parameters: Array<string | number>): T[] {
  const connection = new DatabaseSync(databasePath)
  try {
    return connection.prepare(sql).all(...parameters) as unknown as T[]
  } finally {
    connection.close()
  }
}

describe('PLAT-72 provider sqlite storage', () => {
  it('seeds the preset catalog once, disabled and keyless', async () => {
    const { databasePath } = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    const seeded = await storage.read() as { providers: ModelProvider[] }
    storage.close()

    const presets = createSystemProviderPresets()
    expect(seeded.providers).toHaveLength(presets.length)
    // 逐字段比较（预设的 `apiKey: ''` 只在内存里，不落库）。
    expect(canon(seeded.providers.map(({ apiKey: _apiKey, ...rest }) => rest)))
      .toStrictEqual(canon(presets.map(({ apiKey: _apiKey, ...rest }) => rest)))
    expect(seeded.providers.every((item) => item.enabled === false)).toBe(true)

    const meta = queryRows<{ key: string }>(databasePath, 'select key from model_provider_meta')
    expect(meta.map((row) => row.key)).toEqual(['preset_version', 'seeded'])
    const secrets = queryRows<{ total: number }>(databasePath, 'select count(*) as total from model_provider_secrets')
    expect(secrets[0].total).toBe(0)
  })

  it('does not re-seed or rewrite on a second start', async () => {
    const { databasePath } = workspace()
    const first = createProviderSqliteStorage({ path: databasePath })
    await first.read()
    first.close()
    const before = queryRows<Record<string, unknown>>(
      databasePath,
      'select id, name, enabled, base_url, endpoints_json, image_endpoints_json, sort_index, updated_at from model_providers order by sort_index asc, id asc'
    )

    const second = createProviderSqliteStorage({ path: databasePath })
    const reread = await second.read() as { providers: ModelProvider[] }
    second.close()
    const after = queryRows<Record<string, unknown>>(
      databasePath,
      'select id, name, enabled, base_url, endpoints_json, image_endpoints_json, sort_index, updated_at from model_providers order by sort_index asc, id asc'
    )

    expect(before).toHaveLength(createSystemProviderPresets().length)
    expect(after).toStrictEqual(before)
    expect(reread.providers).toHaveLength(before.length)
  })

  it('does not resurrect presets after the user deletes everything', async () => {
    const { databasePath } = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    await storage.read()
    await storage.write({ providers: [] })
    storage.close()

    expect(queryRows<{ total: number }>(databasePath, 'select count(*) as total from model_providers')[0].total).toBe(0)

    const restarted = createProviderSqliteStorage({ path: databasePath })
    const state = await restarted.read() as { providers: ModelProvider[] }
    restarted.close()

    expect(state.providers).toEqual([])
    expect(queryRows<{ total: number }>(databasePath, 'select count(*) as total from model_providers')[0].total).toBe(0)
    expect(queryRows<{ key: string }>(databasePath, 'select key from model_provider_meta').map((row) => row.key))
      .toEqual(['preset_version', 'seeded'])
  })

  it('round-trips user edits through the provider store (single write entry)', async () => {
    const { databasePath } = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    const store: ProviderStore = createProviderStore(storage)

    await store.setEnabled('deepseek', true)
    await store.addOrUpdateModel('deepseek', { id: 'user-model', name: 'User Model', capabilities: { chat: true } })
    await store.removeModel('deepseek', 'deepseek-chat')
    await store.setDefaultChatModel('deepseek', 'user-model')
    storage.close()

    const persistedBefore = queryRows<{ id: string; updated_at: string }>(
      databasePath,
      'select id, updated_at from model_providers order by id asc'
    )

    const restarted = createProviderSqliteStorage({ path: databasePath })
    const state = await createProviderStore(restarted).getState()
    const deepseek = state.providers.find((item) => item.id === 'deepseek')!
    restarted.close()

    // 读路径不得回写：第二次启动后每行的 updated_at 必须原封不动。
    expect(queryRows<{ id: string; updated_at: string }>(
      databasePath,
      'select id, updated_at from model_providers order by id asc'
    )).toStrictEqual(persistedBefore)

    expect(deepseek.enabled).toBe(true)
    expect(deepseek.defaultChatModelId).toBe('user-model')
    expect(deepseek.models.map((model) => model.id)).toContain('user-model')
    expect(deepseek.models.map((model) => model.id)).not.toContain('deepseek-chat')
    expect(deepseek.removedPresetModelIds).toContain('deepseek-chat')
  })

  it('keeps each provider row independent from the rest of the catalog', async () => {
    const { databasePath } = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    await storage.read()
    await storage.write({
      providers: [
        provider({
          id: 'custom-one',
          name: 'Custom One',
          enabled: true,
          endpoints: [
            { protocol: 'responses', baseUrl: 'https://custom.test/v1' },
            { protocol: 'chat-completions', baseUrl: 'https://custom.test/v1' },
            { protocol: 'messages', baseUrl: 'https://custom.test/anthropic' }
          ],
          // 空串（已声明未配置）也必须能落库并读回。
          imageEndpoints: { generation: '' },
          customHeaders: [{ name: 'X-Owner', value: 'plat72' }],
          removedPresetModelIds: ['gone-preset-model'],
          models: [{
            id: 'm1',
            name: 'M1',
            provider: 'custom-one',
            presetModel: true,
            presetStale: true,
            providerDeclared: true,
            capabilities: { chat: true, vision: true, capabilitiesEdited: true },
            chatProtocol: 'responses',
            messagesSupport: 'yes',
            probeStatus: 'passed',
            probeReason: 'provider_capability',
            protocolProbedAt: '2026-10-20T00:00:00.000Z',
            contextLength: 128000,
            maxCompletionTokens: 8192,
            pricing: { currency: 'USD', promptPerMillion: 1, completionPerMillion: 2, cacheReadPerMillion: 0.5, hasDiscount: true }
          }]
        })
      ]
    })
    const reloaded = await storage.read() as { providers: ModelProvider[] }
    storage.close()

    const [custom] = reloaded.providers
    expect(reloaded.providers).toHaveLength(1)
    expect(canon(custom)).toStrictEqual(canon(provider({
      id: 'custom-one',
      name: 'Custom One',
      enabled: true,
      // 主地址由端点派生（chat/completions 优先）；尾斜杠由端点归一化去掉。
      baseUrl: 'https://custom.test/v1',
      endpoints: [
        { protocol: 'responses', baseUrl: 'https://custom.test/v1' },
        { protocol: 'chat-completions', baseUrl: 'https://custom.test/v1' },
        { protocol: 'messages', baseUrl: 'https://custom.test/anthropic' }
      ],
      // 图像端点的空串不保留（缺省 = 未配置），它不属于聊天端点清单。
      customHeaders: [{ name: 'X-Owner', value: 'plat72' }],
      isSystem: false,
      removedPresetModelIds: ['gone-preset-model'],
      models: [{
        id: 'm1',
        name: 'M1',
        provider: 'custom-one',
        presetModel: true,
        presetStale: true,
        providerDeclared: true,
        capabilities: { chat: true, vision: true, capabilitiesEdited: true },
        chatProtocol: 'responses',
        messagesSupport: 'yes',
        probeStatus: 'passed',
        probeReason: 'provider_capability',
        protocolProbedAt: '2026-10-20T00:00:00.000Z',
        contextLength: 128000,
        maxCompletionTokens: 8192,
        pricing: { currency: 'USD', promptPerMillion: 1, completionPerMillion: 2, cacheReadPerMillion: 0.5, hasDiscount: true }
      }]
    })))
  })

  it('rolls back the whole write when serialization fails mid-transaction', async () => {
    const { databasePath } = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    await storage.read()
    const before = queryRows<{ id: string }>(databasePath, 'select id from model_providers order by id asc')

    const poisoned = {
      providers: [provider({
        id: 'poisoned',
        // capabilities 里塞 BigInt ⇒ JSON.stringify 抛错，用来验证事务整体回滚。
        models: [{ id: 'm1', name: 'M1', capabilities: { chat: true, nested: 1n } } as unknown as ModelDefinition]
      })]
    } as unknown as Parameters<typeof storage.write>[0]

    await expect(storage.write(poisoned)).rejects.toThrow()
    const after = queryRows<{ id: string }>(databasePath, 'select id from model_providers order by id asc')
    const reloaded = await storage.read() as { providers: ModelProvider[] }
    storage.close()

    expect(after).toStrictEqual(before)
    expect(reloaded.providers.map((item) => item.id)).not.toContain('poisoned')
  })

  it('cascades model and secret rows when a provider is removed', async () => {
    const { databasePath } = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    const store = createProviderStore(storage)
    await store.getState()
    await store.remove('deepseek')

    expect(queryRows<{ total: number }>(databasePath, 'select count(*) as total from model_providers where id = ?', 'deepseek')[0].total).toBe(0)
    expect(queryRows<{ total: number }>(databasePath, 'select count(*) as total from model_models where provider_id = ?', 'deepseek')[0].total).toBe(0)
    expect(queryRows<{ total: number }>(databasePath, 'select count(*) as total from model_provider_secrets where provider_id = ?', 'deepseek')[0].total).toBe(0)
    storage.close()
  })

  it('leaves the deprecated model-providers.json untouched', async () => {
    const { directory, databasePath } = workspace()
    const legacyPath = join(directory, 'model-providers.json')
    const legacyContent = '{\n  "providers": [{ "id": "silicon", "enabled": true }]\n}\n'
    writeFileSync(legacyPath, legacyContent, 'utf8')

    const storage = createProviderSqliteStorage({ path: databasePath })
    await storage.read()
    await storage.write({ providers: [provider({ id: 'custom-one' })] })
    storage.close()

    expect(readFileSync(legacyPath, 'utf8')).toBe(legacyContent)
    expect(readdirSync(directory).filter((name) => name.startsWith('model-providers.json.migrated'))).toEqual([])
    expect(existsSync(databasePath)).toBe(true)
  })

  it('converges a pre-endpoints database onto the endpoints columns', async () => {
    const { databasePath } = workspace()
    const first = createProviderSqliteStorage({ path: databasePath })
    await first.read()
    first.close()

    // 模拟"旧库"：把端点列退回 0005 之前（旧字段 + 迁移记录一起回退）。
    const legacy = new DatabaseSync(databasePath)
    legacy.exec('alter table model_providers drop column endpoints_json;')
    legacy.exec('alter table model_providers drop column image_endpoints_json;')
    legacy.exec("alter table model_providers add column protocols_json text not null default '[]';")
    legacy.exec("alter table model_providers add column protocol_overrides_json text not null default '{}';")
    legacy.exec('alter table model_providers add column default_chat_protocol text;')
    legacy.exec('alter table model_providers add column anthropic_base_url text;')
    legacy.prepare('delete from model_provider_migrations where id = ?').run('0005_model_provider_endpoints_columns')
    legacy.close()

    const upgraded = createProviderSqliteStorage({ path: databasePath })
    const state = await upgraded.read() as { providers: ModelProvider[] }
    upgraded.close()

    const columns = queryRows<{ name: string }>(databasePath, 'pragma table_info(model_providers)').map((row) => row.name)
    expect(columns).toEqual(expect.arrayContaining(['endpoints_json', 'image_endpoints_json']))
    expect(columns).not.toEqual(expect.arrayContaining([
      'protocols_json', 'protocol_overrides_json', 'default_chat_protocol', 'anthropic_base_url'
    ]))
    expect(queryRows<{ id: string }>(databasePath, 'select id from model_provider_migrations').map((row) => row.id))
      .toContain('0005_model_provider_endpoints_columns')
    // 旧列不读：端点清单从空的 `endpoints_json` 读回空数组（用户已清空本地供应商库）。
    for (const provider of state.providers) expect(provider.endpoints).toEqual([])
  })

  it('adds the declaration columns to a database created before they existed', async () => {
    const { databasePath } = workspace()
    const first = createProviderSqliteStorage({ path: databasePath })
    await first.read()
    first.close()

    // 模拟"旧库"：把三列与这条迁移记录一起退回 0004 之前的状态。
    const legacy = new DatabaseSync(databasePath)
    legacy.exec('alter table model_models drop column supported_protocols_json;')
    legacy.exec('alter table model_models drop column responses_support;')
    legacy.exec('alter table model_models drop column declaration_source;')
    legacy.prepare("delete from model_provider_migrations where id = ?").run('0004_model_declaration_columns')
    legacy.close()

    const upgraded = createProviderSqliteStorage({ path: databasePath })
    await upgraded.read()
    upgraded.close()

    const columns = queryRows<{ name: string }>(databasePath, 'pragma table_info(model_models)').map((row) => row.name)
    expect(columns).toEqual(expect.arrayContaining(['supported_protocols_json', 'responses_support', 'declaration_source']))
    expect(queryRows<{ id: string }>(databasePath, 'select id from model_provider_migrations').map((row) => row.id))
      .toContain('0004_model_declaration_columns')
    // 旧行是 NULL ⇒ 读回 undefined（不凭空造值；由 providerStore 归一化时回填）。
    expect(queryRows<{ total: number }>(
      databasePath,
      'select count(*) as total from model_models where supported_protocols_json is not null'
    )[0].total).toBe(0)
  })

  it('backfills supportedProtocols for legacy rows once and persists it (PLAT-82)', async () => {
    const { databasePath } = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    await storage.read()
    // 迁移前的行：没有 supported_protocols_json（字段是后加的）。
    await storage.write({
      providers: [provider({
        id: 'custom-one',
        endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://custom.test/v1' }],
        models: [
          { id: 'chat-model', name: 'Chat Model', capabilities: { chat: true }, chatProtocol: 'chat-completions', messagesSupport: 'yes' },
          { id: 'video-model', name: 'Video Model', capabilities: { chat: false, videoGeneration: true } }
        ]
      })]
    })
    storage.close()
    expect(queryRows<{ total: number }>(
      databasePath,
      'select count(*) as total from model_models where supported_protocols_json is not null'
    )[0].total).toBe(0)

    // 启动一次 store：缺失的模型回填一次并落库（之后就是模型自己的事实）。
    const reopened = createProviderSqliteStorage({ path: databasePath })
    const state = await createProviderStore(reopened).getState()
    reopened.close()
    const models = state.providers.find((entry) => entry.id === 'custom-one')?.models ?? []
    expect(models.find((model) => model.id === 'chat-model')?.supportedProtocols)
      .toEqual(['chat-completions', 'messages'])
    expect(queryRows<{ supported_protocols_json: string | null }>(
      databasePath,
      'select supported_protocols_json from model_models where provider_id = ? order by model_id',
      'custom-one'
    ).map((row) => row.supported_protocols_json))
      // 聊天模型回填「默认端点 + 声明」；媒体模型不因默认端点进入协议集合。
      .toEqual(['["chat-completions","messages"]', null])
  })

  it('round-trips the PLAT-82 model declaration columns', async () => {
    const { databasePath } = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    const model = {
      id: 'm1',
      name: 'M1',
      capabilities: { chat: true },
      chatProtocol: 'responses' as const,
      messagesSupport: 'yes' as const
    }
    await storage.read()
    await storage.write({ providers: [provider({ id: 'custom-one', models: [model] })] })
    // 第二次写入只改 responsesSupport / declarationSource / supportedProtocols：
    // `modelRowContent` 必须把它们算进变更检测，否则这几列永远写不进去。
    await storage.write({
      providers: [provider({
        id: 'custom-one',
        models: [{
          ...model,
          responsesSupport: 'yes',
          declarationSource: 'provider_list',
          supportedProtocols: ['chat-completions', 'responses', 'messages'],
          declaredProtocols: ['responses', 'messages']
        }]
      })]
    })
    storage.close()

    const reopened = createProviderSqliteStorage({ path: databasePath })
    const state = await reopened.read() as { providers: ModelProvider[] }
    reopened.close()
    expect(state.providers[0]?.models[0]).toMatchObject({
      chatProtocol: 'responses',
      messagesSupport: 'yes',
      responsesSupport: 'yes',
      declarationSource: 'provider_list',
      supportedProtocols: ['chat-completions', 'responses', 'messages'],
      declaredProtocols: ['responses', 'messages']
    })
    const rows = queryRows<{ responses_support: string | null; declaration_source: string | null }>(
      databasePath,
      'select responses_support, declaration_source from model_models where model_id = ?',
      'm1'
    )
    expect(rows[0]).toEqual({ responses_support: 'yes', declaration_source: 'provider_list' })
  })

  it('round-trips the detection evidence column and keeps it across a reopen', async () => {
    const { databasePath } = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    const model = {
      id: 'm1',
      name: 'M1',
      capabilities: { chat: true },
      chatProtocol: 'chat-completions' as const
    }
    await storage.read()
    await storage.write({ providers: [provider({ id: 'custom-one', models: [model] })] })
    // 只改 probedProtocols + supportedProtocols：`modelRowContent` 必须把它们算进变更检测，
    // 否则检测结论永远写不进库。
    await storage.write({
      providers: [provider({
        id: 'custom-one',
        models: [{
          ...model,
          supportedProtocols: ['chat-completions', 'messages'],
          probedProtocols: ['messages']
        }]
      })]
    })
    storage.close()

    // 重开库（新进程模拟）：检测证据仍在。
    const reopened = createProviderSqliteStorage({ path: databasePath })
    const state = await reopened.read() as { providers: ModelProvider[] }
    reopened.close()
    expect(state.providers[0]?.models[0]).toMatchObject({
      supportedProtocols: ['chat-completions', 'messages'],
      probedProtocols: ['messages']
    })
    expect(queryRows<{ probed_protocols_json: string | null }>(
      databasePath,
      'select probed_protocols_json from model_models where model_id = ?',
      'm1'
    )[0]).toEqual({ probed_protocols_json: '["messages"]' })
  })

  it('adds the detection evidence column to a database created before it existed', async () => {
    const { databasePath } = workspace()
    const first = createProviderSqliteStorage({ path: databasePath })
    await first.read()
    first.close()

    // 模拟"旧库"：把列与 0007 记录一起退回。
    const legacy = new DatabaseSync(databasePath)
    legacy.exec('alter table model_models drop column probed_protocols_json;')
    legacy.prepare('delete from model_provider_migrations where id = ?').run('0007_model_probed_protocols_column')
    legacy.close()

    const upgraded = createProviderSqliteStorage({ path: databasePath })
    await upgraded.read()
    upgraded.close()

    const columns = queryRows<{ name: string }>(databasePath, 'pragma table_info(model_models)').map((row) => row.name)
    expect(columns).toContain('probed_protocols_json')
    expect(queryRows<{ id: string }>(databasePath, 'select id from model_provider_migrations').map((row) => row.id))
      .toContain('0007_model_probed_protocols_column')
    // 旧行是 NULL ⇒ 读回 undefined（不凭空造证据）。
    expect(queryRows<{ total: number }>(
      databasePath,
      'select count(*) as total from model_models where probed_protocols_json is not null'
    )[0].total).toBe(0)
  })

  it('round-trips the availability verdict and keeps it across a reopen', async () => {
    const { databasePath } = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    const availability = {
      status: 'failed' as const,
      reasonCode: 'http_401',
      checkedAt: '2026-10-25T05:00:00.000Z',
      fingerprint: 'av1-fixture'
    }
    await storage.read()
    await storage.write({
      providers: [provider({
        id: 'custom-one',
        models: [{ id: 'm1', name: 'M1', capabilities: { chat: true }, availability }]
      })]
    })
    storage.close()

    const reopened = createProviderSqliteStorage({ path: databasePath })
    const state = await reopened.read() as { providers: ModelProvider[] }
    reopened.close()
    expect(state.providers[0]?.models[0]?.availability).toEqual(availability)
    expect(queryRows<{ availability_json: string | null }>(
      databasePath,
      'select availability_json from model_models where model_id = ?',
      'm1'
    )[0].availability_json).toBe(JSON.stringify(availability))
  })

  it('adds the availability column to a database created before it existed', async () => {
    const { databasePath } = workspace()
    const first = createProviderSqliteStorage({ path: databasePath })
    await first.read()
    first.close()

    // 模拟"旧库"：把列与 0009 记录一起退回。
    const legacy = new DatabaseSync(databasePath)
    legacy.exec('alter table model_models drop column availability_json;')
    legacy.prepare('delete from model_provider_migrations where id = ?').run('0009_model_availability_column')
    legacy.close()

    const upgraded = createProviderSqliteStorage({ path: databasePath })
    await upgraded.read()
    upgraded.close()

    const columns = queryRows<{ name: string }>(databasePath, 'pragma table_info(model_models)').map((row) => row.name)
    expect(columns).toContain('availability_json')
    expect(queryRows<{ id: string }>(databasePath, 'select id from model_provider_migrations').map((row) => row.id))
      .toContain('0009_model_availability_column')
  })

  it('exposes exactly one write entry point', async () => {
    const storageModule = await import('./providerSqliteStorage')
    expect(Object.keys(storageModule)).toEqual(['createProviderSqliteStorage'])
  })
})
