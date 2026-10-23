import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { createProviderStore } from '../providerStore'
import { createSystemProviderPresets } from '../providerPresets'
import { createProviderSqliteStorage } from './providerSqliteStorage'

/**
 * PLAT-72：「清空模型」必须真的**落到磁盘**（不是只改内存）。
 * 这里走真实 SQLite，覆盖"清空后关掉再打开"这条用户视角的路径。
 */
const directories: string[] = []

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'plat72-clear-models-'))
  directories.push(directory)
  return join(directory, 'model-providers.sqlite')
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function modelRows(databasePath: string, providerId: string): number {
  const connection = new DatabaseSync(databasePath)
  try {
    const row = connection
      .prepare('select count(*) as total from model_models where provider_id = ?')
      .get(providerId) as { total?: number } | undefined
    return row?.total ?? 0
  } finally {
    connection.close()
  }
}

describe('PLAT-72 clear all models persistence', () => {
  it('persists the clear, keeps other providers, and does not resurrect on restart', async () => {
    const databasePath = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    const store = createProviderStore(storage)
    const before = await store.getState()
    const siliconIds = before.providers.find((item) => item.id === 'silicon')!.models.map((model) => model.id)
    const deepseekModels = before.providers.find((item) => item.id === 'deepseek')!.models.length

    await store.applyModelSync('silicon', { toAdd: [], toUpdate: [], toRemove: siliconIds })
    expect(modelRows(databasePath, 'silicon')).toBe(0)
    storage.close()

    const restarted = createProviderSqliteStorage({ path: databasePath })
    const after = await createProviderStore(restarted).getState()
    restarted.close()

    const silicon = after.providers.find((item) => item.id === 'silicon')!
    expect(silicon.models).toEqual([])
    expect(silicon.defaultChatModelId).toBeUndefined()
    expect([...(silicon.removedPresetModelIds ?? [])].sort()).toEqual([...siliconIds].sort())
    expect(after.providers.find((item) => item.id === 'deepseek')!.models).toHaveLength(deepseekModels)
  })

  it('lets an explicit sync after the clear persist the models again', async () => {
    const databasePath = workspace()
    const storage = createProviderSqliteStorage({ path: databasePath })
    const store = createProviderStore(storage)
    const before = await store.getState()
    const presetModels = createSystemProviderPresets().find((preset) => preset.id === 'silicon')!.models
    const siliconIds = before.providers.find((item) => item.id === 'silicon')!.models.map((model) => model.id)

    await store.applyModelSync('silicon', { toAdd: [], toUpdate: [], toRemove: siliconIds })
    await store.applyModelSync('silicon', { toAdd: [...presetModels], toUpdate: [], toRemove: [] })
    storage.close()

    const restarted = createProviderSqliteStorage({ path: databasePath })
    const after = await createProviderStore(restarted).getState()
    restarted.close()

    const silicon = after.providers.find((item) => item.id === 'silicon')!
    expect(silicon.models.map((model) => model.id).sort()).toEqual(presetModels.map((model) => model.id).sort())
    expect(silicon.removedPresetModelIds ?? []).toEqual([])
    expect(modelRows(databasePath, 'silicon')).toBe(presetModels.length)
  })
})
