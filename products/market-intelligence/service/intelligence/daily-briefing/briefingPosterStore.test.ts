import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

import { createBriefingPosterFiles, posterFileName } from './briefingPosterFiles'
import { createBriefingPosterSource } from './briefingPosterSource'
import { createBriefingPosterStore } from './briefingPosterStore'
import { createDailyBriefingSqliteStore } from './dailyBriefingStore'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'

/** 一张真的 1×1 PNG：格式判据、尺寸解析、字节哈希都按真文件走，不造「看起来像」的字节。 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
/** 同一格式、不同字节：用来造「两张图」而不必伪造 PNG。 */
const PNG_ALT = Buffer.concat([PNG_1X1, Buffer.from([0, 0, 0, 0])])
const PNG_THIRD = Buffer.concat([PNG_1X1, Buffer.from([1, 2, 3, 4])])

const created: string[] = []
afterEach(() => {
  while (created.length > 0) {
    const directory = created.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'mi-briefing-posters-'))
  created.push(directory)
  return directory
}

function harness(input?: { onRemove?: (contentHash: string) => void }) {
  const directory = tempDirectory()
  const files = createBriefingPosterFiles({ directory })
  const db = openSqliteDatabase(':memory:')
  const store = createBriefingPosterStore({
    db,
    files: {
      remove: async (contentHash) => {
        input?.onRemove?.(contentHash)
        await files.remove(contentHash)
      }
    },
    now: () => '2026-11-22T00:00:00.000Z'
  })
  return { directory, files, store }
}

/** 写一张海报并记 ready 行；返回内容 hash。 */
async function readyPoster(
  harnessed: ReturnType<typeof harness>,
  input: { date: string; periodId?: string; locale?: 'zh-CN' | 'en-US'; generatedAt: string; bytes?: Buffer }
): Promise<string> {
  const written = await harnessed.files.write(new Uint8Array(input.bytes ?? PNG_1X1))
  if (!written.ok) throw new Error(written.reasonCode)
  harnessed.store.record({
    date: input.date,
    periodId: input.periodId ?? 'p1',
    locale: input.locale ?? 'zh-CN',
    editionGeneratedAt: input.generatedAt,
    status: 'ready',
    contentHash: written.file.contentHash,
    byteLength: written.file.byteLength
  })
  return written.file.contentHash
}

describe('briefing poster files and rows', () => {
  it('names the file after its content and reads it back by that hash', async () => {
    const harnessed = harness()
    const hash = await readyPoster(harnessed, { date: '2026-11-20', generatedAt: '2026-11-20T00:30:00.000Z' })

    expect(existsSync(join(harnessed.directory, posterFileName(hash)))).toBe(true)
    expect(harnessed.store.byContentHash(hash)).toMatchObject({ status: 'ready', contentHash: hash })

    const read = await harnessed.files.read(hash)
    expect(read?.mime).toBe('image/png')
    expect(read?.bytes.byteLength).toBe(PNG_1X1.byteLength)
  })

  it('keeps one row per edition version and never overwrites the previous one', async () => {
    const harnessed = harness()
    const first = await readyPoster(harnessed, { date: '2026-11-20', generatedAt: '2026-11-20T00:30:00.000Z' })
    // 夹具纪律：两次写入必须用两个不同的 `now`，否则撞同一把键，这条用例会绿着骗人。
    const second = await readyPoster(harnessed, {
      date: '2026-11-20',
      generatedAt: '2026-11-20T03:30:00.000Z',
      bytes: PNG_ALT
    })

    expect(first).not.toBe(second)
    expect(harnessed.store.byEdition({
      date: '2026-11-20', periodId: 'p1', locale: 'zh-CN', editionGeneratedAt: '2026-11-20T00:30:00.000Z'
    })).toMatchObject({ status: 'ready', contentHash: first })
    // 旧版与旧文件都还在：旧通知记录还要用它。
    expect(harnessed.store.byContentHash(first)?.status).toBe('ready')
    expect(existsSync(join(harnessed.directory, posterFileName(first)))).toBe(true)
  })

  it('separates "never rendered" from "rendered and failed"', async () => {
    const harnessed = harness()
    harnessed.store.record({
      date: '2026-11-20', periodId: 'p1', locale: 'zh-CN',
      editionGeneratedAt: '2026-11-20T00:30:00.000Z', status: 'timeout', failureCode: 'poster-render-timeout'
    })

    expect(harnessed.store.byEdition({
      date: '2026-11-20', periodId: 'p1', locale: 'zh-CN', editionGeneratedAt: '2026-11-20T00:30:00.000Z'
    })).toMatchObject({ status: 'timeout', failureCode: 'poster-render-timeout', contentHash: null })
    expect(harnessed.store.byEdition({
      date: '2026-11-21', periodId: 'p1', locale: 'zh-CN', editionGeneratedAt: '2026-11-21T00:30:00.000Z'
    })).toBeNull()
  })
})

