import { useEffect, useState } from 'react'

import type { CatalogRow } from './calendarEventCatalogModel'
import { CalendarEventsCatalogDialog } from './CalendarEventsCatalogDialog'
import { calendarCountryLabel } from '../../features/macro/economic-calendar/calendarCountryLabel'
import type { CatalogText } from './CalendarEventsCatalogDialog'
import type { EconomicCalendarText } from '../../features/macro/economic-calendar/economicCalendarText'
import { marketCalendarClient } from '../../shared/ipc/marketCalendarClient'

/** 一次读完的上限：**读不全就不装作读全**（`total` 与页数都会如实反映）。 */
const MAX_PAGES = 25
const PAGE_SIZE = 200

/**
 * 事件目录：**取数在这里，画在 `CalendarEventsCatalogDialog`**。
 *
 * 读口是 `intelligence.macro.marketCalendar.queryEvents`（一行一个事件身份，621 行）：
 * 这里把游标翻到底、攒成一份清单，再交给弹框做本地筛选与分页。这样「翻到底的行数 = `total`」
 * 这条判据在界面侧也能断一次——读口的游标排序对不对，接线错了会立刻看出来。
 *
 * 三条重置规矩（Chief 2026-11-16）：改筛选、换每页条数、关掉再打开，都回到第 1 页并清空筛选；
 * 否则读者会停在「旧页码 + 新筛选」夹出来的空表上，那看起来又像「没有数据」。
 */
export function CalendarEventsCatalog({ open, onClose, text, catalog, locale, calendarText }: Readonly<{
  open: boolean
  onClose: () => void
  text: CatalogText
  /** 抽屉那份文案表：名称、期间、发布日的列名与「源原文名」角标都在里面。 */
  catalog: CatalogText
  locale: 'zh-CN' | 'en-US'
  calendarText: EconomicCalendarText
}>): React.ReactElement {
  const [rows, setRows] = useState<readonly CatalogRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  /** 每次打开 +1：关掉再打开要重新读、并且回到第 1 页（弹框自己按这个值重置）。 */
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return undefined
    let current = true
    setState('loading')
    setRows([])
    setAttempt((value) => value + 1)
    void (async () => {
      const collected: CatalogRow[] = []
      let cursor: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const answer = await marketCalendarClient.queryEvents({
          pageSize: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor })
        })
        if (!current) return
        if (answer.state !== 'available') { setState('unavailable'); setRows([]); return }
        for (const row of answer.rows) collected.push(toCatalogRow(row, locale, calendarText))
        cursor = answer.nextCursor
        if (cursor === undefined) { setState('ready'); setRows(collected); return }
      }
      // 翻到上限还没到底：把读到的给出来（不谎称全量），状态仍是 ready。
      setState('ready')
      setRows(collected)
    })().catch(() => { if (current) { setState('unavailable'); setRows([]) } })
    return () => { current = false }
  }, [open, locale, calendarText])

  return <CalendarEventsCatalogDialog open={open} onClose={onClose} text={{ ...catalog, title: text.title }}
    key={attempt} rows={rows} state={state}
    columns={['name', 'country', 'date']} onRetry={() => setAttempt((value) => value + 1)} />
}

/**
 * 读口的一行 → 表格的一行。国家**只走 `calendarCountryLabel`**（名字 → 原码 → 未知国家）：
 * 读口只给 alpha-2 原码，名字由渲染层那张名表补，没有第二处归一。
 */
function toCatalogRow(
  row: Readonly<{ key: string; countryCode: string; zhFull?: string; zhShort?: string; enFull?: string; enShort?: string
    sourceLabel?: string; titleIsSourceLabel: boolean; period?: string
    lastRelease?: Readonly<{ date: string }>; nextRelease?: Readonly<{ date: string }> }>,
  locale: 'zh-CN' | 'en-US',
  text: EconomicCalendarText
): CatalogRow {
  const zh = row.zhShort ?? row.zhFull
  const en = row.enShort ?? row.enFull
  const title = (locale === 'en-US' ? (en ?? zh) : (zh ?? en)) ?? row.sourceLabel ?? row.key
  return {
    key: row.key,
    title,
    titleIsSourceLabel: row.titleIsSourceLabel,
    ...(row.zhFull === undefined ? {} : { zhFull: row.zhFull }),
    ...(row.zhShort === undefined ? {} : { zhShort: row.zhShort }),
    ...(row.enFull === undefined ? {} : { enFull: row.enFull }),
    ...(row.enShort === undefined ? {} : { enShort: row.enShort }),
    ...(row.sourceLabel === undefined ? {} : { sourceLabel: row.sourceLabel }),
    countryCode: row.countryCode,
    countryLabel: calendarCountryLabel({ countryCode: row.countryCode }, text),
    ...(row.period === undefined ? {} : { period: row.period }),
    ...(row.lastRelease === undefined ? {} : { lastRelease: row.lastRelease.date }),
    ...(row.nextRelease === undefined ? {} : { nextRelease: row.nextRelease.date })
  }
}
