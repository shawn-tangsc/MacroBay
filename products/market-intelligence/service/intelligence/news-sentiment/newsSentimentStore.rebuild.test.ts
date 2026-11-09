import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { openNewsSentimentDatabase } from './newsSentimentStore'
import { rebuildNewsSentimentStorage } from './newsSentimentStoreRecovery'

const directories: string[] = []

function tempStorePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'news-sentiment-rebuild-'))
  directories.push(directory)
  return join(directory, 'intelligence-news-sentiment.sqlite')
}

/** `.corrupt-*` 家族（主文件与 `-wal` / `-shm` 的副本同名加后缀）。 */
function corruptCopies(filePath: string): string[] {
  const prefix = `${basename(filePath)}.corrupt-`
  return readdirSync(dirname(filePath)).filter((name) => name.startsWith(prefix)).sort()
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('rebuildNewsSentimentStorage', () => {
  /**
   * 读者点「重新抓取」时库已经打不开：先留一份逐字节相同的现场（含 WAL），再建新库，
   * 新库立刻可读写。
   */
  it('keeps a byte-identical copy of the broken store before creating the new one', () => {
    const filePath = tempStorePath()
    const originalBytes = 'not a sqlite database'
    writeFileSync(filePath, originalBytes, 'utf8')
    writeFileSync(`${filePath}-wal`, 'uncheckpointed-wal-bytes', 'utf8')

    const rebuilt = rebuildNewsSentimentStorage(filePath)

    expect(rebuilt.quarantinedCopy).toBeDefined()
    const copies = corruptCopies(filePath)
    expect(copies).toHaveLength(2)
    const mainCopy = copies.find((name) => !name.endsWith('-wal'))
    expect(mainCopy).toBeDefined()
    expect(readFileSync(join(dirname(filePath), mainCopy!), 'utf8')).toBe(originalBytes)
    const walCopy = copies.find((name) => name.endsWith('-wal'))
    expect(walCopy).toBeDefined()
    expect(readFileSync(join(dirname(filePath), walCopy!), 'utf8')).toBe('uncheckpointed-wal-bytes')

    // 新库可用：写入后能读回，说明这不是一个「看着建好、其实打不开」的空壳。
    rebuilt.store.upsertDocument({
      itemId: 'item-a',
      sourceId: 'coindesk-rss',
      url: 'https://example.com/a',
      fetchedAt: '2026-10-24T12:01:00.000Z',
      bodyText: 'body',
      bodyChars: 4,
      state: 'available'
    })
    expect(rebuilt.store.getDocument('item-a')?.state).toBe('available')
    const probe = new DatabaseSync(filePath, { readOnly: true })
    try {
      expect(Number((probe.prepare('select count(*) as rows from news_document').get() as { rows: number }).rows)).toBe(1)
    } finally {
      probe.close()
    }
  })

  /** 留档失败就中止：原件一个字节不动，也不产生新库（路径上还是那份坏文件）。 */
  it('does not create a new store when the copy fails', () => {
    const filePath = tempStorePath()
    const originalBytes = 'not a sqlite database'
    writeFileSync(filePath, originalBytes, 'utf8')

    expect(() => rebuildNewsSentimentStorage(filePath, {
      copy: () => {
        throw new Error('disk full')
      }
    })).toThrow('disk full')

    expect(readFileSync(filePath, 'utf8')).toBe(originalBytes)
    expect(corruptCopies(filePath)).toEqual([])
    // 仍然打不开：没有在没保住原件的情况下建出新库。
    expect(() => openNewsSentimentDatabase(filePath)).toThrow('news-sentiment-storage-unavailable')
    expect(existsSync(filePath)).toBe(true)
  })

  /** 没有旧文件时（例如读者删掉了坏库）：不需要现场，直接建库。 */
  it('creates the store without a copy when there is no old file', () => {
    const filePath = tempStorePath()

    const rebuilt = rebuildNewsSentimentStorage(filePath)

    expect(rebuilt.quarantinedCopy).toBeUndefined()
    expect(corruptCopies(filePath)).toEqual([])
    expect(rebuilt.store.getDocument('missing')).toBeUndefined()
  })
})
