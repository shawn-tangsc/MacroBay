import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { listQuarantineCopies, quarantineCopyScanPolicy } from './quarantineCopies'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'quarantine-scan-'))
  roots.push(directory)
  return directory
}

describe('quarantine copy scan', () => {
  it('finds the copies next to their files, ignores look-alikes, and reports where they are', async () => {
    const directory = await root()
    await mkdir(join(directory, 'platform'), { recursive: true })
    await mkdir(join(directory, 'products', 'market-intelligence'), { recursive: true })
    await writeFile(join(directory, 'platform', 'settings.json.corrupt-1762345678901'), '{"language":"zh-CN"}')
    await writeFile(join(directory, 'products', 'market-intelligence', 'news.json.corrupt-1762345678902-1'), '{}')
    // 不像素：数字时间戳是判据的一部分，别的一概不收。
    await writeFile(join(directory, 'platform', 'settings.json'), '{}')
    await writeFile(join(directory, 'platform', 'notes.corrupt-abc'), 'x')
    await writeFile(join(directory, 'platform', 'archive.corrupt-1762.txt'), 'x')

    const scan = await listQuarantineCopies(directory)

    expect(scan.copies.map((copy) => copy.relativePath).sort()).toEqual([
      'platform/settings.json.corrupt-1762345678901',
      'products/market-intelligence/news.json.corrupt-1762345678902-1'
    ])
    expect(scan.copies.every((copy) => copy.sizeBytes > 0)).toBe(true)
    expect(scan.copies.every((copy) => !Number.isNaN(Date.parse(copy.modifiedAt)))).toBe(true)
    expect(scan.unreadableDirectories).toBe(0)
    expect(scan.truncated).toBe(false)
  })

  it('separates "nothing to list" from "could not read": a missing root throws, an unreadable folder is counted', async () => {
    await expect(listQuarantineCopies(join(tmpdir(), 'quarantine-scan-does-not-exist'))).rejects.toThrow()

    const directory = await root()
    await mkdir(join(directory, 'locked'), { recursive: true })
    await writeFile(join(directory, 'kept.json.corrupt-1762345678903'), '{}')
    await writeFile(join(directory, 'locked', 'hidden.json.corrupt-1762345678904'), '{}')
    const { chmod } = await import('node:fs/promises')
    await chmod(join(directory, 'locked'), 0o000)
    try {
      const scan = await listQuarantineCopies(directory)
      // 列表照出读得到的那些；读不到的那个目录单独计数——它不是「没有副本」。
      expect(scan.copies.map((copy) => copy.relativePath)).toEqual(['kept.json.corrupt-1762345678903'])
      expect(scan.unreadableDirectories).toBe(1)
    } finally {
      await chmod(join(directory, 'locked'), 0o700)
    }
  })

  it('stops at the cap and says the list is truncated instead of pretending it is complete', async () => {
    const directory = await root()
    for (let index = 0; index < 3; index += 1) {
      await writeFile(join(directory, `settings-${index}.json.corrupt-176234567891${index}`), '{}')
    }

    const scan = await listQuarantineCopies(directory, { maxCopies: 2 })

    expect(scan.copies).toHaveLength(2)
    expect(scan.truncated).toBe(true)
    // 上限是「扫描有终点」的保证，不是判据本身：模式仍只认时间戳副本。
    expect(quarantineCopyScanPolicy.fileNamePattern.test('x.corrupt-1762345678901')).toBe(true)
    expect(quarantineCopyScanPolicy.fileNamePattern.test('x.corrupt-1762')).toBe(false)
  })
})
