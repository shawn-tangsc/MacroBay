/**
 * **码表维护工具（离线，不进应用）**：把「同一事实两个码」旧的重复码标成 `retired` 并指回保留码。
 *
 * 用户口径：同一事实不许有两个身份（密歇根那条还是一级指标）。新码表按国家重建时，把老表里
 * 已有的概念又建了一份，族名/测度编码不同但指的是同一件事。
 *
 * 用法：`npx tsx scripts/calendar-code-table/retire-duplicates.mts [--apply]`
 *
 * 三条规则：
 * - **重复判定只看表内事实**：同 `countryCode` 且 `zhFull` 相同，或同 `countryCode` 且 `enFull` 相同；
 * - **保留码 = 被产品代码引用最多的那个**（图卡、分级、发布组在用的是它），平手时保留**老表**
 *   （`marketCalendarCodeTable.ts`）里的那个——新表是重建出来的，改名不该反向吃掉调用方；
 * - 只标 `status: 'retired'` + `supersededBy`，**不删行**：删了就看不出两个码曾经并存过。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const APPLY = process.argv.includes('--apply')
const CODE_TABLE = 'products/market-intelligence/service/intelligence/macro-calendar/marketCalendarCodeTable.ts'
const COUNTRY_TABLE = 'products/market-intelligence/service/intelligence/macro-calendar/marketCalendarCountryCodeTable.ts'

const ROW = /^  ["']([^"']+)["']: \{(.+)\},$/
function field(body: string, key: string): string {
  return new RegExp(`${key}: ["']((?:[^"'\\\\]|\\\\.)*)["']`).exec(body)?.[1] ?? ''
}

type Row = { code: string; country: string; zh: string; en: string; kind: string; status: string; path: string }
const rows: Row[] = []
for (const path of [CODE_TABLE, COUNTRY_TABLE]) {
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = ROW.exec(line)
    if (match === null) continue
    rows.push({
      code: match[1]!, country: field(match[2]!, 'countryCode'), zh: field(match[2]!, 'zhFull'),
      en: field(match[2]!, 'enFull'), kind: field(match[2]!, 'kind'), status: field(match[2]!, 'status'), path,
    })
  }
}

/** 引用次数：在数据表以外的产品代码里被提到多少次（表自己不算，否则每个码都至少 1）。 */
const tracked = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], { encoding: 'utf8' })
  .split('\n')
  .filter((path) => path !== '' && path !== CODE_TABLE && path !== COUNTRY_TABLE)
const corpus = tracked.map((path) => readFileSync(path, 'utf8')).join('\n')
const references = new Map<string, number>()
for (const row of rows) references.set(row.code, corpus.split(row.code).length - 1)

const groups = new Map<string, Row[]>()
const add = (key: string, row: Row): void => {
  const list = groups.get(key) ?? []
  list.push(row)
  groups.set(key, list)
}
for (const row of rows) {
  if (row.kind !== 'metric' || row.status === 'retired') continue
  if (row.zh.trim() !== '') add(`zh|${row.country}|${row.zh.trim().toLowerCase()}`, row)
  if (row.en.trim() !== '') add(`en|${row.country}|${row.en.trim().toLowerCase()}`, row)
}

const retire = new Map<string, string>()
for (const [, group] of groups) {
  const unique = [...new Map(group.map((row) => [row.code, row])).values()]
  if (unique.length < 2) continue
  const ranked = [...unique].sort((a, b) => {
    const byUse = (references.get(b.code) ?? 0) - (references.get(a.code) ?? 0)
    if (byUse !== 0) return byUse
    const byTable = Number(a.path === CODE_TABLE) - Number(b.path === CODE_TABLE)
    if (byTable !== 0) return -byTable
    return a.code.length - b.code.length
  })
  const keeper = ranked[0]!
  for (const row of ranked.slice(1)) {
    if (retire.has(row.code)) continue
    if (retire.has(keeper.code)) break // 保留码自己已被别人指回，别成链
    retire.set(row.code, keeper.code)
  }
}

for (const [code, keeper] of retire) {
  const row = rows.find((candidate) => candidate.code === code)
  if (row === undefined) continue
  const text = readFileSync(row.path, 'utf8')
  const line = text.split('\n').find((candidate) => candidate.startsWith(`  "${code}":`) || candidate.startsWith(`  '${code}':`))
  if (line === undefined) throw new Error(`找不到行：${code}`)
  const patched = line
    .replace(/status: ["'][a-z-]+["']/, `status: "retired"`)
    .replace(/\},$/, `, supersededBy: "${keeper}" },`)
  if (APPLY) writeFileSync(row.path, text.replace(line, patched))
}

console.log(`重复组 ${[...groups.values()].filter((g) => new Set(g.map((r) => r.code)).size > 1).length} 个；` +
  `标 retired ${retire.size} 个；${APPLY ? '已写入' : '干跑，未写入'}`)
for (const [code, keeper] of [...retire]) console.log(`  ${code} → ${keeper}`)
