import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProviderPresetVersionMetaKey, createProviderStore, normalizeProviderState } from '../providerStore'
import { systemPresetsVersion } from '../providerPresetMerge'
import { createProviderSqliteStorage } from './providerSqliteStorage'

/**
 * PLAT-78：**启动零写入**。
 *
 * 核心证据是 `storage.write` 的调用次数：版本一致时必须是 **0**——启动不该因为
 * "合并预设"而改写用户库；版本变化（或旧库没有版本号）时才合并一次并回写版本。
 */
const directories: string[] = []

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'plat72-preset-version-'))
  directories.push(directory)
  return join(directory, 'model-providers.sqlite')
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function readMetaValue(databasePath: string, key: string): unknown {
  const connection = new DatabaseSync(databasePath)
  try {
    const row = connection
      .prepare('select value_json from model_provider_meta where key = ?')
      .get(key) as { value_json?: string } | undefined
    return row?.value_json === undefined ? undefined : JSON.parse(row.value_json)
  } finally {
    connection.close()
  }
}

function exec(databasePath: string, sql: string, ...parameters: Array<string | number>): void {
  const connection = new DatabaseSync(databasePath)
  try {
    connection.prepare(sql).run(...parameters)
  } finally {
    connection.close()
  }
}

function snapshot(databasePath: string): string {
  const connection = new DatabaseSync(databasePath)
  try {
    const providers = connection
      .prepare('select id, enabled, base_url, endpoints_json, updated_at from model_providers order by id asc')
      .all()
    const models = connection
      .prepare('select provider_id, model_id, capabilities_json from model_models order by provider_id asc, model_id asc')
      .all()
    const meta = connection
      .prepare('select key, value_json from model_provider_meta order by key asc')
      .all()
    return JSON.stringify({ providers, models, meta })
  } finally {
    connection.close()
  }
}

describe('PLAT-78 preset version gate', () => {
  it('seeds the version and performs zero writes on the first read after seeding', async () => {
    const databasePath = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    await storage.read()
    expect(readMetaValue(databasePath, ProviderPresetVersionMetaKey)).toBe(systemPresetsVersion())

    const write = vi.spyOn(storage, 'write')
    const state = await createProviderStore(storage).getState()
    write.mockRestore()
    storage.close()

    expect(write).toHaveBeenCalledTimes(0)
    expect(state.providers.length).toBeGreaterThan(0)
  })

  it('does not write when the stored version matches, and two reads stay byte-identical', async () => {
    const databasePath = workspace()
    const first = createProviderSqliteStorage({ path: databasePath })
    await createProviderStore(first).getState()
    first.close()
    const before = snapshot(databasePath)

    const second = createProviderSqliteStorage({ path: databasePath })
    const write = vi.spyOn(second, 'write')
    await createProviderStore(second).getState()
    second.close()

    expect(write).toHaveBeenCalledTimes(0)
    expect(snapshot(databasePath)).toBe(before)
  })

  it('merges once and records the version for a legacy database without the key', async () => {
    const databasePath = workspace()
    const seeded = createProviderSqliteStorage({ path: databasePath })
    await seeded.read()
    seeded.close()
    exec(databasePath, 'delete from model_provider_meta where key = ?', ProviderPresetVersionMetaKey)
    expect(readMetaValue(databasePath, ProviderPresetVersionMetaKey)).toBeUndefined()

    const storage = createProviderSqliteStorage({ path: databasePath })
    const write = vi.spyOn(storage, 'write')
    await createProviderStore(storage).getState()
    storage.close()

    expect(write).toHaveBeenCalledTimes(1)
    expect(readMetaValue(databasePath, ProviderPresetVersionMetaKey)).toBe(systemPresetsVersion())
  })

  it('merges once on a version change without overwriting user values, then records the new version', async () => {
    const databasePath = workspace()
    const seeded = createProviderSqliteStorage({ path: databasePath })
    await seeded.read()
    seeded.close()
    exec(databasePath, 'update model_provider_meta set value_json = ? where key = ?', '"presets-stale"', ProviderPresetVersionMetaKey)
    // 用户库里的端点（+ 主地址镜像）被用户改过 ⇒ 合并预设不得覆盖。
    exec(
      databasePath,
      'update model_providers set enabled = 1, base_url = ?, endpoints_json = ? where id = ?',
      'https://user-proxy.example.test',
      JSON.stringify([{ protocol: 'chat-completions', baseUrl: 'https://user-proxy.example.test' }]),
      'deepseek'
    )

    const storage = createProviderSqliteStorage({ path: databasePath })
    const write = vi.spyOn(storage, 'write')
    const state = await createProviderStore(storage).getState()
    storage.close()

    expect(write).toHaveBeenCalledTimes(1)
    expect(readMetaValue(databasePath, ProviderPresetVersionMetaKey)).toBe(systemPresetsVersion())
    const deepseek = state.providers.find((provider) => provider.id === 'deepseek')!
    expect(deepseek.enabled).toBe(true)
    expect(deepseek.baseUrl).toBe('https://user-proxy.example.test')
    // 合并确实跑过：预设模型还在（没有被清空），但用户改动保留。
    expect(deepseek.models.length).toBeGreaterThan(0)
  })

  it('skips preset merging entirely when asked to (normalizeProviderState contract)', () => {
    const withoutMerge = normalizeProviderState({ providers: [] }, { mergePresets: false })
    const withMerge = normalizeProviderState({ providers: [] })

    expect(withoutMerge.providers).toEqual([])
    expect(withMerge.providers.length).toBeGreaterThan(0)
  })
})
