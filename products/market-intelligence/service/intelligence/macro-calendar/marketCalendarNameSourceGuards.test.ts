import { describe, expect, it } from 'vitest'

import { marketCalendarCodeTable } from './marketCalendarCodeTable'
import { marketCalendarCountryCodeTable } from './marketCalendarCountryCodeTable'
import { marketCalendarCountrySourceMappings } from './marketCalendarCountrySourceMappings'
import { nameForMetricKey } from './marketCalendarCodeNames'

/**
 * **码名的四条守卫**（Chief 2026-11-19）。它们对应今晚三次事故：
 * ① 映射补了、名字没补 → 写入端判 `unknown-measure` 退回（78 行）；
 * ② 码名里带当周日期 → 名字每周变；
 * ③ 同一指标两个码、名字撞车；
 * ④ 名字两套来源，写入端只认手写表。
 */
const rowsOf = (): readonly { code: string; status: string; supersededBy?: string
  names: { zhFull: string; zhShort: string; enFull: string; enShort: string } }[] =>
  // 两张表可能有同一个码（既有码 + 按国家建码有重叠），按 code 去重后再比。
  [...new Map([...Object.values(marketCalendarCodeTable), ...Object.values(marketCalendarCountryCodeTable)]
    .map((row) => [row.code, row])).values()]

describe('码名四条守卫', () => {
  it('① 映射表里每个 metricKey 都能从名字解析器拿到名字', () => {
    const missing = [...new Set(Object.values(marketCalendarCountrySourceMappings).map((entry) => entry.metricKey))]
      .filter((code) => nameForMetricKey(code) === undefined)
    expect(missing, `映射里有码但取不到名字：${missing.slice(0, 5).join(', ')}`).toEqual([])
  })

  it('② 码名里不含「(至MMDD)」「(to MMDD)」这类当周日期', () => {
    const polluted = rowsOf()
      .filter((row) => /[（(]\s*(?:至|to)\s*\d{4}\s*[）)]/iu.test(`${row.names.zhFull}${row.names.enFull}`))
      .map((row) => row.code)
    expect(polluted, `码名带当周日期：${polluted.slice(0, 5).join(', ')}`).toEqual([])
  })

  it('③ 四分名唯一性只在 active 码之间比；退役码必须有 supersededBy 且指向 active', () => {
    const active = rowsOf().filter((row) => row.status === 'active')
    const byCode = new Map(active.map((row) => [row.code, row]))
    // **只比「全名」**：短名是族级短名，同一族的月率/年率两个码本来就共用（`DE.CPI` 的 MOM 与 YOY
    // 都叫「消费者物价指数」），拿短名做唯一性会把正常情况判成撞名。
    for (const column of ['zhFull', 'enFull'] as const) {
      // 唯一性**按国家**比：同一个中文名出现在 AU 与 CA 是两个国家的同一指标，不是撞名。
      const seen = new Map<string, string>()
      for (const row of active) {
        const name = row.names[column].trim()
        if (name === '') continue
        const scoped = `${row.code.split('.')[0]}|${name}`
        const previous = seen.get(scoped)
        expect(previous === undefined, `${column} 撞名：「${name}」同时属于 ${previous} 与 ${row.code}`).toBe(true)
        seen.set(scoped, row.code)
      }
    }
    const dangling = rowsOf().filter((row) => row.status === 'retired')
      .filter((row) => row.supersededBy === undefined || byCode.get(row.supersededBy) === undefined)
      .map((row) => row.code)
    expect(dangling, `退役码没指向 active 码：${dangling.slice(0, 5).join(', ')}`).toEqual([])
  })

  it('④ active 码的名字来自码表 JSON（唯一来源）', () => {
    const fromJson = new Map(rowsOf().map((row) => [row.code, row]))
    const missing = [...Object.values(marketCalendarCountrySourceMappings).map((entry) => entry.metricKey)]
      .filter((code) => {
        const row = fromJson.get(code)
        const resolved = nameForMetricKey(code)
        return row === undefined || resolved === undefined || resolved.zhFull !== row.names.zhFull
      })
    expect(missing, `名字不是来自码表 JSON：${missing.slice(0, 5).join(', ')}`).toEqual([])
  })
})

describe('同一个码只定义一处', () => {
  it('⑤ 两张码表不许有重复码（谁再往两张表各写一份就红）', () => {
    const inMain = new Set(Object.keys(marketCalendarCodeTable))
    const dup = Object.keys(marketCalendarCountryCodeTable).filter((code) => inMain.has(code))
    expect(dup, `两张表重复定义：${dup.slice(0, 5).join(', ')}`).toEqual([])
  })
})
