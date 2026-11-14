import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 「导入 BLS ICS」**挂在哪一行**（用户 2026-11-15）：ICS 导入的是**日程**，不是数值。
 *
 * 所以它必须挂在「BLS 官方日程」那条源项`macro-calendar-bls`那一行，不能挂到：
 * - provider 标题行（那是「这个源是什么」的一行，不是某个能力的动作）；
 * - 「BLS 经济数据」那条源项（那是数值，不是日程）。
 *
 * 这两条都只能靠源码断言：界面我不许自己启动（用户 2026-11-03）。
 */
const SETTINGS_DIR = join(process.cwd(), 'products/market-intelligence/desktop/settings/intelligence-sources')

describe('导入 ICS 的位置：那一条源项，不是标题行、不是另一条源项', () => {
  it('keys the action by the schedule source id, not by the provider', () => {
    const pane = readFileSync(join(SETTINGS_DIR, 'SourcesSettingsPane.tsx'), 'utf8')
    expect(pane).toContain("sourceId === 'macro-calendar-bls'")
    expect(pane).toContain('<BlsIcsImportAction')
    // 按 provider 给的动作已经撤掉：标题行不再有插槽
    expect(pane).not.toContain('sourceAction=')
  })

  it('renders it in the row action group, next to the row test', () => {
    const rows = readFileSync(join(SETTINGS_DIR, 'SourceRows.tsx'), 'utf8')
    const tail = rows.slice(rows.indexOf('source-provider-detail__row-tail'))
    // 同一组：`extraAction` 与「测试」按钮都在 row-tail 里
    expect(tail).toContain('props.extraAction')
    expect(tail).toContain('props.onTest')
    expect(tail.indexOf('props.extraAction')).toBeLessThan(tail.indexOf('props.onTest'))
  })

  it('keeps the calendar toolbar free of any import entry', () => {
    const calendar = readFileSync(join(process.cwd(),
      'products/market-intelligence/desktop/features/macro/economic-calendar/EconomicCalendar.tsx'), 'utf8')
    expect(calendar).not.toContain('BlsIcsImportAction')
    expect(calendar).not.toContain('ImportBlsIcsDialog')
    expect(calendar).not.toContain('useBlsIcsImport')
  })
})