describe('briefing poster source', () => {
  it('answers "not released" for a hash with no row, before touching the disk', async () => {
    const harnessed = harness()
    const source = createBriefingPosterSource({ store: harnessed.store, files: harnessed.files })

    await expect(source.read('0000000000000000')).resolves.toMatchObject({
      ok: false, code: 'delivery-image-source-not-allowed', detail: 'poster-not-found'
    })
  })

  it('separates a missing file from an unreadable one', async () => {
    const harnessed = harness()
    const hash = await readyPoster(harnessed, { date: '2026-11-20', generatedAt: '2026-11-20T00:30:00.000Z' })
    const source = createBriefingPosterSource({ store: harnessed.store, files: harnessed.files })

    await harnessed.files.remove(hash)
    await expect(source.read(hash)).resolves.toMatchObject({
      ok: false, code: 'delivery-image-unavailable', detail: 'missing'
    })

    const failing = createBriefingPosterSource({
      store: harnessed.store,
      files: { read: async () => { throw new Error('disk') } }
    })
    await expect(failing.read(hash)).resolves.toMatchObject({
      ok: false, code: 'delivery-image-unavailable', detail: 'read-failed'
    })
  })

  it('refuses a row that only holds a failure', async () => {
    const harnessed = harness()
    harnessed.store.record({
      date: '2026-11-20', periodId: 'p1', locale: 'zh-CN',
      editionGeneratedAt: '2026-11-20T00:30:00.000Z', status: 'failed', failureCode: 'poster-render-failed'
    })
    const source = createBriefingPosterSource({ store: harnessed.store, files: harnessed.files })
    await expect(source.read('0000000000000000')).resolves.toMatchObject({ detail: 'poster-not-found' })
  })
})

describe('briefing poster cleanup', () => {
  it('prunes by date and removes the files with the rows', async () => {
    const harnessed = harness()
    const old = await readyPoster(harnessed, { date: '2026-11-01', generatedAt: '2026-11-01T00:30:00.000Z' })
    // 另一天刻意用另一份字节：内容相同时两版共用同一个文件，那条由共用文件的用例单独证。
    const recent = await readyPoster(harnessed, {
      date: '2026-11-21', generatedAt: '2026-11-21T00:30:00.000Z', bytes: PNG_ALT
    })

    await expect(harnessed.store.pruneDate('2026-11-10')).resolves.toMatchObject({ rows: 1, removedFiles: 1 })

    expect(harnessed.store.byContentHash(old)).toBeNull()
    expect(existsSync(join(harnessed.directory, posterFileName(old)))).toBe(false)
    expect(existsSync(join(harnessed.directory, posterFileName(recent)))).toBe(true)
  })

  it('keeps a file another edition still references (same bytes, two dates)', async () => {
    const removed: string[] = []
    const shared = harness({ onRemove: (hash) => removed.push(hash) })
    const first = await readyPoster(shared, { date: '2026-11-01', generatedAt: '2026-11-01T00:30:00.000Z' })
    const second = await readyPoster(shared, { date: '2026-11-21', generatedAt: '2026-11-21T00:30:00.000Z' })
    expect(first).toBe(second)

    // 删掉内容相同的一版：文件必须还在（反向红就是这里——按行直接 rm 会删掉另一版的图）。
    await shared.store.pruneDate('2026-11-10')
    expect(existsSync(join(shared.directory, posterFileName(first)))).toBe(true)
    expect(removed).toHaveLength(0)
    expect(shared.store.byContentHash(second)?.status).toBe('ready')

    await shared.store.pruneDate('2026-11-30')
    expect(existsSync(join(shared.directory, posterFileName(first)))).toBe(false)
    expect(removed).toEqual([first])
  })

  it('deletes only the named language and issue', async () => {
    const harnessed = harness()
    const zh = await readyPoster(harnessed, { date: '2026-11-20', generatedAt: '2026-11-20T00:30:00.000Z' })
    const en = await readyPoster(harnessed, {
      date: '2026-11-20', generatedAt: '2026-11-20T00:30:00.000Z', locale: 'en-US', bytes: PNG_ALT
    })
    // 另一期刻意用**另一份字节**：内容相同时两版共用同一个文件，`byContentHash` 自然会命中
    // 那一行——那是共用文件那条用例要证明的事，不该混进「按语言删」这条。
    const otherPeriod = await readyPoster(harnessed, {
      date: '2026-11-20', periodId: 'p2', generatedAt: '2026-11-20T04:30:00.000Z', bytes: PNG_THIRD
    })

    await harnessed.store.deleteEdition({ date: '2026-11-20', periodId: 'p1', locale: 'zh-CN' })

    expect(harnessed.store.byContentHash(zh)).toBeNull()
    expect(existsSync(join(harnessed.directory, posterFileName(zh)))).toBe(false)
    expect(harnessed.store.byContentHash(en)?.status).toBe('ready')
    expect(harnessed.store.byContentHash(otherPeriod)?.status).toBe('ready')
  })
})

