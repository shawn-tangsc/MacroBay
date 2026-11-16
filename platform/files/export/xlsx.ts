/**
 * 最小 xlsx 生成器：**零依赖**，手写 zip（STORE 不压缩）+ 最小 OOXML 部件。
 *
 * 为什么不用库：导出一个几千行的表，不值得引入一整条供应链依赖（`exceljs` 会带进 zip、
 * XML、日期等一整套）。这里只做一件事：把二维字符串表写成 Excel 能打开的文件。
 *
 * **多工作表**（用户 2026-11-17）：一次可以写多张表，各占一个 `sheetN.xml`，由 `workbook.xml`
 * 与它的关系文件串起来。一张表也走同一条路（只有 `sheet1.xml`），所以「一个」不是特例。
 *
 * 格式要点（写错就打不开，所以每条都在用例里读回来核过）：
 * - zip 用 **STORE**（method 0），CRC32 必须对，否则 Excel 报「文件已损坏」；
 * - 单元格用 `inlineStr`，不建 sharedStrings（省一层间接，少一处出错）；
 * - `[Content_Types].xml` 必须声明 rels/xml 扩展名与 workbook/sheet 的 content type，
 *   且**每张工作表各一条 Override**——少一条那张表就打不开；
 * - 工作表名有字符集限制（`\ / ? * [ ] :`）与 31 字上限，这里统一清洗后写进文件。
 */
export type XlsxCell = string | number | null | undefined
export type XlsxSheet = Readonly<{ name: string; rows: readonly (readonly XlsxCell[])[] }>

const encoder = new TextEncoder()

/** 工作表名上限（Excel 的硬限制），超了会被截断。 */
const MAX_SHEET_NAME = 31
/** OOXML 不允许出现在工作表名里的字符。 */
const ILLEGAL_SHEET_CHARS = /[\\/?*[\]:]/gu

/** 清洗工作表名：去非法字符、截 31 字；同名时追加 ` (2)`，否则 Excel 打不开。 */
function sheetNames(sheets: readonly XlsxSheet[]): string[] {
  const seen = new Set<string>()
  return sheets.map((sheet) => {
    const base = sheet.name.replace(ILLEGAL_SHEET_CHARS, '').trim().slice(0, MAX_SHEET_NAME) || 'Sheet'
    let candidate = base
    for (let copy = 2; seen.has(candidate.toLowerCase()); copy += 1) {
      const suffix = ` (${copy})`
      candidate = `${base.slice(0, MAX_SHEET_NAME - suffix.length)}${suffix}`
    }
    seen.add(candidate.toLowerCase())
    return candidate
  })
}

/** CRC32（zip 校验用）。表按 0xEDB88320 反向多项式预生成。 */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF]! ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

const escapeXml = (value: string): string => value
  .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  .replace(/"/gu, '&quot;').replace(/'/gu, '&apos;')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '')

/** 列号 → 字母（0 → A，25 → Z，26 → AA）。 */
function columnName(index: number): string {
  let name = ''
  let value = index
  while (value >= 0) {
    name = String.fromCharCode(65 + (value % 26)) + name
    value = Math.floor(value / 26) - 1
  }
  return name
}

function sheetXml(sheet: XlsxSheet): string {
  const rows = sheet.rows.map((row, rowIndex) => {
    const cells = row.map((cell, cellIndex) => {
      const ref = `${columnName(cellIndex)}${rowIndex + 1}`
      if (cell === null || cell === undefined || cell === '') return ''
      if (typeof cell === 'number' && Number.isFinite(cell)) return `<c r="${ref}"><v>${cell}</v></c>`
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(cell))}</t></is></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
}

function parts(sheets: readonly XlsxSheet[]): ReadonlyArray<readonly [name: string, xml: string]> {
  const names = sheetNames(sheets)
  const overrides = sheets.map((_sheet, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('')
  const workbookSheets = names.map((name, index) =>
    `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join('')
  const workbookRels = sheets.map((_sheet, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join('')
  return [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}</Relationships>`],
    ...sheets.map((sheet, index) =>
      [`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet)] as const)
  ]
}

/** 把若干部件打成 STORE 模式的 zip。STORE 不压缩：xlsx 本来就小，省掉 deflate 实现。 */
function zip(files: ReadonlyArray<readonly [name: string, bytes: Uint8Array]>): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, bytes] of files) {
    const nameBytes = encoder.encode(name)
    const crc = crc32(bytes)
    const local = new Uint8Array(30 + nameBytes.length + bytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)     // 本地文件头签名
    localView.setUint16(4, 20, true)             // 需要版本 2.0
    localView.setUint16(6, 0, true)              // flags
    localView.setUint16(8, 0, true)              // STORE
    localView.setUint16(10, 0, true)             // 时间
    localView.setUint16(12, 0, true)             // 日期
    localView.setUint32(14, crc, true)
    localView.setUint32(18, bytes.length, true)  // 压缩后大小
    localView.setUint32(22, bytes.length, true)  // 原始大小
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)             // extra 长度
    local.set(nameBytes, 30)
    local.set(bytes, 30 + nameBytes.length)
    locals.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)   // 中央目录签名
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, 0, true)
    centralView.setUint16(14, 0, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, bytes.length, true)
    centralView.setUint32(24, bytes.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)

    offset += local.length
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  const out = new Uint8Array(offset + centralSize + end.length)
  let cursor = 0
  for (const part of [...locals, ...centrals, end]) { out.set(part, cursor); cursor += part.length }
  return out
}

/**
 * 二维表 → xlsx 字节。行与列都按传入顺序，**第一行通常当表头**（表头就是第一行，不再单独传一个
 * `header`：同一件事只留一种写法，空表时传 `[表头]` 即可）。
 *
 * 传一个表或一组表都行；一组表按数组顺序成为 `sheet1`、`sheet2`……
 */
export function buildXlsx(input: XlsxSheet | readonly XlsxSheet[]): Uint8Array {
  const sheets = Array.isArray(input) ? input : [input as XlsxSheet]
  if (sheets.length === 0) throw new Error('xlsx needs at least one sheet')
  return zip(parts(sheets).map(([name, xml]) => [name, encoder.encode(xml)] as const))
}
