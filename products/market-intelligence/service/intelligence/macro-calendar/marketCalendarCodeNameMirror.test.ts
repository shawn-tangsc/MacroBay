import { describe, expect, it } from 'vitest'

import { marketCalendarCodeTable } from './marketCalendarCodeTable'
import { nameByMetricKey } from './marketCalendarCodeNames'

/**
 * 名称表 ↔ 主码表：**同一批码、同一批名字**（待办清单第 91 行）。
 *
 * 为什么要有：189 个 US 标准码的四个可见名在两边各存一份——`marketCalendarCodeNames.ts` 是运行时
 * 类型锚点（`UsMetricCode`），`marketCalendarCodeTable.json` 是产品目录的行（还带官网页、分级、状态）。
 * 今天两边逐字相同（189/189、0 diff），但**没有任何断言守着它**：改一处名、另一处不动，界面与卡片
 * 就会各说各的，而且不会红。
 *
 * 这条只锁「四名 + 码集」，不回答「哪份是真源」——那是产品口径（第 91 行的另一半，不归这条守卫）。
 * 判据：任何一份被改一个字符，这里点名到「哪个码、哪个字段、两边各是什么」。
 */
const NAME_FIELDS = ['zhFull', 'zhShort', 'enFull', 'enShort'] as const

/** 主码表里的 **US 指标行**：`evt.fomc` 这类事件行也带 `countryCode: 'US'`，它不是指标，不算。 */
const usMetricRows = Object.values(marketCalendarCodeTable)
  .filter((row) => row.kind === 'metric' && row.countryCode === 'US')

describe('名称表 ↔ 主码表：同一批码、同一批名字', () => {
  it('两个方向的码集一致（各 189 个），四个名字逐字相同', () => {
    const nameTableCodes = Object.keys(nameByMetricKey)
    const codeTableRowByCode = new Map(usMetricRows.map((row) => [row.code, row]))

    /* 两个方向分开报：只查一边会漏掉「码表加了新码、名称表还不知道」。 */
    const missingFromCodeTable = nameTableCodes.filter((code) => !codeTableRowByCode.has(code))
    const missingFromNameTable = [...codeTableRowByCode.keys()]
      .filter((code) => nameByMetricKey[code] === undefined)

    const nameDiffs: string[] = []
    for (const code of nameTableCodes) {
      const row = codeTableRowByCode.get(code)
      const name = nameByMetricKey[code]
      if (row === undefined || name === undefined) continue
      for (const field of NAME_FIELDS) {
        if (name[field] === row.names[field]) continue
        nameDiffs.push(
          `${code}.${field}: 名称表=${JSON.stringify(name[field])} 主码表=${JSON.stringify(row.names[field])}`
        )
      }
    }

    /* 数量先钉死：任何一边多一行/少一行，都在这里先红，而不是被下面的差集悄悄吞掉。 */
    expect(nameTableCodes.length, '名称表的码数变了').toBe(189)
    expect(usMetricRows.length, '主码表的 US 指标行数变了').toBe(189)
    expect(missingFromCodeTable.sort(), `名称表有、主码表没有的码：\n${missingFromCodeTable.join('\n')}`)
      .toEqual([])
    expect(missingFromNameTable.sort(), `主码表有、名称表没有的码：\n${missingFromNameTable.join('\n')}`)
      .toEqual([])
    expect(nameDiffs.sort(), `两表四名不一致：\n${nameDiffs.join('\n')}`).toEqual([])
  })
})
