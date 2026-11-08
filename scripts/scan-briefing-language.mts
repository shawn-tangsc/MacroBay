/**
 * 离线扫已有期次的日报语言（只读）：把每一期的文档里**所有字符串叶子**过一遍语言扫描器，
 * 打印命中（期次 + 路径 + 片段），供 B2 决定是否可以把"整版拒发"打开。
 *
 * 为什么要有这个脚本：拒发是个高风险开关。没有在**真实文档**上量过命中集，就不知道会不会把好稿拒掉。
 * 用法：`tsx scripts/scan-briefing-language.mts [dbPath]`（默认读本机 MacroBay 的日报库）。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { briefingTextBreaches } from '../products/market-intelligence/service/intelligence/daily-briefing/dailyBriefingTextScanner'

const dbPath = process.argv[2] ?? join(homedir(), 'Library', 'Application Support', 'MacroBay', 'products', 'market-intelligence', 'daily-briefings.sqlite')
const rows = execFileSync('sqlite3', ['-readonly', '-json', dbPath,
  'select edition_date, period_id, locale, document_json from daily_briefings order by edition_date desc, period_id, locale;'],
{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

type Row = { edition_date: string; period_id: string; locale: 'zh-CN' | 'en-US'; document_json: string }
const parsed = JSON.parse(rows.trim().length === 0 ? '[]' : rows) as Row[]
const report: unknown[] = []
for (const row of parsed) {
  let document: unknown
  try {
    document = JSON.parse(row.document_json)
  } catch {
    report.push({ date: row.edition_date, period: row.period_id, locale: row.locale, unreadable: true })
    continue
  }
  // 先不带白名单扫一遍：命中集要人工过，判断每一条是不是"该拒的"。
  const breaches = briefingTextBreaches({ document, locale: row.locale })
  report.push({
    date: row.edition_date,
    period: row.period_id,
    locale: row.locale,
    breaches: breaches.map((leaf) => ({ path: leaf.path, text: leaf.text.slice(0, 60) }))
  })
}
console.log(JSON.stringify(report, null, 2))
