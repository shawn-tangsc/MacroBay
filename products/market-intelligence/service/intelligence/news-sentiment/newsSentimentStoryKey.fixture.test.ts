import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { NewsSentimentEntity } from '../schema/newsSentiment'
import { storyKeyOf } from './newsSentimentStoryKey'

/**
 * 真实产出的夹具。
 *
 * **为什么现在跳过**：夹具只能是「一轮真实评分」的拷贝（模型用读者的配置跑），人工编一份就等于
 * 把「模型抽取质量」这件事藏起来——那和今晚抓的假绿是同一类。产出方式：
 *
 *   node scripts/export-news-story-fixture.mts --db <news-sentiment.sqlite> \
 *     --state <intelligence-pipeline-state.json> --item <id>… > \
 *     products/market-intelligence/service/intelligence/news-sentiment/__fixtures__/storyKeyFixture.json
 *
 * 拿到文件后填上 `groups`（观察到的分组就是判断，不是数据），这里的 `skipIf` 会自动变成真断言。
 * 抽得不好就报「质量不够」，**不许改 entities 让它变绿**。
 */
const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'storyKeyFixture.json')
const hasFixture = existsSync(fixturePath)
/** 每条被跳过的用例都带这句话：报告里不能把「跳过」读成「通过」。 */
const WAITING = '（等真实运行：需用户启动应用跑一轮评分，再由 export-news-story-fixture.mts 导出）'

type FixtureEntry = {
  itemId: string
  publishedAt: string
  entities: NewsSentimentEntity[]
  storyKey?: string
}

type Fixture = {
  capturedAt: string
  promptVersions: string[]
  modelRefs: string[]
  entries: FixtureEntry[]
  /** 观察到的分组：同一组 = 同一件事。由人写入，成员来自那次运行的输出。 */
  groups?: Array<{ label: string; itemIds: string[] }>
}

const fixture: Fixture | undefined = hasFixture ? (JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture) : undefined

function keyFor(itemId: string): string | undefined {
  const data = fixture!
  const entry = data.entries.find((candidate) => candidate.itemId === itemId)
  if (!entry) return undefined
  return storyKeyOf({
    itemId: entry.itemId,
    publishedAt: entry.publishedAt,
    entities: entry.entities,
    peers: data.entries
  })
}

describe('storyKey on a real scoring run', () => {
  it.skipIf(!hasFixture)(`grouped one key per event ${WAITING}`, () => {
    const data = fixture!
    expect(data.entries.length).toBeGreaterThan(0)
    for (const group of data.groups ?? []) {
      const keys = group.itemIds.map(keyFor)
      expect(keys.every(Boolean), `group "${group.label}" has an item with no key`).toBe(true)
      expect(new Set(keys).size, `group "${group.label}" should be one story`).toBe(1)
    }
  })

  it.skipIf(!hasFixture)(`keeps unrelated same-day events apart ${WAITING}`, () => {
    const data = fixture!
    const groupKeys = (data.groups ?? []).map((group) => keyFor(group.itemIds[0]!))
    expect(new Set(groupKeys).size, 'different events must not share a key').toBe(groupKeys.length)
    expect(groupKeys.every(Boolean)).toBe(true)
  })

  it.skipIf(!hasFixture)(`keeps its provenance ${WAITING}`, () => {
    const data = fixture!
    expect(Date.parse(data.capturedAt)).not.toBeNaN()
    expect(data.promptVersions.length).toBeGreaterThan(0)
  })
})
