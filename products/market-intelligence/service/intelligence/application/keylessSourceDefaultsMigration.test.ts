import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'
import { createSourceProfileStore, createInMemoryProfileStorage } from './sourceProfileStore'
import {
  KEYLESS_SOURCES_ENABLED_MARKER,
  UNUSED_KEYLESS_SOURCES_DISABLED_MARKER,
  disableUnusedKeylessSources,
  migrateKeylessSourceDefaults
} from './keylessSourceDefaultsMigration'

/**
 * 「免钥匙 + live」的老 profile 改成开，只做一次。
 *
 * 判据：迁移前关着的免钥匙 live 源 → 开；需要钥匙的、未接入（非 live）的不动；
 * 第二次跑零写入；标记在文档里。
 */
const dirs: string[] = []

function tempMarker(): string {
  const dir = mkdtempSync(join(tmpdir(), 'keyless-defaults-'))
  dirs.push(dir)
  return join(dir, 'intelligence-source-migration-markers.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function profile(sourceId: string, enabled: boolean): IntelligenceSourceProfile {
  return {
    profileId: `${sourceId}-profile`, sourceId, enabled, collectionPreset: 'balanced',
    includeInSentiment: false, scopePolicy: 'all', rawArchiveEnabled: true, retentionMode: 'balanced',
    autoReplayAfterParserUpgrade: true, updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

async function setup(initial: IntelligenceSourceProfile[], markerPath: string) {
  const store = createSourceProfileStore(createInMemoryProfileStorage(initial))
  return { store, markerPath }
}

describe('keyless source defaults migration', () => {
  it('opens keyless live sources that old defaults left off, and leaves the others alone', async () => {
    const markerPath = tempMarker()
    const { store } = await setup([
      profile('federal-reserve-rss', false),      // 免钥匙 + live → 打开
      profile('coindesk-rss', false),             // 免钥匙 + live → 打开
      profile('twelve-data-market', false),       // 需要钥匙 → 不动
      profile('bea-economic-series', false)       // planned → 不动
    ], markerPath)

    const result = await migrateKeylessSourceDefaults({ store, markerPath })
    expect([...result.opened].sort()).toEqual(['coindesk-rss', 'federal-reserve-rss'])
    expect((await store.getProfile('coindesk-rss'))?.enabled).toBe(true)
    expect((await store.getProfile('twelve-data-market'))?.enabled).toBe(false)
    expect((await store.getProfile('bea-economic-series'))?.enabled).toBe(false)
  })

  it('writes the marker once and makes the second run a no-op', async () => {
    const markerPath = tempMarker()
    const { store } = await setup([profile('coindesk-rss', false)], markerPath)
    await migrateKeylessSourceDefaults({ store, markerPath })

    const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { markers: Record<string, unknown> }
    expect(marker.markers[KEYLESS_SOURCES_ENABLED_MARKER]).toBeDefined()

    // 读者迁移后手动关掉：第二次跑不许把他重新打开。
    await store.saveProfile({ sourceId: 'coindesk-rss', enabled: false })
    const saves: string[] = []
    const spiedStore = {
      listProfiles: () => store.listProfiles(),
      saveProfile: async (input: { sourceId: string; enabled: boolean }) => { saves.push(input.sourceId); return undefined }
    }
    const second = await migrateKeylessSourceDefaults({ store: spiedStore, markerPath })
    expect(second.opened).toEqual([])
    expect(saves).toEqual([])
  })

  it('closes keyless sources no dashboard module uses, and leaves the used ones alone', async () => {
    const markerPath = tempMarker()
    const { store } = await setup([
      profile('defillama-tvl', true),            // 0 模块 → 关
      profile('ethereum-foundation-blog', true), // 0 模块 → 关
      profile('coindesk-rss', true),             // news 模块在用 → 不动
      profile('twelve-data-market', true)        // 需要钥匙 → 不动（偏好照存）
    ], markerPath)

    const result = await disableUnusedKeylessSources({ store, markerPath })
    expect([...result.closed].sort()).toEqual(['defillama-tvl', 'ethereum-foundation-blog'])
    expect((await store.getProfile('defillama-tvl'))?.enabled).toBe(false)
    expect((await store.getProfile('coindesk-rss'))?.enabled).toBe(true)
    expect((await store.getProfile('twelve-data-market'))?.enabled).toBe(true)
  })

  it('keeps both markers and makes the unused-sources pass a no-op the second time', async () => {
    const markerPath = tempMarker()
    const { store } = await setup([profile('defillama-tvl', true)], markerPath)
    await migrateKeylessSourceDefaults({ store, markerPath })
    await disableUnusedKeylessSources({ store, markerPath })

    const markers = JSON.parse(readFileSync(markerPath, 'utf8')) as { markers: Record<string, unknown> }
    expect(markers.markers[KEYLESS_SOURCES_ENABLED_MARKER]).toBeDefined()
    expect(markers.markers[UNUSED_KEYLESS_SOURCES_DISABLED_MARKER]).toBeDefined()

    // 读者之后手动打开：第二次跑不许再关。
    await store.saveProfile({ sourceId: 'defillama-tvl', enabled: true })
    const saves: string[] = []
    const second = await disableUnusedKeylessSources({
      store: { listProfiles: () => store.listProfiles(), saveProfile: async (input) => { saves.push(input.sourceId) } },
      markerPath
    })
    expect(second.closed).toEqual([])
    expect(saves).toEqual([])
  })
})
