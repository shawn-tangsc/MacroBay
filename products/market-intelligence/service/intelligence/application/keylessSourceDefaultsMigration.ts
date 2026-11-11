import { readFile } from 'node:fs/promises'

import { writeJsonFileAtomically } from '@platform/storage/jsonFileStorage'

import { sourceRequiresCredential } from '../schema/intelligenceSource'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import { getSource } from './providerRegistry'
import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'

/**
 * 两次一次性迁移，一开一关，判据是同一条：**免钥匙 + 已就绪（live）**的源里，
 * 有读者可见产出的默认开、没有的（`maintenanceOnly`）默认关。
 *
 * 读者 2026-11-12 分两句话定的口径：先说「除了要 API Key 的、还没接的，其余默认开」，
 * 看到「系统与状态」那一组（Coinbase / Kraken / Solana / GitHub）、以太坊基金会、CFTC 之后补了
 * 「这几个还没用上的，默认不启动」。判据不另造清单：注册表已有的 `maintenanceOnly` 就是
 * 「今天没有任何读者可见产出」的正式声明；只供 AI 分析用的源（`binance-spot-market`、
 * `coingecko-market`、`defillama-tvl`）有 `purposes`，仍然默认开。
 *
 * 两个标记各管各的，**写标记是合并而不是覆盖**：后一条迁移不能把前一条的痕迹抹掉，
 * 否则下次启动会把读者手动关掉的源再打开一遍。
 */
export const KEYLESS_SOURCES_ENABLED_MARKER = 'keyless-sources-enabled-all-2026-11-12'

/** 反向那一趟：把「维护备用」的免钥匙源关回去（前一条把它们一起打开了）。 */
export const KEYLESS_MAINTENANCE_SOURCES_DISABLED_MARKER = 'keyless-maintenance-sources-disabled-2026-11-12'

export type KeylessDefaultsStore = Readonly<{
  listProfiles: () => Promise<readonly IntelligenceSourceProfile[]>
  saveProfile: (input: { sourceId: string; enabled: boolean }) => Promise<unknown>
}>

export type KeylessDefaultsMigrationResult = Readonly<{
  /** 这次被打开的源（第二次跑就是空数组）。 */
  opened: readonly string[]
}>

export type MaintenanceDefaultsMigrationResult = Readonly<{ closed: readonly string[] }>

type MarkerDocument = { markers?: Record<string, unknown> }

async function readMarkers(markerPath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(markerPath, 'utf8')) as MarkerDocument
    const markers = parsed.markers
    return typeof markers === 'object' && markers !== null ? { ...markers } : {}
  } catch {
    // 没读写过、或读到坏文件：当作没跑过；跑完会原子写一次标记。
    return {}
  }
}

async function writeMarker(markerPath: string, key: string, at: string): Promise<void> {
  const markers = await readMarkers(markerPath)
  markers[key] = { at }
  await writeJsonFileAtomically(markerPath, { markers })
}

/** 这个源今天有没有读者可见产出：catalog 不带这个字段，按 id 回注册表查。 */
function isMaintenanceOnly(sourceId: string): boolean {
  return getSource(sourceId)?.maintenanceOnly === true
}

export async function migrateKeylessSourceDefaults(input: Readonly<{
  store: KeylessDefaultsStore
  /** 迁移标记文档：`{ markers: { [KEYLESS_SOURCES_ENABLED_MARKER]: { at } } }`。 */
  markerPath: string
  now?: () => string
}>): Promise<KeylessDefaultsMigrationResult> {
  if (Object.hasOwn(await readMarkers(input.markerPath), KEYLESS_SOURCES_ENABLED_MARKER)) return { opened: [] }

  const now = (input.now ?? (() => new Date().toISOString()))()
  const opened: string[] = []
  for (const profile of await input.store.listProfiles()) {
    if (profile.enabled !== false) continue
    const definition = getIntelligenceSourceDefinition(profile.sourceId)
    if (definition === undefined) continue
    // 需要钥匙的源保持关（等配钥匙）；还没接入（readiness 不是 live）的也不动。
    if (sourceRequiresCredential(definition.authMode)) continue
    if ((definition.readiness ?? 'live') !== 'live') continue
    // 维护备用（还没用上）的源同样不动：读者 2026-11-12 明确要它们默认不启动。
    if (isMaintenanceOnly(profile.sourceId)) continue
    await input.store.saveProfile({ sourceId: profile.sourceId, enabled: true })
    opened.push(profile.sourceId)
  }

  // 标记**无论有没有打开过都写一次**：第二次跑不再扫、也不再写。
  await writeMarker(input.markerPath, KEYLESS_SOURCES_ENABLED_MARKER, now)
  return { opened }
}

/**
 * 反向那一趟：**维护备用**（`maintenanceOnly`）的免钥匙 live 源，若还开着就关掉。
 *
 * 上面那条迁移第一版把「免钥匙 + live」全打开了，其中「系统与状态」那组、以太坊基金会、
 * CFTC、Binance API updates、美联储新闻稿都没有任何读者可见产出——读者看到后要求默认不启动。
 * 只跑一次，标记合并写入；读者之后手动打开不会被再关掉。
 */
export async function disableMaintenanceOnlyKeylessSources(input: Readonly<{
  store: KeylessDefaultsStore
  markerPath: string
  now?: () => string
}>): Promise<MaintenanceDefaultsMigrationResult> {
  if (Object.hasOwn(await readMarkers(input.markerPath), KEYLESS_MAINTENANCE_SOURCES_DISABLED_MARKER)) return { closed: [] }

  const now = (input.now ?? (() => new Date().toISOString()))()
  const closed: string[] = []
  for (const profile of await input.store.listProfiles()) {
    if (profile.enabled !== true) continue
    const definition = getIntelligenceSourceDefinition(profile.sourceId)
    if (definition === undefined) continue
    if (sourceRequiresCredential(definition.authMode)) continue
    if ((definition.readiness ?? 'live') !== 'live') continue
    if (!isMaintenanceOnly(profile.sourceId)) continue
    await input.store.saveProfile({ sourceId: profile.sourceId, enabled: false })
    closed.push(profile.sourceId)
  }

  await writeMarker(input.markerPath, KEYLESS_MAINTENANCE_SOURCES_DISABLED_MARKER, now)
  return { closed }
}
