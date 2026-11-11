import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getIntelligenceSourceDefinition } from './sourceCatalog'
import { createDefaultSourceProfile } from './sourceRuntimeConfig'
import {
  createInMemoryProfileStorage,
  createProfileJsonStorage,
  createSourceProfileStore
} from './sourceProfileStore'

describe('sourceProfileStore', () => {
  it('returns an empty list when no profiles exist', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())
    await expect(store.listProfiles()).resolves.toEqual([])
  })

  it('normalizes enum fields on save', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())
    const saved = await store.saveProfile({
      sourceId: 'sec-rss',
      enabled: true,
      collectionPreset: 'frequent' as never,
      scopePolicy: 'all',
      retentionMode: 'extended'
    })

    expect(saved.collectionPreset).toBe('frequent')
    expect(saved.scopePolicy).toBe('all')
    expect(saved.retentionMode).toBe('extended')
  })

  it('rejects unknown source ids', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())
    await expect(store.saveProfile({ sourceId: 'unknown-source', enabled: true })).rejects.toThrow(
      'Unknown intelligence source'
    )
  })

  it('never mutates the built-in definition when saving a profile', async () => {
    const definitionBefore = getIntelligenceSourceDefinition('github-releases')
    const store = createSourceProfileStore(createInMemoryProfileStorage())

    await store.saveProfile({
      sourceId: 'github-releases',
      collectionPreset: 'frequent',
      credentialRef: 'cred://github/token'
    })

    const definitionAfter = getIntelligenceSourceDefinition('github-releases')
    expect(definitionAfter).toEqual(definitionBefore)
    expect(definitionAfter?.supportsSentiment).toBe(false)
  })

  it('stores credential references instead of raw secrets', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())
    const saved = await store.saveProfile({
      sourceId: 'fred',
      credentialRef: 'cred://fred/api-key'
    })

    expect(saved.credentialRef).toBe('cred://fred/api-key')
    expect(saved.credentialRef?.startsWith('cred://')).toBe(true)
  })

  it('resolveProfile returns defaults for missing profiles', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())
    const resolved = await store.resolveProfile('coindesk-rss')
    const defaults = createDefaultSourceProfile(getIntelligenceSourceDefinition('coindesk-rss')!)

    expect(resolved.sourceId).toBe(defaults.sourceId)
    expect(resolved.collectionPreset).toBe(defaults.collectionPreset)
  })

  it('rejects enabling planned sources', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())
    await expect(store.saveProfile({ sourceId: 'bea-economic-series', enabled: true })).rejects.toThrow(
      'not ready for production collection'
    )
  })

  it('rejects enabling fixture-ready sources', async () => {
    const store = createSourceProfileStore(createInMemoryProfileStorage())
    await expect(store.saveProfile({ sourceId: 'bls-economic-series', enabled: true })).rejects.toThrow(
      'not ready for production collection'
    )
  })

  it('persists profiles to json storage across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intelligence-profiles-'))
    const filePath = join(dir, 'intelligence-source-profiles.json')

    try {
      const store = createSourceProfileStore(createProfileJsonStorage(filePath))
      await store.saveProfile({
        sourceId: 'sec-rss',
        enabled: true,
        collectionPreset: 'frequent',
        retentionMode: 'extended',
        credentialRef: 'cred://sec/token'
      })

      const reloaded = createSourceProfileStore(createProfileJsonStorage(filePath))
      const profiles = await reloaded.listProfiles()

      expect(profiles).toHaveLength(1)
      expect(profiles[0]?.sourceId).toBe('sec-rss')
      expect(profiles[0]?.enabled).toBe(true)
      expect(profiles[0]?.collectionPreset).toBe('frequent')
      expect(profiles[0]?.credentialRef).toBe('cred://sec/token')

      const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown[]
      expect(raw).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads a legacy row that still carries the deleted includeInSentiment field, and never resurrects it', async () => {
    // 字段已删（用户 2026-11-12：`includeInSentiment` 从出生起就是死开关）。旧 profile JSON 里可能
    // 还存着它：读取侧**容忍未知字段**（忽略、不报错），写回时**不许把它复活**；不做迁移、不写迁移标记。
    const dir = await mkdtemp(join(tmpdir(), 'intelligence-profiles-'))
    const filePath = join(dir, 'intelligence-source-profiles.json')
    const legacy = {
      profileId: 'sec-rss-profile', sourceId: 'sec-rss', enabled: true, collectionPreset: 'balanced',
      includeInSentiment: true, scopePolicy: 'all', rawArchiveEnabled: true, retentionMode: 'balanced',
      autoReplayAfterParserUpgrade: true, updatedAt: '2026-01-01T00:00:00.000Z'
    }

    try {
      await writeFile(filePath, `${JSON.stringify([legacy], null, 2)}\n`, 'utf8')
      const store = createSourceProfileStore(createProfileJsonStorage(filePath))

      const read = await store.listProfiles()
      expect(read).toHaveLength(1)
      expect(read[0]?.sourceId).toBe('sec-rss')
      expect(read[0] && Object.hasOwn(read[0], 'includeInSentiment')).toBe(false)

      const saved = await store.saveProfile({ sourceId: 'sec-rss', collectionPreset: 'frequent' })
      expect(saved.collectionPreset).toBe('frequent')
      expect(Object.hasOwn(saved, 'includeInSentiment')).toBe(false)

      const raw = JSON.parse(await readFile(filePath, 'utf8')) as Array<Record<string, unknown>>
      expect(Object.hasOwn(raw[0]!, 'includeInSentiment')).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('recovers profiles when a crashed write left a fragment after the array', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intelligence-profiles-'))
    const filePath = join(dir, 'intelligence-source-profiles.json')
    const profile = createDefaultSourceProfile(getIntelligenceSourceDefinition('sec-rss')!)

    try {
      // 真实事故的形态：数组后面粘着上一版内容的尾巴，JSON.parse 在位置 2917 失败。
      await writeFile(filePath, `${JSON.stringify([profile], null, 2)}\n\n  }\n]\n`, 'utf8')

      const store = createSourceProfileStore(createProfileJsonStorage(filePath))
      const profiles = await store.listProfiles()

      expect(profiles.map((item) => item.sourceId)).toEqual(['sec-rss'])
      const rewritten = JSON.parse(await readFile(filePath, 'utf8')) as unknown
      expect(Array.isArray(rewritten)).toBe(true)
      const copies = (await readdir(dir)).filter((name) => name.startsWith('intelligence-source-profiles.json.corrupt-'))
      expect(copies).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
