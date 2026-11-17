/**
 * **码表维护工具（离线，不进应用）**：按一张「归并判定表」建出表里还没有的码。
 *
 * 用户 2026-11-18：码表是**应用内置的数据资产**，生成/补名都放 `scripts/` 跑一次，产品代码不留推断。
 *
 * 用法：`npx tsx scripts/calendar-code-table/add-missing-codes.mts <判定表.csv>`
 *
 * 三条口径（与码表本身一致，不现场发明）：
 * - **中文名来自源标题，剥掉期次与阶段词**（`9月` / `第三季度` / `初值` / `终值`）——期次属于那一行，不属于码；
 * - **英文名只从表内同族行复用**：同族（国家+族）已有行就沿用它的英文基名，测度不同只换尾部 `(MoM)/(YoY)/…`；
 *   表内查不到就留空并标 `name-incomplete`，**不编造、不机翻**；
 * - **官网页一律 `pending`**（`official-source-todo`），没核到 200 的不填。
 *
 * 判定表列：`源内id,国家,中文名,结论,目标码,依据`；只处理出现在判定表里的目标码。
 * 插入后整表仍按 code 升序——找不到插入位就报错退出，不静默追加到末尾。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const CSV = process.argv[2]
if (CSV === undefined) {
  console.error('用法：npx tsx scripts/calendar-code-table/add-missing-codes.mts <判定表.csv>')
  process.exit(1)
}

const CODES = 'products/market-intelligence/service/intelligence/macro-calendar/marketCalendarCodeTable.ts'
const COUNTRY = 'products/market-intelligence/service/intelligence/macro-calendar/marketCalendarCountryCodeTable.ts'

/** 期次与阶段两张词表：剥掉它们，名字里不留「哪一期」。 */
const PERIOD = [
  /^第[一二三四]季度/, /^\d{4}年第[一二三四]季度/, /^Q[1-4]/,
  /^\d{4}年/, /^\d{1,2}月/, /^\d{1,2}-\d{1,2}月/, /^\d{1,2}月份/,
  /\((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\)/i,
  /\(Q[1-4]\)/i,
]
const STAGE = [
  /\(Preliminary\)/i, /\(Final\)/i, /\(Revised\)/i, /\(Advance\)/i, /\(Flash\)/i,
  /^初值/, /^终值/, /^修正值/, /（初值）/, /（终值）/, /（修正值）/,
  /\(初值\)/, /\(终值\)/, /\(修正值\)/,
]

function stripPeriodAndStage(input: string): string {
  let text = input.trim()
  for (let round = 0; round < 4; round += 1) {
    const before = text
    for (const pattern of PERIOD) text = text.replace(pattern, '').trim()
    for (const pattern of STAGE) text = text.replace(pattern, '').trim()
    if (text === before) break
  }
  return text
}

const MEASURE_SUFFIX: Record<string, string> = {
  MOM: 'MoM', YOY: 'YoY', QOQ: 'QoQ', YOY4: 'YoY', LEVEL: 'Level', AMOUNT: 'Amount',
}

type CsvRow = { country: string; zh: string; target: string }
const csvRows: CsvRow[] = []
const lines = readFileSync(CSV, 'utf8').split('\n').filter((line) => line.trim() !== '')
for (const line of lines.slice(1)) {
  const cells = line.split(',')
  const target = cells[4]?.trim() ?? ''
  if (target === '') continue
  csvRows.push({ country: cells[1]?.trim() ?? '', zh: cells[2]?.trim() ?? '', target })
}

const quote = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** 读两张表里已有的码，并按「国家+族」「族」建英文基名索引（表内事实，不是翻译）。 */
type Existing = { en: string; measure: string }
const existing = new Map<string, Existing>()
const enByCountryFamily = new Map<string, string>()
const enByFamily = new Map<string, string>()
for (const path of [CODES, COUNTRY]) {
  const text = readFileSync(path, 'utf8')
  for (const match of text.matchAll(/^  ["']([^"']+)["']: \{(.+)\},$/gm)) {
    const [, code, body] = match
    const en = /enFull: ["']((?:[^"'\\]|\\.)*)["']/.exec(body!)?.[1] ?? ''
    const measure = /measure: ["']([^"']*)["']/.exec(body!)?.[1] ?? ''
    const [country, family] = code!.split('.')
    existing.set(code!, { en, measure })
    if (en.trim() !== '' && family !== undefined) {
      enByCountryFamily.set(`${country}.${family}`, en)
      if (!enByFamily.has(family)) enByFamily.set(family, en)
    }
  }
}

/** 同族英文基名 + 本码测度：只换尾部括号，不改词。 */
function englishFor(country: string, family: string, measure: string): string {
  const reuse = enByCountryFamily.get(`${country}.${family}`) ?? enByFamily.get(family) ?? ''
  if (reuse.trim() === '') return ''
  const base = reuse.replace(/\s*\((?:MoM|YoY|QoQ|Level|Amount|MoM %|YoY %)\)\s*$/i, '').trim()
  const suffix = MEASURE_SUFFIX[measure]
  return suffix === undefined ? base : `${base} (${suffix})`
}

const wanted = new Map<string, CsvRow>()
for (const row of csvRows) if (!existing.has(row.target)) wanted.set(row.target, row)

const fresh: { code: string; line: string }[] = []
let noEnglish = 0
for (const [code, source] of [...wanted].sort((a, b) => a[0].localeCompare(b[0]))) {
  const segments = code.split('.')
  if (segments.length !== 4) throw new Error(`码不是四段：${code}`)
  const [country, family, seasonality, measure] = segments as [string, string, string, string]
  const zh = stripPeriodAndStage(source.zh)
  if (zh === '') throw new Error(`剥离期次后中文名为空：${code} ← ${source.zh}`)
  const en = englishFor(country, family, measure)
  if (en === '') noEnglish += 1
  const official = "{ pending: true, reason: 'official-source-todo' }"
  const line =
    `  ${quote(code)}: { code: ${quote(code)}, kind: 'metric', countryCode: ${quote(source.country || country)}, ` +
    `names: { zhFull: ${quote(zh)}, zhShort: ${quote(zh)}, enFull: ${quote(en)}, enShort: ${quote(en)} }, ` +
    `tier: null, parentCode: null, childOrder: null, measure: ${quote(measure)}, seasonality: ${quote(seasonality)}, ` +
    `officialSource: ${official}, status: 'active' },`
  fresh.push({ code, line })
}

const countryText = readFileSync(COUNTRY, 'utf8')
const openAt = countryText.indexOf('Object.freeze({')
if (openAt < 0) throw new Error(`${COUNTRY} 里找不到 Object.freeze({`)
const head = countryText.slice(0, countryText.indexOf('\n', openAt) + 1)
const tailText = countryText.slice(head.length)
const closeAt = tailText.lastIndexOf('})')
if (closeAt < 0) throw new Error(`${COUNTRY} 里找不到结尾的 })`)
const closing = tailText.slice(closeAt)
const all = tailText.slice(0, closeAt).split('\n').filter((line) => line.trim() !== '')
const rowPattern = /^  ["']([^"']+)["']: \{/
// 全表按 code 升序归一：不依赖「原来就有序」，也不再往里插——插位错一行就是错一整个文件。
const grouped = new Map<string, string>()
for (const line of all) {
  const code = rowPattern.exec(line)?.[1]
  if (code === undefined) throw new Error(`表内出现非行内容：${line.slice(0, 80)}`)
  grouped.set(code, line)
}
for (const item of fresh) grouped.set(item.code, item.line)
const ordered = [...grouped].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, line]) => line)
all.length = 0
all.push(...ordered)
const inserted = fresh.length
// 名字里不许留下具体期次：插完立刻自检，不为 0 就整笔不写。
const leftover = all.filter((line) => {
  const zh = /zhFull: ["']((?:[^"'\\]|\\.)*)["']/.exec(line)?.[1] ?? ''
  const en = /enFull: ["']((?:[^"'\\]|\\.)*)["']/.exec(line)?.[1] ?? ''
  return /\d{1,2}月|第[一二三四]季度|\((?:Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Q[1-4])\)|(?:Preliminary|Final|Revised)/i.test(zh + en)
})
if (leftover.length > 0) {
  console.error(`名字仍含期次/阶段 ${leftover.length} 行，拒绝写入：`)
  for (const line of leftover.slice(0, 20)) console.error(`  ${line.slice(0, 160)}`)
  process.exit(1)
}
writeFileSync(COUNTRY, `${head}${all.join('\n')}\n${closing}`)
console.log(
  `判定表目标码 ${new Set(csvRows.map((r) => r.target)).size} 个；` +
    `新建 ${inserted} 个；英文名复用表内同族 ${inserted - noEnglish} 个、留空 ${noEnglish} 个；` +
    `名字含期次/阶段 ${leftover.length} 行`,
)
