import { readFile } from 'node:fs/promises'

import { writeJsonFileAtomically } from '@platform/storage/jsonFileStorage'

import { sourceRequiresCredential } from '../schema/intelligenceSource'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'

/**
 * 一次性迁移：把「免钥匙 + 已就绪（live）」的源的**旧默认关**打开。
 *
 * 为什么需要迁移：新安装的默认值改成了「免钥匙即启用」，但老安装里这些源早有一条
 * `enabled: false` 的 profile（那是旧默认写下的），按「已有 profile 以存量为准」的规矩不会被
 * 默认值覆盖，于是一直显示 0。
 *
 * 用户 2026-11-12 的口径：**除了要 API Key 的、还没接进来的，其余全部默认启用**；
 * 2026-11-11 那版还要求「被看板模块用到」，把状态页、公告流、分析用那批挡在门外，
 * 所以这次的标记换了新键，让跑过旧迁移的安装也按新口径再走一遍。
 *
 * **无法区分「旧默认关」与「读者显式关」**，所以这次把我方默认关掉的一并打开；读者若真要关，
 * 迁移之后再关即可——迁移只做一次，标记写在 `markers` 里。
 *
 * 不迁移：需要 API Key 的源（等配钥匙）、`readiness` 不是 live 的源（还没接进来）、
 * 迁移之后读者手动关掉的（标记已在，不会再跑）。
 */
export const KEYLESS_SOURCES_ENABLED_MARKER = 'keyless-sources-enabled-all-2026-11-12'

export type KeylessDefaultsStore = Readonly<{
  listProfiles: () => Promise<readonly IntelligenceSourceProfile[]>
  saveProfile: (input: { sourceId: string; enabled: boolean }) => Promise<unknown>
}>

export type KeylessDefaultsMigrationResult = Readonly<{
  /** 这次被打开的源（第二次跑就是空数组）。 */
  opened: readonly string[]
}>

type MarkerDocument = { markers?: Record<string, unknown> }

async function hasMarker(markerPath: string, key: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(markerPath, 'utf8')) as MarkerDocument
    const markers = parsed.markers
    return typeof markers === 'object' && markers !== null && markerKeyPresent(markers, key)
  } catch {
    // 没读写过、或读到坏文件：当作没跑过；跑完会原子写一次标记。
    return false
  }
}

function markerKeyPresent(markers: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(markers, key)
}

export async function migrateKeylessSourceDefaults(input: Readonly<{
  store: KeylessDefaultsStore
  /** 迁移标记文档：`{ markers: { [KEYLESS_SOURCES_ENABLED_MARKER]: { at } } }`。 */
  markerPath: string
  now?: () => string
}>): Promise<KeylessDefaultsMigrationResult> {
  if (await hasMarker(input.markerPath, KEYLESS_SOURCES_ENABLED_MARKER)) return { opened: [] }

  const now = (input.now ?? (() => new Date().toISOString()))()
  const opened: string[] = []
  for (const profile of await input.store.listProfiles()) {
    if (profile.enabled !== false) continue
    const definition = getIntelligenceSourceDefinition(profile.sourceId)
    if (definition === undefined) continue
    // 需要钥匙的源保持关（等配钥匙）；还没接入（readiness 不是 live）的也不动。
    if (sourceRequiresCredential(definition.authMode)) continue
    if ((definition.readiness ?? 'live') !== 'live') continue
    await input.store.saveProfile({ sourceId: profile.sourceId, enabled: true })
    opened.push(profile.sourceId)
  }

  // 标记**无论有没有打开过都写一次**：第二次跑不再扫、也不再写。
  await writeJsonFileAtomically(input.markerPath, {
    markers: { [KEYLESS_SOURCES_ENABLED_MARKER]: { at: now } }
  })
  return { opened }
}
