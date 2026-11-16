import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * **「判新鲜度 / 决定补采 / 比对补采结果」的代码不许用 `feedByKind`**（2026-11-16，Chief 要求）。
 *
 * 一天里栽了三次同一族问题：通用读取器没登记 0xrouter、`collectionFeeds` 还是旧源、
 * 新鲜度按 `feedByKind`（旧源的三条 feed id）算——每次都表现成「数据很新却被判过期」。
 *
 * `feedByKind` 只剩一个用途：**按事件类别查映射**。凡是问「新不新 / 要不要补 / 补到了什么」，
 * 只许用 `descriptors`（当下真正在采的那三条采集描述符）。
 *
 * 判据落在这几份文件上：它们各自回答那三个问题之一。新加这类逻辑时必须把文件加进清单。
 */
const GUARDED = [
  'service/intelligence/macro-calendar/0xrouter-calendar/zeroXRouterCalendarManualRuntime.ts',
  'service/intelligence/macro-calendar/marketCalendarFreshnessFromJobs.ts',
  'service/wiring/calendarReadings.ts',
  'service/intelligence/daily-briefing/dailyBriefingCalendarCatchUp.ts'
]

describe('新鲜度/补采路径不许用 feedByKind', () => {
  it('四份「判新不新、决要不要补、比补采结果」的文件里都没有 feedByKind', () => {
    const offenders: string[] = []
    for (const rel of GUARDED) {
      const source = readFileSync(resolve(process.cwd(), 'products/market-intelligence', rel), 'utf8')
      // 注释里说明「不要用 feedByKind」不算引用：只看真实代码行。
      for (const line of source.split('\n')) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
        if (line.includes('feedByKind')) offenders.push(`${rel}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