const storedDocument = (date: string): DailyBriefingDocument => ({
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date, locale: 'zh-CN', generatedAt: `${date}T00:30:00.000Z`,
    windowStart: `${date}T00:00:00.000Z`, windowEnd: `${date}T00:30:00.000Z`, timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text: '今日要点。', generatedAt: `${date}T00:30:00.000Z` },
  news: { items: [], macro: [], notes: {} },
  data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'empty' } } },
  conclusion: null,
  next: { items: [] },
  citations: [],
  provenance: { summaryId: null, readAt: `${date}T00:30:00.000Z` }
})

describe('poster rows follow the edition store cleanup', () => {
  it('removes posters when the retention prune and the per-language delete run', async () => {
    const directory = tempDirectory()
    const files = createBriefingPosterFiles({ directory })
    const dbPath = join(directory, 'daily-briefings.sqlite')
    const store = createDailyBriefingSqliteStore(dbPath, { posterFiles: files })
    // 海报表由版次仓储自己建（同一个连接）：清理只走它暴露出来的这一份。
    const posters = store.posters
    if (posters === undefined) throw new Error('poster store missing')

    const write = async (date: string, locale: 'zh-CN' | 'en-US') => {
      const bytes = locale === 'zh-CN' ? PNG_1X1 : PNG_ALT
      const written = await files.write(new Uint8Array(bytes))
      if (!written.ok) throw new Error(written.reasonCode)
      posters.record({
        date, periodId: 'p1', locale, editionGeneratedAt: `${date}T00:30:00.000Z`,
        status: 'ready', contentHash: written.file.contentHash, byteLength: written.file.byteLength
      })
      return written.file.contentHash
    }

    // 两个中文版次用同一份字节（公司同一天的两期内容可能一样）：它们共用同一个文件，
    // 所以断言必须落在「行」与「文件是否还被引用」上，不能拿 byContentHash 判 null。
    const oldHash = await write('2026-11-01', 'zh-CN')
    const keptHash = await write('2026-11-21', 'zh-CN')
    const otherLanguage = await write('2026-11-21', 'en-US')
    expect(oldHash).toBe(keptHash)
    expect(otherLanguage).not.toBe(keptHash)

    // 保留期：旧日期那一行走，文件因为还有另一版引用着，必须留着。
    await store.prune('2026-11-10')
    expect(posters.byEdition({
      date: '2026-11-01', periodId: 'p1', locale: 'zh-CN', editionGeneratedAt: '2026-11-01T00:30:00.000Z'
    })).toBeNull()
    expect(existsSync(join(directory, posterFileName(oldHash)))).toBe(true)

    // 按语言删：这一语言的行与「已经没有引用」的文件一起走。
    await store.deletePeriod!('2026-11-21', 'p1', 'zh-CN')
    expect(posters.byEdition({
      date: '2026-11-21', periodId: 'p1', locale: 'zh-CN', editionGeneratedAt: '2026-11-21T00:30:00.000Z'
    })).toBeNull()
    expect(existsSync(join(directory, posterFileName(keptHash)))).toBe(false)
    expect(posters.byContentHash(otherLanguage)?.status).toBe('ready')
  })
})