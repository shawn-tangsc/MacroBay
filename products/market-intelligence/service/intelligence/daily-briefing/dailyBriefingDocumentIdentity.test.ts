import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 期次身份只有一处来源（用户 2026-11-14）：`dailyBriefingStore` 读出来时以**表列**为准，
 * 文档里那份 `edition.periodId` 只是展示信息。
 *
 * 这条守卫拦的是「旁路」：任何第二处直接解析 `document_json` 并拿里面的期次号当身份，
 * 就会把今晚那种「列表说这一期、详情按另一期查」重新引回来。静态查比行为用例更早失效——
 * 它在有人新写一个读库的地方时就能红。
 */
const ROOT = join(process.cwd(), 'products/market-intelligence')
const ALLOWED = new Set([
  'service/intelligence/daily-briefing/dailyBriefingStore.ts',
  // 读那一半从 store 里分出去了（文件超行数），仍然是同一条读取路径，不是第二个读点。
  'service/intelligence/daily-briefing/dailyBriefingStoreRow.ts',
  'service/intelligence/daily-briefing/dailyBriefingStorageMigration.ts'
])

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { yield* walk(full); continue }
    if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) yield full
  }
}

describe('the document is parsed in exactly one place', () => {
  it('has no second reader of document_json outside the store and its migration', () => {
    const offenders = [...walk(ROOT)]
      .filter((file) => readFileSync(file, 'utf8').includes('document_json'))
      .map((file) => file.slice(ROOT.length + 1))
      .filter((relative) => !ALLOWED.has(relative))
    expect(offenders).toEqual([])
  })
})
