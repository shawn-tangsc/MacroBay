import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { PersistedProviderState } from '../modelProviderTypes'
import { ProviderPresetVersionMetaKey, type ProviderStorage } from '../providerStore'
import { createSystemProviderPresets } from '../providerPresets'
import { systemPresetsVersion } from '../providerPresetMerge'
import {
  countProviderRows,
  providerMetaKeys,
  readPersistedProviderState,
  readProviderMeta,
  writePersistedProviderState,
  writeProviderMeta
} from './providerSqliteMapper'
import { applyProviderSqliteMigrations } from './providerSqliteSchema'

/**
 * PLAT-72：模型供应商的 SQLite 存储（替换原先整份 `model-providers.json` 读写）。
 *
 * 契约与旧的 JSON 存储完全一致（`ProviderStorage` 的 `read` / `write`），因此
 * `providerStore` 的 mutation 队列、密钥 vault、IPC 全都不用改：写入口仍然只有
 * `providerStore.writeMetadata()` 一处，这里再做**单事务**落库。
 *
 * 首次启动（表为空且没有 seed 标记）用当前预设灌一次种子：全部 `enabled=false`、无 Key、
 * 无自定义端点/请求头、模型=预设清单。`seed` 标记保证只灌一次 —— 用户删掉供应商后
 * 重启不会被"复活"。
 *
 * **旧的 `model-providers.json` 已废弃**：本模块不读它、不改它、不删它（见 `app.ts` 注释）。
 */
export type ProviderSqliteStorage = ProviderStorage & {
  readonly path: string
  close: () => void
}

export type CreateProviderSqliteStorageOptions = {
  path: string
  now?: () => Date
}

export function createProviderSqliteStorage(options: CreateProviderSqliteStorageOptions): ProviderSqliteStorage {
  const now = options.now ?? (() => new Date())
  let connection: DatabaseSync | null = null

  function ensureOpen(): DatabaseSync {
    if (connection) return connection
    if (options.path !== ':memory:') mkdirSync(dirname(options.path), { recursive: true })
    const opened = new DatabaseSync(options.path)
    opened.exec('pragma foreign_keys = on;')
    opened.exec('pragma busy_timeout = 5000;')
    applyProviderSqliteMigrations(opened)
    seedPresetsOnce(opened, now().toISOString())
    connection = opened
    return opened
  }

  return {
    path: options.path,
    async read() {
      return readPersistedProviderState(ensureOpen())
    },
    async write(state: PersistedProviderState, options?: { meta?: Readonly<Record<string, unknown>> }) {
      const opened = ensureOpen()
      const updatedAt = now().toISOString()
      transact(opened, () => {
        writePersistedProviderState(opened, state, updatedAt)
        // PLAT-78：元数据与状态同事务落库，避免"状态写了、版本没写"导致下次启动再合并一次。
        for (const [key, value] of Object.entries(options?.meta ?? {})) {
          writeProviderMeta(opened, key, value, updatedAt)
        }
      })
    },
    async readMeta(key: string) {
      return readProviderMeta(ensureOpen(), key)
    },
    close() {
      connection?.close()
      connection = null
    }
  }
}

/** 只在"没有 seed 标记且表为空"时灌预设；任何情况下都会补上 seed 标记，保证只灌一次。 */
function seedPresetsOnce(connection: DatabaseSync, updatedAt: string): void {
  if (readProviderMeta(connection, providerMetaKeys.seeded) !== undefined) return
  transact(connection, () => {
    if (countProviderRows(connection) === 0) {
      writePersistedProviderState(connection, { providers: createSystemProviderPresets() }, updatedAt)
      // seed 写的就是**当前**预设 ⇒ 同时记录版本，首启后的第一次 read 不会再多合并一次。
      writeProviderMeta(connection, ProviderPresetVersionMetaKey, systemPresetsVersion(), updatedAt)
    }
    writeProviderMeta(connection, providerMetaKeys.seeded, { seededAt: updatedAt }, updatedAt)
  })
}

function transact<T>(connection: DatabaseSync, operation: () => T): T {
  connection.exec('begin')
  try {
    const result = operation()
    connection.exec('commit')
    return result
  } catch (error) {
    connection.exec('rollback')
    throw error
  }
}
