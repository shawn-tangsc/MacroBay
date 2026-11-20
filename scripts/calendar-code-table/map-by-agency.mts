/**
 * **映射维护工具（离线，不进应用）**：把「源没给国家、标题里有机构名」的未映射行重建身份后再映射。
 *
 * Chief 2026-11-18：未映射 1874 条里有一批行，源侧 `country_code` 是空的，但标题里写着机构名
 * （INSEE / Ifo / CIPS / 达拉斯联储…）。机构归属是公开事实，据此定国家**不是猜**；定出国家后
 * 身份才完整，才轮得到「走正常映射」。
 *
 * 用法：`npx tsx scripts/calendar-code-table/map-by-agency.mts <库路径> [--apply]`
 *
 * 身份重建的三步，每步都只认事实：
 * 1. **国家**来自 `agency-country.mts`；标题里没有机构名、或机构名指向两个国家 → **不判**；
 * 2. **族**来自码表：用剥掉期次后的标题去比该国码表的 `zhFull`，**恰好一个**才收；
 *    多个 = 歧义（同一个中文名对上该国多个码）→ 不判，列出来；
 * 3. **期次规则**来自码的测度：`MOM`/`YOY` → 月、`QOQ` → 季；`LEVEL`/`AMOUNT`/`RATE`/`COUNT`
 *    从码上看不出是月、季还是周，**不映射**（与上一笔同一口径，猜一个就把周度记成月度）。
 *
 * `--apply` 只改映射表这一处数据文件，**不写库**：库里的转正由 `calendar-promote-source-identities`
 * 走正常链路完成。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { openSqliteDatabase } from '../../platform/storage/sqlite/openSqliteDatabase'
import { markTempDirectoryVerified } from '../../platform/storage/sqlite/tempDirectoryReadiness'

import { countryByAgency } from './agency-country.mts'

const [databasePath, ...flags] = process.argv.slice(2)
if (databasePath === undefined) {
  console.error('用法：npx tsx scripts/calendar-code-table/map-by-agency.mts <库路径> [--apply]')
  process.exit(1)
}
const apply = flags.includes('--apply')

const MAPPINGS = 'products/market-intelligence/service/intelligence/macro-calendar/marketCalendarCountrySourceMappings.ts'
const TABLE_DIR = 'products/market-intelligence/service/intelligence/macro-calendar'

const PERIOD = [/^第[一二三四]季度/, /^\d{4}年/, /^\d{1,2}月/, /^\d{1,2}-\d{1,2}月/, /\((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\)/i, /\(Q[1-4]\)/i]
const STAGE = [/\(Preliminary\)/i, /\(Final\)/i, /\(Revised\)/i, /^初值/, /^终值/, /^修正值/, /\(初值\)/, /\(终值\)/, /\(修正值\)/]
function normalize(name: string): string {
  let text = name.replace(/（/g, '(').replace(/）/g, ')').trim()
  for (let round = 0; round < 4; round += 1) {
    const before = text
    for (const pattern of PERIOD) text = text.replace(pattern, '').trim()
    for (const pattern of STAGE) text = text.replace(pattern, '').trim()
    if (text === before) break
  }
  return text.toLowerCase()
}

const PERIOD_RULE: Record<string, 'month' | 'quarter'> = { MOM: 'month', YOY: 'month', QOQ: 'quarter' }

type CodeRow = { code: string; country: string; zh: string; en: string }
const codes: CodeRow[] = []
for (const file of ['marketCalendarCodeTable.json', 'marketCalendarCountryCodeTable.json']) {
  const rows = JSON.parse(readFileSync(`${TABLE_DIR}/${file}`, 'utf8')) as Record<string, {
    code: string; countryCode: string | null; status?: string; kind?: string
    names?: { zhFull?: string; enFull?: string }
  }>
  for (const row of Object.values(rows)) {
    if (row.kind !== undefined && row.kind !== 'metric') continue
    if (row.status === 'retired' || row.countryCode === null) continue
    codes.push({
      code: row.code, country: row.countryCode,
      zh: normalize(row.names?.zhFull ?? ''), en: normalize(row.names?.enFull ?? ''),
    })
  }
}
const byCountryZh = new Map<string, string[]>()
for (const row of codes) {
  for (const name of [row.zh, row.en]) {
    if (name === '') continue
    const key = `${row.country}|${name}`
    byCountryZh.set(key, [...(byCountryZh.get(key) ?? []), row.code])
  }
}
const byCode = new Map(codes.map((row) => [row.code, row]))
markTempDirectoryVerified()

const database = openSqliteDatabase(databasePath, { readOnly: true })
const unmapped = database.prepare(`select provider_id, source_key, raw_json from mi_calendar_unmapped
  where reason = 'missing-country'`).all() as { provider_id: string; source_key: string; raw_json: string }[]
database.close()

console.log('既有映射键', [...readFileSync(MAPPINGS, 'utf8').matchAll(/^  '([^']+)': \{/gm)].length)
const existing = new Set([...readFileSync(MAPPINGS, 'utf8').matchAll(/^  '([^']+)': \{/gm)].map((m) => m[1]!))
const resolved: { sourceId: string; metricKey: string; periodRule: 'month' | 'quarter'; title: string; country: string }[] = []
const ambiguous: { title: string; country: string; codes: string[] }[] = []
const noRule: string[] = []
const missing: string[] = []
let agencyHits = 0
for (const row of unmapped) {
  const name = (JSON.parse(row.raw_json) as { name?: string }).name ?? ''
  const country = countryByAgency(name)
  if (country === undefined) continue
  agencyHits += 1
  const sourceId = (JSON.parse(row.source_key) as string[])[0]
  if (sourceId === undefined) continue
  const matches = [...new Set(byCountryZh.get(`${country}|${normalize(name)}`) ?? [])]
  if (matches.length === 0) { missing.push(`${country} ${name} → ${normalize(name)}`); continue }
  if (matches.length > 1) { ambiguous.push({ title: name, country, codes: matches }); continue }
  const code = matches[0]!
  const periodRule = PERIOD_RULE[code.split('.')[3] ?? '']
  if (periodRule === undefined) { noRule.push(code); continue }
  if (existing.has(sourceId)) continue
  resolved.push({ sourceId, metricKey: code, periodRule, title: name, country })
}

const measures = new Map<string, number>()
for (const code of noRule) { const m = code.split('.')[3] ?? ''; measures.set(m, (measures.get(m) ?? 0) + 1) }
console.log('测度分布（期次定不出）:', [...measures].sort((a, b) => b[1] - a[1]))
console.log(`未映射 ${unmapped.length} 条；标题认出机构 ${agencyHits} 条；` +
  `其中中文名在码表里唯一命中 ${resolved.length} 条、歧义 ${ambiguous.length} 条、测度定不出期次 ${noRule.length} 条`)
for (const row of missing.slice(0, 10)) console.log(`  未命中 ${row}`)
for (const row of ambiguous.slice(0, 8)) console.log(`  歧义 ${row.country} ${row.title} → ${row.codes.join(' / ')}`)

if (!apply || resolved.length === 0) {
  for (const row of resolved.slice(0, 8)) console.log(`  ${row.sourceId} → ${row.metricKey}（${row.periodRule}）`)
  process.exit(0)
}

const text = readFileSync(MAPPINGS, 'utf8')
const anchor = '= Object.freeze({\n'
const at = text.indexOf(anchor)
if (at < 0) throw new Error(`${MAPPINGS} 里找不到 Object.freeze({`)
const insertAt = at + anchor.length
const seenIds = new Set<string>()
const block = [...resolved].filter((row) => {
  if (seenIds.has(row.sourceId)) return false
  seenIds.add(row.sourceId)
  return true
})
  .sort((a, b) => Number(a.sourceId) - Number(b.sourceId))
  .map((row) => `  '${row.sourceId}': { metricKey: '${row.metricKey}', periodRule: '${row.periodRule}' },\n`)
  .join('')
writeFileSync(MAPPINGS, `${text.slice(0, insertAt)}${block}${text.slice(insertAt)}`)
console.log(`已写入 ${block.split('\n').filter((line) => line !== '').length} 条到映射表（去重后）`)
