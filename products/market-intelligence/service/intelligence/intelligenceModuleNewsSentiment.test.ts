import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/intelligence-module-news-sentiment-test' },
  net: { fetch: vi.fn(async () => new Response('{}', { status: 200 })) }
}))

import { net } from 'electron'

import { createIntelligenceStores } from './intelligenceModuleStores'
import { createIntelligenceNewsSentiment } from './intelligenceModuleNewsSentiment'

/**
 * M4 抽出来的这一段自己的用例（2026-11-15 拆分 `intelligenceModule.ts`）。
 *
 * 这一段唯一会「静默出错」的行为是**库打不开时怎么办**：`catch` 里如果顺手给了个空 store 或假服务，
 * 界面会把「读不到」画成「今天没有舆情」——今晚已经栽过三次的那个坑。所以判据是两条并存的：
 * ① 库打不开时，出口里**没有** `store` / `query`（不假装有数据）；
 * ② 同时**设置读写照旧可用**（设置是 JSON，和库无关）——少了库是能力缺席，不是「没有数据」。
 */
const directories: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mi-news-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true })
  directories.length = 0
})

function assemble(dataDir: string) {
  const stores = createIntelligenceStores({
    dataDir,
    getAppLanguage: async () => 'zh-CN' as const,
    timeZone: () => 'UTC'
  })
  return createIntelligenceNewsSentiment({
    dataDir,
    pipeline: stores.pipeline,
    /* 翻译与模型调用在这一层只被惰性使用：本用例钉的是「装配与库的可用性」，不跑它们。 */
    translationService: {} as never,
    translationStorage: stores.translationStorage,
    structuredModelInvocation: { invoke: async () => ({}) } as never,
    getAppLanguage: async () => 'zh-CN' as const,
    profileStore: stores.profileStore,
    hooks: { platformFetch: net.fetch, getTimeZone: () => 'UTC' } as never
  })
}

describe('intelligenceModule 舆情段', () => {
  it('库正常时：出口带 store 与 query，重建入口先是「存储不可用」的占位（接线在作业那一笔）', () => {
    const created = assemble(tempDir())
    expect(created.newsSentimentStore).toBeTruthy()
    expect(created.newsSentimentExposure.store).toBeTruthy()
    expect(created.newsSentimentExposure.query).toBeTruthy()
    expect(typeof created.newsSentimentExposure.rebuildStorage).toBe('function')
    expect(() => created.newsSentimentExposure.rebuildStorage())
      .toThrowError('news-sentiment-storage-unavailable')
    // 四件服务由同一个 store 组装出来：重建时要把它们一起接回去（`assembleNewsSentiment` 就是那条路）。
    const pieces = created.assembleNewsSentiment(created.newsSentimentStore!)
    expect(typeof pieces.enrichment.enrichItems).toBe('function')
    expect(typeof pieces.scoring.scoreItems).toBe('function')
    expect(pieces.query).toBeTruthy()
    expect(pieces.bodyTranslation).toBeTruthy()
  })

  it('库打不开时：不抛、出口里没有 store/query，但设置仍然读写得了（读不到 ≠ 没有）', async () => {
    const dataDir = tempDir()
    // 用同名目录占住数据库文件路径：sqlite 打不开，`createNewsSentimentSqliteStore` 会抛。
    mkdirSync(join(dataDir, 'intelligence-news-sentiment.sqlite'), { recursive: true })
    const created = assemble(dataDir)

    expect(created.newsSentimentStore).toBeUndefined()
    expect(created.newsSentimentExposure.store).toBeUndefined()
    expect(created.newsSentimentExposure.query).toBeUndefined()
    expect(created.newsSentimentExposure.enrichment).toBeUndefined()
    // 「能力缺席」不等于「今天没有舆情」：不能拿一个空实现把这条信息盖住。
    expect('store' in created.newsSentimentExposure).toBe(false)

    // 设置是 JSON，与库无关：照样读得出、存得进。
    const view = await created.newsSentimentExposure.settings.get()
    expect(view.settings).toBeTruthy()
    expect(view.resolution).toBeTruthy()
    await expect(created.newsSentimentExposure.settings.save({})).resolves.toMatchObject({ resolution: expect.anything() })
  })
})
