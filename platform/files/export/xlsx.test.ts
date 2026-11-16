import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
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
function unpack(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'xlsx-check-'))
  const file = join(dir, 'out.xlsx')
  writeFileSync(file, bytes)
  execFileSync('unzip', ['-o', '-q', file, '-d', join(dir, 'un')], { stdio: 'pipe' })
  return join(dir, 'un')
}

const readBack = (bytes: Uint8Array, name: string): string => readFileSync(join(unpack(bytes), name), 'utf8')

const rowCountOf = (sheetXml: string): number => (sheetXml.match(/<row /gu) ?? []).length

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
  expect(readdirSync(join(unpack(bytes), 'xl', 'worksheets'))).toEqual(['sheet1.xml'])

  // 3) 读回工作表：行数、列数、首行内容都对得上。
  const sheet = readBack(bytes, 'xl/worksheets/sheet1.xml')
  expect(rowCountOf(sheet)).toBe(rows.length)
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

it('writes several worksheets into one file, each one readable on its own', () => {
  const bytes = buildXlsx([
    { name: '已映射', rows: [['源内 id', '指标码'], ['214790', 'US.CPI.NSA.YOY'], ['10113', 'US.MICHIGAN.NONE.LEVEL']] },
    // 第二张故意是「只有表头」的空表：空表也必须存在，读者才会读成「这一栏没有」而不是「整张表消失」。
    { name: '未映射', rows: [['源内 id', '行数']] }
  ])
  const root = unpack(bytes)

  // 两张表各一个部件；少一个那张表就打不开。
  expect(readdirSync(join(root, 'xl', 'worksheets'))).toEqual(['sheet1.xml', 'sheet2.xml'])
  // 类型清单要两张都声明（只声明第一张是这张文件最常见的坏法）。
  const types = readFileSync(join(root, '[Content_Types].xml'), 'utf8')
  expect(types).toContain('/xl/worksheets/sheet1.xml')
  expect(types).toContain('/xl/worksheets/sheet2.xml')
  // 工作簿按顺序列出两个名字，且有各自的关系与工作表部件。
  const workbook = readFileSync(join(root, 'xl', 'workbook.xml'), 'utf8')
  expect(workbook).toContain('name="已映射" sheetId="1" r:id="rId1"')
  expect(workbook).toContain('name="未映射" sheetId="2" r:id="rId2"')
  expect(readFileSync(join(root, 'xl', '_rels', 'workbook.xml.rels'), 'utf8'))
    .toContain('Target="worksheets/sheet2.xml"')

  // 各自的行数与内容：两张表都得读回来核，只核第一张等于没验第二张。
  const first = readFileSync(join(root, 'xl', 'worksheets', 'sheet1.xml'), 'utf8')
  const second = readFileSync(join(root, 'xl', 'worksheets', 'sheet2.xml'), 'utf8')
  expect(rowCountOf(first)).toBe(3)
  expect(rowCountOf(second)).toBe(1)
  expect(first).toContain('US.CPI.NSA.YOY')
  expect(second).not.toContain('US.CPI.NSA.YOY')
  expect(second).toContain('行数')
})

it('cleans worksheet names Excel would reject, and keeps them unique', () => {
  const workbook = readBack(buildXlsx([
    { name: 'a/b:c', rows: [['x']] },
    { name: 'a/b:c', rows: [['y']] }
  ]), 'xl/workbook.xml')
  expect(workbook).toContain('name="abc"')
  // 同名工作表 Excel 打不开，第二张必须换个名字。
  expect(workbook).toContain('name="abc (2)"')
})

it('refuses to build a file with no worksheet', () => {
  expect(() => buildXlsx([])).toThrow('xlsx needs at least one sheet')
})

it('refuses a worksheet with no rows, so a missing header cannot pass as data', () => {
  // 漏了表头时，第一行数据会顶上去当表头：文件能打开、看着正常，只是少一行。这是最难查的那种错。
  expect(() => buildXlsx({ name: '已映射', rows: [] })).toThrow('needs a header row')
  // 多表时任何一张零行也拒，不只看第一张。
  expect(() => buildXlsx([
    { name: '已映射', rows: [['源内 id']] },
    { name: '未映射', rows: [] }
  ])).toThrow('xlsx sheet "未映射" needs a header row')
  // 只有表头是合法的空表：这才代表「这一栏没有」。
  expect(() => buildXlsx({ name: '未映射', rows: [['源内 id']] })).not.toThrow()
})
