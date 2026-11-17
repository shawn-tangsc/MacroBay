/**
 * **码表维护工具（离线，不进应用）**。
 *
 * 用户 2026-11-18：码表是**应用内置的数据资产**，随安装包发布，运行时只读；生成与补名这类事
 * 放这里跑一次、提交数据文件即可——**产品代码里不留任何推断逻辑**。
 *
 * 用法：`npx tsx scripts/calendar-code-table/generate.mts`
 * 做的事：把 `marketCalendarCountryCodeTable` 里缺英文名的行，按**同族已有英文名**补上；
 * 补不出的保持空并计入 `name-incomplete`，不编造。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DATA = 'products/market-intelligence/service/intelligence/macro-calendar/marketCalendarCountryCodeTable.ts'
const source = readFileSync(DATA, 'utf8')

type Row = { code: string; family: string; zh: string; en: string }
const rows: Row[] = []
for (const match of source.matchAll(/^  '([^']+)': \{(.+)\},$/gm)) {
  const [, code, body] = match
  const zh = /zhFull: '((?:[^'\\]|\\.)*)'/.exec(body!)?.[1] ?? ''
  const en = /enFull: '((?:[^'\\]|\\.)*)'/.exec(body!)?.[1] ?? ''
  rows.push({ code: code!, family: code!.split('.')[1] ?? '', zh, en })
}
// **同族已有英文名** → 用它补同族缺失的行（这是表内事实，不是翻译）。
const enByFamily = new Map<string, string>()
for (const row of rows) if (row.en.trim() !== '') enByFamily.set(row.family, row.en)

let filled = 0
let stillMissing = 0
const patched = source.replace(/^  '([^']+)': \{(.+)\},$/gm, (line, code: string, body: string) => {
  const en = /enFull: '((?:[^'\\]|\\.)*)'/.exec(body)?.[1] ?? ''
  if (en.trim() !== '') return line
  const family = code.split('.')[1] ?? ''
  const reuse = enByFamily.get(family)
  if (reuse === undefined) { stillMissing += 1; return line }
  filled += 1
  return line.replace(/enFull: ''/, `enFull: '${reuse.replace(/'/g, "\\'")}'`)
    .replace(/enShort: ''/, `enShort: '${reuse.replace(/'/g, "\\'")}'`)
})
writeFileSync(DATA, patched)
console.log(`同族英文名补齐 ${filled} 行；仍缺（标 name-incomplete）${stillMissing} 行`)
