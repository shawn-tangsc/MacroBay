import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import type { NewsDocumentRecord } from '../schema/newsSentiment'
import {
  createNewsSentimentSqliteStore,
  openNewsSentimentDatabase
} from './newsSentimentStore'

const DOCUMENT: NewsDocumentRecord = {
  itemId: 'item-a',
  sourceId: 'coindesk-rss',
  url: 'https://example.com/a',
  fetchedAt: '2026-10-24T12:01:00.000Z',
  bodyText: 'body',
  bodyChars: 4,
  state: 'available'
}

const directories: string[] = []

function tempStorePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'news-sentiment-open-'))
  directories.push(directory)
  return join(directory, 'intelligence-news-sentiment.sqlite')
}

function corruptCopies(filePath: string): string[] {
  const prefix = `${basename(filePath)}.corrupt-`
  return readdirSync(dirname(filePath)).filter((name) => name.startsWith(prefix)).sort()
}

function countDocuments(filePath: string): number {
  const db = new DatabaseSync(filePath, { readOnly: true })
  try {
    return Number((db.prepare('select count(*) as rows from news_document').get() as { rows: number }).rows)
  } finally {
    db.close()
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('news sentiment store open failures', () => {
  /**
   * 打不开不是「没有数据」：文件被锁时只报「打不开」，库文件与其中的行必须原样还在。
   * 旧实现在这里删掉库文件并重建，一次锁就把整库历史静默清空（0.4.2 存储审计 #1）。
   */
  it('keeps the store file and its rows when the file is locked', () => {
    const filePath = tempStorePath()
    createNewsSentimentSqliteStore(filePath).upsertDocument(DOCUMENT)
    expect(countDocuments(filePath)).toBe(1)

    const locked = Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR' })
    expect(() => openNewsSentimentDatabase(filePath, () => {
      throw locked
    })).toThrow('news-sentiment-storage-unavailable')

    expect(existsSync(filePath)).toBe(true)
    expect(corruptCopies(filePath)).toEqual([])
    expect(countDocuments(filePath)).toBe(1)
  })

  it('keeps the store file and its rows when the file cannot be opened for permissions', () => {
    const filePath = tempStorePath()
    createNewsSentimentSqliteStore(filePath).upsertDocument(DOCUMENT)

    const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    expect(() => openNewsSentimentDatabase(filePath, () => {
      throw denied
    })).toThrow('news-sentiment-storage-unavailable')

    expect(existsSync(filePath)).toBe(true)
    expect(corruptCopies(filePath)).toEqual([])
    expect(countDocuments(filePath)).toBe(1)
  })

  /** 真损坏：先留一份 `.corrupt-*` 证据，再报「打不开」；原件不删，也不自动重建。 */
  it('keeps a corrupt copy of a file that is not a database and refuses to open it', () => {
    const filePath = tempStorePath()
    writeFileSync(filePath, 'not a sqlite database', 'utf8')

    expect(() => openNewsSentimentDatabase(filePath)).toThrow('news-sentiment-storage-unavailable')

    const copies = corruptCopies(filePath)
    expect(copies).toHaveLength(1)
    expect(readFileSync(join(dirname(filePath), copies[0]), 'utf8')).toBe('not a sqlite database')
    // 原件留着：证据和可能的人工修复都要靠它。
    expect(readFileSync(filePath, 'utf8')).toBe('not a sqlite database')
  })

  /** 文件不存在是首次启动，不是损坏：走默认态，不产生任何 `.corrupt-*`。 */
  it('starts from the default state when the file does not exist yet', () => {
    const filePath = tempStorePath()

    const store = createNewsSentimentSqliteStore(filePath)

    expect(store.getDocument('missing')).toBeUndefined()
    expect(countDocuments(filePath)).toBe(0)
    expect(corruptCopies(filePath)).toEqual([])
  })
})
