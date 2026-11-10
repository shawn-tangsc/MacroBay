import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createCellEnabledStore } from './cellEnabledStore'

/**
 * 「格级启用」存储的四条判据（产品 2026-11-11）：
 * 缺键不回键、写入读回一致且同值不再写、读不懂的照留、读两次不改文件。
 *
 * 第二条特意**换一个新 store 实例**读同一个文件：同一实例读回来证明的是内存，不是落盘。
 */
const dirs: string[] = []

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cell-enabled-'))
  dirs.push(dir)
  return join(dir, 'intelligence-cell-enabled.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('cell enabled store', () => {
  it('returns no keys at all when nothing was ever written (missing key means enabled)', async () => {
    const file = tempFile()
    const store = createCellEnabledStore(file)
    expect(await store.readCellEnabled()).toEqual({})
    // 读一次也会建目录/文件吗？不会：读路径只读。
    expect(() => readFileSync(file, 'utf8')).toThrow()
  })

  it('reads back what it wrote through a fresh store, and a same-value write leaves the file untouched', async () => {
    const file = tempFile()
    await createCellEnabledStore(file).setCellEnabled('quotes:ndx', false)

    const reread = await createCellEnabledStore(file).readCellEnabled()
    expect(reread).toEqual({ 'quotes:ndx': false })

    const before = readFileSync(file, 'utf8')
    const beforeMtime = statSync(file).mtimeMs
    await createCellEnabledStore(file).setCellEnabled('quotes:ndx', false)
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(statSync(file).mtimeMs).toBe(beforeMtime)
    // version 只在真正写入时 +1：同值重复写没产生新版本。
    expect(JSON.parse(before)).toMatchObject({ version: 1 })
  })

  it('keeps unknown fields and other cell ids (even unreadable values) when one cell is written', async () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({
      version: 3,
      cells: { 'quotes:ndx': false, 'weird:cell': 'not-a-boolean' },
      futureField: { kept: true }
    }), 'utf8')

    await createCellEnabledStore(file).setCellEnabled('quotes:spx', true)

    const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(stored.version).toBe(4)
    expect(stored.futureField).toEqual({ kept: true })
    expect(stored.cells).toMatchObject({
      'quotes:ndx': false,
      'weird:cell': 'not-a-boolean',
      'quotes:spx': true
    })
    // 读结果只给布尔值；读不懂的那个留在文档里，不作为「显式设置」交出去。
    expect(await createCellEnabledStore(file).readCellEnabled()).toEqual({ 'quotes:ndx': false, 'quotes:spx': true })
  })

  it('reading twice never rewrites the document', async () => {
    const file = tempFile()
    await createCellEnabledStore(file).setCellEnabled('quotes:ndx', false)
    const before = readFileSync(file, 'utf8')
    const beforeMtime = statSync(file).mtimeMs

    await createCellEnabledStore(file).readCellEnabled()
    await createCellEnabledStore(file).readCellEnabled()

    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(statSync(file).mtimeMs).toBe(beforeMtime)
  })

  it('remembers which source a cell chose, and a null choice removes the key', async () => {
    const file = tempFile()
    await createCellEnabledStore(file).setCellSelection('quotes:usd', 'realmarketapi-market')
    expect(await createCellEnabledStore(file).readCellSelection()).toEqual({ 'quotes:usd': 'realmarketapi-market' })

    await createCellEnabledStore(file).setCellSelection('quotes:usd', null)
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { selections?: Record<string, unknown> }
    // 写 null = 把键删掉（缺键就是「没选」），不是留一个空串。
    expect(stored.selections && Object.prototype.hasOwnProperty.call(stored.selections, 'quotes:usd')).toBe(false)
    expect(await createCellEnabledStore(file).readCellSelection()).toEqual({})
  })

  it('keeps the legacy cells field exactly as it was when only a selection is written', async () => {
    const file = tempFile()
    await createCellEnabledStore(file).setCellEnabled('quotes:ndx', false)
    const before = JSON.parse(readFileSync(file, 'utf8')) as { cells: Record<string, unknown>; version: number }

    await createCellEnabledStore(file).setCellSelection('quotes:usd', 'twelve-data-market')

    const after = JSON.parse(readFileSync(file, 'utf8')) as { cells: Record<string, unknown>; version: number; selections: Record<string, unknown> }
    expect(after.cells).toEqual(before.cells)
    expect(after.version).toBe(before.version + 1)
    expect(after.selections).toEqual({ 'quotes:usd': 'twelve-data-market' })
  })

  it('keeps unknown fields and unreadable selections when one choice is written', async () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({
      version: 5,
      cells: { 'quotes:ndx': false },
      selections: { 'weird:cell': 42, 'quotes:gold': 'realmarketapi-market' },
      futureField: ['kept']
    }), 'utf8')

    await createCellEnabledStore(file).setCellSelection('quotes:usd', 'twelve-data-market')

    const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(stored.version).toBe(6)
    expect(stored.futureField).toEqual(['kept'])
    expect(stored.cells).toEqual({ 'quotes:ndx': false })
    expect(stored.selections).toMatchObject({
      'weird:cell': 42,
      'quotes:gold': 'realmarketapi-market',
      'quotes:usd': 'twelve-data-market'
    })
    // 读结果只给字符串；非字符串留在文档里，不作为「显式选择」交出去。
    expect(await createCellEnabledStore(file).readCellSelection()).toEqual({
      'quotes:gold': 'realmarketapi-market',
      'quotes:usd': 'twelve-data-market'
    })
  })

  it('short-circuits a same-value selection write and leaves reads untouched', async () => {
    const file = tempFile()
    await createCellEnabledStore(file).setCellSelection('quotes:usd', 'realmarketapi-market')
    const before = readFileSync(file, 'utf8')
    const beforeMtime = statSync(file).mtimeMs

    await createCellEnabledStore(file).setCellSelection('quotes:usd', 'realmarketapi-market')
    await createCellEnabledStore(file).readCellSelection()

    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(statSync(file).mtimeMs).toBe(beforeMtime)
  })
})
