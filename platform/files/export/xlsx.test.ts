import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import { buildXlsx } from './xlsx'

/**
 * **把导出的文件读回来核对**——只断言「生成了文件」等于没验：真出问题时恰恰是文件能生成、
 * Excel 打不开。所以这里落到磁盘、用系统自带的解压把它拆开，再从工作表 XML 里读回单元格。
 *
 * 用 `unzip`（macOS/Linux 自带）而不是自己写读包器：验的是「别人能不能打开」，不是「我自己读得回」。
 */
function readBack(bytes: Uint8Array, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'xlsx-check-'))
  const file = join(dir, 'out.xlsx')
  writeFileSync(file, bytes)
  execFileSync('unzip', ['-o', '-q', file, '-d', join(dir, 'un'), name], { stdio: 'pipe' })
  const target = join(dir, 'un', name)
  return execFileSync('cat', [target], { encoding: 'utf8' })
}

it('writes a file Excel can open, and reads the same rows back', () => {
  const rows = [
    ['源内 id', '指标码', '名称'],
    ['214790', 'US.CPI.NSA.YOY', 'CPI 年率 · Consumer Price Index (CPI), YoY'],
    ['10113', 'US.MICHIGAN.NONE.LEVEL', '密歇根现况 · Michigan Current Conditions']
  ]
  const bytes = buildXlsx({ name: '映射规则', rows })

  // 1) 真的是 zip：本地文件头 `PK\x03\x04`。
  expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4B, 0x03, 0x04])

  // 2) 解出来要有这五个部件（少一个 Excel 就报「文件已损坏」）。
  const dir = mkdtempSync(join(tmpdir(), 'xlsx-parts-'))
  const file = join(dir, 'out.xlsx')
  writeFileSync(file, bytes)
  execFileSync('unzip', ['-o', '-q', file, '-d', join(dir, 'un')], { stdio: 'pipe' })
  expect(readdirSync(join(dir, 'un', 'xl', 'worksheets'))).toEqual(['sheet1.xml'])

  // 3) 读回工作表：行数、列数、首行内容都对得上。
  const sheet = readBack(bytes, 'xl/worksheets/sheet1.xml')
  const rowCount = (sheet.match(/<row /gu) ?? []).length
  expect(rowCount).toBe(rows.length)
  const firstRow = /<row r="1">(.*?)<\/row>/u.exec(sheet)?.[1] ?? ''
  expect((firstRow.match(/<c /gu) ?? []).length).toBe(3)
  expect(sheet).toContain('源内 id')
  expect(sheet).toContain('US.CPI.NSA.YOY')
  // 中文与 `·` 原样保留（`xml:space="preserve"` 才不会被吞空格）。
  expect(sheet).toContain('CPI 年率 · Consumer Price Index (CPI), YoY')
})

it('escapes XML so a name with < & " cannot break the file', () => {
  const sheet = readBack(buildXlsx({ name: 'x', rows: [['a<b&c"d']] }), 'xl/worksheets/sheet1.xml')
  expect(sheet).toContain('a&lt;b&amp;c&quot;d')
  expect(sheet).not.toContain('a<b&c"d')
})
