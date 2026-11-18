/**
 * **码表维护工具（离线，不进应用）**。
 *
 * 用户 2026-11-18：码表是**应用内置的数据资产**，随安装包发布，运行时只读；生成与补名这类事
 * 放这里跑一次、提交数据文件即可——**产品代码里不留任何推断逻辑**。
 *
 * 用法：`npx tsx scripts/calendar-code-table/generate.mts`
 *
 * 2026-11-18 改：数据文件从 `.ts` 源码改成了 **JSON**。原来在这里用正则改 TS 字符串字面量，
 * 一个 `K'in applications` 的撇号就能把整行切坏（25 条类型错）；数据是数据，读写结构化字段，
 * 不碰语法。
 *
 * 做的事：把国家码表里缺英文名的行，按**同族已有英文名**补上；补不出的保持空并计入
 * `name-incomplete`，不编造。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DATA = 'products/market-intelligence/service/intelligence/macro-calendar/marketCalendarCountryCodeTable.json'

type Row = { code: string; names: { zhFull: string; enFull: string; enShort: string; zhShort: string } }
const table = JSON.parse(readFileSync(DATA, 'utf8')) as Record<string, Row>

// **同族已有英文名** → 用它补同族缺失的行（这是表内事实，不是翻译）。
const enByFamily = new Map<string, string>()
for (const row of Object.values(table)) {
  const en = row.names.enFull.trim()
  if (en !== '') enByFamily.set(row.code.split('.')[1] ?? '', en)
}

let filled = 0
let stillMissing = 0
for (const row of Object.values(table)) {
  if (row.names.enFull.trim() !== '') continue
  const reuse = enByFamily.get(row.code.split('.')[1] ?? '')
  if (reuse === undefined) { stillMissing += 1; continue }
  row.names.enFull = reuse
  row.names.enShort = reuse
  filled += 1
}

writeFileSync(DATA, `${JSON.stringify(table, null, 2)}\n`)
console.log(`同族英文名补齐 ${filled} 行；仍缺（标 name-incomplete）${stillMissing} 行`)
